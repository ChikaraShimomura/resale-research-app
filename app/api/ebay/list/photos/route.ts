import { getActorId } from "../../../../lib/auth/actor";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { getListingSku } from "../../../../lib/ebay/stats";
import { skuForProduct } from "../../../../lib/ebay/sellApi";
import { getInventoryItem, updateInventoryItemImages } from "../../../../lib/ebay/listing";
import { uploadHostedPictureFromBinary, uploadHostedPictureFromUrl } from "../../../../lib/ebay/eps";

// 実物写真をアプリ内で追加する。eBay Picture Services(EPS)に画像をホストし、当該SKUの在庫アイテムの
// imageUrls を「全EPS」に統一して差し替える（楽天=自前URLとEPSの混在はeBayでエラーになるため）。
// 楽天の既存画像も ExternalPictureURL でEPS化して残す（=「両方残す」方針）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // 画像のEPS往復で時間がかかるため上限を引き上げ

const ALLOWED = new Set(["image/jpeg", "image/png", "image/gif", "image/bmp", "image/tiff"]);
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_FILES = 6;

export async function POST(req: Request) {
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: false, connected: false });
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
      return Response.json({ ok: false, error: `画像が大きすぎます（${f.name}・12MBまで）。` }, { status: 400 });
    }
  }

  const sku = (await getListingSku(actor, productId)) ?? skuForProduct(productId);
  const item = await getInventoryItem(token, sku);
  if (!item) {
    return Response.json({
      ok: false,
      error: "この出品の商品情報を取得できませんでした（eBay側で削除/別管理の可能性）。再出品し直してください。",
    });
  }
  const existing = ((item.product as { imageUrls?: string[] } | undefined)?.imageUrls) ?? [];

  // 既存画像: EPS(i.ebayimg.com)は再変換不要。それ以外(楽天=自前URL)は混在不可なのでEPS化する。
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

  // 実物写真をアップロード（並列）。
  const uploaded = await Promise.all(
    files.map(async (f) => {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const r = await uploadHostedPictureFromBinary(token, bytes, f.type, `rr-${productId}`);
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
    return Response.json({ ok: false, error: firstErr || "写真をアップロードできませんでした。" });
  }

  // 楽天(EPS化済) → 実物 の順で統一（全EPS・最大24枚）。
  const merged = [...existingEps, ...newEps].slice(0, 24);
  const upd = await updateInventoryItemImages(token, sku, merged);
  if (!upd.ok) return Response.json({ ok: false, error: upd.error || "出品への反映に失敗しました。" });

  return Response.json({ ok: true, added: newEps.length, total: merged.length });
}
