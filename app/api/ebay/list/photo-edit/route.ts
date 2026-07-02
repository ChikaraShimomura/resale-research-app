import { resolveEditAuth } from "../../../../lib/ebay/editAuth";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { getListingSku } from "../../../../lib/ebay/stats";
import { skuForProduct } from "../../../../lib/ebay/sellApi";
import { updateInventoryItemImages } from "../../../../lib/ebay/listing";
import { transformListingImage, type PhotoOp } from "../../../../lib/ebay/imageProcess";
import { epsLargeUrl } from "../../../../lib/ebay/epsUrl";
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
    // 並び順をそのまま反映。ついでにEPS画像はフル解像度(s-l1600)に揃える＝旧来の縮小URL(s-l500等)で出ていた品も鮮明化。
    const urls = (body.imageUrls || []).filter((u) => typeof u === "string" && u).map(epsLargeUrl).slice(0, 24);
    if (!urls.length) return Response.json({ ok: false, error: "画像を1枚以上残してください。" }, { status: 400 });
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
    if (body.stage) return Response.json({ ok: true, imageUrls: next, newUrl: t.url });
    const upd = await updateInventoryItemImages(token, sku, next);
    if (!upd.ok) {
      await diag("transform_save", upd.error, { op: body.op, productId: body.productId });
      const f = friendlyEbayError(upd.error);
      if (!f.known) await recordAutoError({ where: "ebay_photo_transform_save", message: f.message, errorDetail: upd.error, productId: body.productId, actor });
      return Response.json({ ok: false, error: f.message, errorKind: f.known ? "known" : "unexpected", errorDetail: upd.error });
    }
    return Response.json({ ok: true, imageUrls: next, newUrl: t.url });
  }

  return Response.json({ ok: false, error: "操作が指定されていません。" }, { status: 400 });
}
