import { resolveEditAuth } from "../../../../lib/ebay/editAuth";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { getListingSku } from "../../../../lib/ebay/stats";
import { skuForProduct } from "../../../../lib/ebay/sellApi";
import { getInventoryItem, updateInventoryItemImages } from "../../../../lib/ebay/listing";
import { uploadHostedPictureFromBinary, uploadHostedPictureFromUrl } from "../../../../lib/ebay/eps";
import { processRealPhoto } from "../../../../lib/ebay/imageProcess";
import { friendlyEbayError } from "../../../../lib/ebay/errorMessages";

// 実物写真をアプリ内で追加する。eBay Picture Services(EPS)に画像をホストし、当該SKUの在庫アイテムの
// imageUrls を「全EPS」に統一して差し替える（自前URLとEPSの混在はeBayでエラーになるため）。
// 仕入れ元の既存画像も ExternalPictureURL でEPS化して残す（=「両方残す」方針）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // 画像のEPS往復で時間がかかるため上限を引き上げ

const ALLOWED = new Set(["image/jpeg", "image/png", "image/gif", "image/bmp", "image/tiff"]);
// 取り込みの上限(原本)。アップロード前に sharp で 1600px/JPEG へ縮小するので、スマホの大きな写真も受けられる。
const MAX_BYTES = 40 * 1024 * 1024;
const MAX_FILES = 6;

export async function POST(req: Request) {
  const auth = await resolveEditAuth(); // 出品操作は出品に使ったeBayアカウント基準＋チームメンバーは'list'権限必須（他の編集系と統一）
  if ("deny" in auth) return auth.deny;
  const actor = auth.actor;
  const token = await getValidAccessToken(actor);
  if (!token) return Response.json({ ok: false, connected: false });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "画像の受信に失敗しました。" }, { status: 400 });
  }
  const productId = String(form.get("productId") ?? "");
  if (!productId) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return Response.json({ ok: false, error: "写真が選択されていません。" }, { status: 400 });
  if (files.length > MAX_FILES) {
    return Response.json({ ok: false, error: `一度に追加できるのは${MAX_FILES}枚までです。` }, { status: 400 });
  }
  for (const f of files) {
    if (!ALLOWED.has(f.type)) {
      return Response.json({ ok: false, error: `対応していない形式です（${f.name}）。JPG/PNG/GIF/BMP/TIFFのみ。` }, { status: 400 });
    }
    if (f.size > MAX_BYTES) {
      return Response.json({ ok: false, error: `画像が大きすぎます（${f.name}・40MBまで）。` }, { status: 400 });
    }
  }

  // stage=1：「保存」でまとめて反映する方式。ここではEPSに載せて新URLを返すだけ＝出品(imageUrls)には書き込まない。
  // クライアントが受け取ったURLをローカルの写真配列に足し、最後の「保存」で写真配列ごとeBayへ書く（写真も価格も同じタイミングで有効化）。
  const stage = String(form.get("stage") ?? "") === "1";
  const sku = (await getListingSku(actor, productId)) ?? skuForProduct(productId);

  // 実物写真をEPSへアップロード（並列）。sharpで長辺1600px/JPEGへ縮小してから上げる(12MB超対策＋規格統一)。
  const uploaded = await Promise.all(
    files.map(async (f) => {
      const raw = Buffer.from(await f.arrayBuffer());
      let bytes: Buffer = raw;
      try { bytes = await processRealPhoto(raw); } catch { bytes = raw; } // 加工失敗は原本で続行
      const r = await uploadHostedPictureFromBinary(token, bytes, "image/jpeg", `rr-${productId}`);
      return r.ok && r.fullUrl ? r.fullUrl : { error: r.error };
    })
  );
  const newEps: string[] = [];
  let firstErr: string | undefined;
  for (const u of uploaded) {
    if (typeof u === "string") newEps.push(u);
    else if (!firstErr) firstErr = u.error;
  }
  if (!newEps.length) {
    const f = friendlyEbayError(firstErr);
    return Response.json({ ok: false, error: f.message, errorKind: f.known ? "known" : "unexpected", errorDetail: firstErr });
  }

  // ステージング：EPSに載せたURLだけ返す（出品への反映は「保存」時の写真配列書き込みに任せる）。
  if (stage) return Response.json({ ok: true, added: newEps.length, urls: newEps });

  const { item, error: getErr } = await getInventoryItem(token, sku);
  if (!item) {
    // 在庫アイテムが無い＝eBay側で削除/別管理に移った（または自己修復SKUのズレ）＝再出品で復帰できる既知の回復可能状態。
    // バグではないので errorKind:"known"（「開発者に報告」も自動報告も出さない）＋再出品の導線だけ見せる。
    const f = friendlyEbayError(getErr);
    return Response.json({
      ok: false,
      error: f.known ? f.message : "この出品はeBay側で削除/別管理に移った可能性があります。マイページから再出品し直してください。",
      errorKind: "known",
      needsRelist: true,
    });
  }
  const existing = ((item.product as { imageUrls?: string[] } | undefined)?.imageUrls) ?? [];

  // 既存画像: EPS(i.ebayimg.com)は再変換不要。それ以外(仕入れ元=自前URL)は混在不可なのでEPS化する。
  // 失敗した自前URLはスキップ（混在を避けるため自前URLは絶対に残さない）。
  const existingEps = (
    await Promise.all(
      existing.map(async (url) => {
        if (/ebayimg\.com/i.test(url)) return url;
        const r = await uploadHostedPictureFromUrl(token, url);
        return r.ok && r.fullUrl ? r.fullUrl : null;
      })
    )
  ).filter((u): u is string => !!u);

  // 仕入れ元画像(EPS化済) → 実物 の順で統一（全EPS・最大24枚）。
  const merged = [...existingEps, ...newEps].slice(0, 24);
  const upd = await updateInventoryItemImages(token, sku, merged);
  if (!upd.ok) {
    const f = friendlyEbayError(upd.error);
    return Response.json({ ok: false, error: f.message, errorKind: f.known ? "known" : "unexpected", errorDetail: upd.error });
  }

  return Response.json({ ok: true, added: newEps.length, total: merged.length });
}
