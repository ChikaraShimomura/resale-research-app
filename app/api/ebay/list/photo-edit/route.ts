import { resolveEditAuth } from "../../../../lib/ebay/editAuth";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { getListingSku } from "../../../../lib/ebay/stats";
import { skuForProduct } from "../../../../lib/ebay/sellApi";
import { updateInventoryItemImages } from "../../../../lib/ebay/listing";
import { uploadHostedPictureFromUrl } from "../../../../lib/ebay/eps";
import { transformListingImage, type PhotoOp } from "../../../../lib/ebay/imageProcess";
import { epsLargeUrl } from "../../../../lib/ebay/epsUrl";
import { upscaleImageflux } from "../../../../lib/usedGallery";
import { friendlyEbayError } from "../../../../lib/ebay/errorMessages";
import { recordAutoError } from "../../../../lib/errorReport";
import { kv } from "@vercel/kv";

// 写真操作の失敗時、eBayの生エラーをKVに残してPC側から原因を読めるようにする（既知/未知問わず・診断用・TTL7日）。
async function diag(where: string, raw?: string, extra?: Record<string, unknown>) {
  try { await kv.set("diag:photoerr", { at: new Date().toISOString(), where, raw: raw || "", ...extra }, { ex: 7 * 24 * 3600 }); } catch { /* noop */ }
}

// 出品中の写真編集。★どの操作も「クライアントが今表示している配列(=正)を丸ごとeBayへ反映」する方式。
//   サーバーで現在の配列を取り直して1枚を突合…はしない＝順番・枚数・サイズ変種のズレで「写真が見つからない」が起きない。
//   action="order"     { imageUrls }              … 並び替え/削除/メイン設定。配列をそのまま反映（先頭=メイン）。
//   action="transform" { imageUrls, index, op, crop? } … 配列のindexの1枚だけ加工→EPS再ホスト→その位置だけ差し替えて全配列を反映。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // 画像のEPS往復で時間がかかるため上限を引き上げ

const skuFor = async (actor: string, productId: string): Promise<string> =>
  (await getListingSku(actor, productId)) ?? skuForProduct(productId);

// 出品画像を「全EPS(ebayimg.com)」に統一してからeBayへ反映する。
// ⚠️自前ホストURL(imageflux/ハードオフ等)とEPSが混在すると eBay #25014「A mixture of Self Hosted and EPS pictures are
//   not allowed」で並び替え/加工の保存が丸ごと失敗する（写真“追加”の /photos は元から全EPS化しているが、こちらは未対応だった）。
// EPS(ebayimg.com)は s-l1600 に揃えるだけ。自前URLは ExternalPictureURL でEPSへ載せ替える（imageflux は載せる前に原寸級へ）。
// 並び順は保持（Promise.all は入力順を保つ）。載せ替え失敗した自前URLは混在を避けるため落とす。
async function toAllEps(token: string, urls: string[]): Promise<string[]> {
  const out = await Promise.all(
    urls.map(async (u) => {
      if (/ebayimg\.com/i.test(u)) return epsLargeUrl(u); // 既にEPS＝フル解像度に揃えるだけ（アップロード不要）
      const r = await uploadHostedPictureFromUrl(token, upscaleImageflux(u));
      return r.ok && r.fullUrl ? r.fullUrl : null;
    })
  );
  return out.filter((u): u is string => !!u);
}

export async function POST(req: Request) {
  const auth = await resolveEditAuth(); // 出品中の編集は出品に使ったeBayアカウント基準＋チームメンバーは'list'権限必須
  if ("deny" in auth) return auth.deny;
  const actor = auth.actor;
  const token = await getValidAccessToken(actor);
  if (!token) return Response.json({ ok: false, connected: false });

  const body = (await req.json().catch(() => ({}))) as {
    productId?: string;
    action?: "order" | "transform";
    imageUrls?: string[];
    index?: number;
    op?: PhotoOp;
    crop?: { x: number; y: number; w: number; h: number };
    stage?: boolean; // true＝加工後の画像をEPSに載せて新URLを返すだけ（出品には書かない）。反映は「保存」時の写真配列書き込みに任せる。
  };
  if (!body.productId) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });
  const sku = await skuFor(actor, body.productId);

  // ── 並び替え/削除/メイン設定：クライアントが作った配列をそのまま反映 ──
  if (body.action === "order") {
    const raw = (body.imageUrls || []).filter((u) => typeof u === "string" && u).slice(0, 24);
    if (!raw.length) return Response.json({ ok: false, error: "画像を1枚以上残してください。" }, { status: 400 });
    // 並び順を保ちつつ「全EPS」に統一（自前URLとEPSの混在=eBay #25014 を防ぐ）。EPSはs-l1600に揃え、自前URLはEPSへ載せ替え。
    const urls = await toAllEps(token, raw);
    if (!urls.length) return Response.json({ ok: false, error: "画像をeBayに反映できませんでした。時間をおいて再度お試しください。" });
    const upd = await updateInventoryItemImages(token, sku, urls);
    if (!upd.ok) {
      await diag("order", upd.error, { productId: body.productId });
      const f = friendlyEbayError(upd.error);
      if (!f.known) await recordAutoError({ where: "ebay_photo_order", message: f.message, errorDetail: upd.error, productId: body.productId, actor });
      return Response.json({ ok: false, error: f.message, errorKind: f.known ? "known" : "unexpected", errorDetail: upd.error });
    }
    return Response.json({ ok: true, imageUrls: urls });
  }

  // ── 1枚ごとの加工：クライアントの配列(=正)を受け取り、indexの1枚だけ加工して差し替え、全配列を反映 ──
  if (body.action === "transform") {
    const imgs = (body.imageUrls || []).filter((u) => typeof u === "string" && u).map(epsLargeUrl).slice(0, 24);
    const idx = body.index;
    if (!imgs.length || idx == null || idx < 0 || idx >= imgs.length || !body.op) {
      return Response.json({ ok: false, error: "加工対象が正しく指定されていません。画面を開き直してください。" }, { status: 400 });
    }
    const t = await transformListingImage(token, imgs[idx], body.op, body.crop); // クライアントが指す実URLから加工（内部でs-l1600取得）
    if (!t.ok) {
      await diag("transform", t.error, { op: body.op, productId: body.productId });
      const f = friendlyEbayError(t.error);
      if (!f.known) await recordAutoError({ where: "ebay_photo_transform", message: t.error, errorDetail: t.error, productId: body.productId, actor, op: body.op });
      return Response.json({ ok: false, error: f.known ? f.message : t.error, errorKind: f.known ? "known" : "unexpected" });
    }
    const next = imgs.slice();
    next[idx] = t.url; // 加工後の1枚を差し替え（並び順はクライアントのまま保持）
    // ステージング：加工URLは載せ済み。出品への書き込みは「保存」時にまとめて行うので、ここでは配列だけ返す。
    // （保存時は "order" が toAllEps で全EPS化するので、staged配列に自前URLが残っていても混在#25014にはならない）
    if (body.stage) return Response.json({ ok: true, imageUrls: next, newUrl: t.url });
    // 直接保存：加工でindexの1枚だけEPS化されるので、残りの自前URLと混在(#25014)しないよう全EPSに統一してから反映。
    const epsNext = await toAllEps(token, next);
    if (!epsNext.length) return Response.json({ ok: false, error: "画像をeBayに反映できませんでした。時間をおいて再度お試しください。" });
    const upd = await updateInventoryItemImages(token, sku, epsNext);
    if (!upd.ok) {
      await diag("transform_save", upd.error, { op: body.op, productId: body.productId });
      const f = friendlyEbayError(upd.error);
      if (!f.known) await recordAutoError({ where: "ebay_photo_transform_save", message: f.message, errorDetail: upd.error, productId: body.productId, actor });
      return Response.json({ ok: false, error: f.message, errorKind: f.known ? "known" : "unexpected", errorDetail: upd.error });
    }
    return Response.json({ ok: true, imageUrls: epsNext, newUrl: t.url }); // 実際に保存した全EPS配列を返す（クライアントの表示と一致）
  }

  return Response.json({ ok: false, error: "操作が指定されていません。" }, { status: 400 });
}
