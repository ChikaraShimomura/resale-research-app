import { getEbayActor } from "../../../../lib/auth/teamActor";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { getListingSku } from "../../../../lib/ebay/stats";
import { skuForProduct } from "../../../../lib/ebay/sellApi";
import { getInventoryItem, updateInventoryItemImages } from "../../../../lib/ebay/listing";
import { transformListingImage, type PhotoOp } from "../../../../lib/ebay/imageProcess";
import { epsLargeUrl, epsMatchKey } from "../../../../lib/ebay/epsUrl";
import { friendlyEbayError } from "../../../../lib/ebay/errorMessages";
import { recordAutoError } from "../../../../lib/errorReport";

// 出品中の「写真の並び替え・メイン設定・削除（＝画像配列の差し替え）」と「1枚ごとの加工（回転/トリミング/文字消去）」。
//   action="order"     { imageUrls } … 画像配列をそのまま eBay へ反映（先頭=メイン）。削除/並び替えはクライアントで配列を作って送る。
//   action="transform" { imageUrl, op, crop? } … 指定画像を加工→EPS再ホスト→配列内の該当URLを差し替えて反映。新配列を返す。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // 画像のEPS往復で時間がかかるため上限を引き上げ

const skuFor = async (actor: string, productId: string): Promise<string> =>
  (await getListingSku(actor, productId)) ?? skuForProduct(productId);

const OFFER_NOT_FOUND = "この出品の商品情報を取得できませんでした（eBay側で削除/別管理の可能性）。再出品し直してください。";

// 在庫アイテムの現在の画像配列を読む。
async function currentImages(token: string, sku: string): Promise<string[] | null> {
  const item = await getInventoryItem(token, sku);
  if (!item) return null;
  return ((item.product as { imageUrls?: string[] } | undefined)?.imageUrls) ?? [];
}

export async function POST(req: Request) {
  const actor = await getEbayActor(); // 出品中の編集は出品に使ったeBayアカウント基準（共有=オーナー/個別=本人）
  if (!actor) return Response.json({ ok: false, connected: false });
  const token = await getValidAccessToken(actor);
  if (!token) return Response.json({ ok: false, connected: false });

  const body = (await req.json().catch(() => ({}))) as {
    productId?: string;
    action?: "order" | "transform";
    imageUrls?: string[];
    imageUrl?: string;
    op?: PhotoOp;
    crop?: { x: number; y: number; w: number; h: number };
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
      const f = friendlyEbayError(upd.error);
      if (!f.known) await recordAutoError({ where: "ebay_photo_order", message: f.message, errorDetail: upd.error, productId: body.productId, actor });
      return Response.json({ ok: false, error: f.message, errorKind: f.known ? "known" : "unexpected", errorDetail: upd.error });
    }
    return Response.json({ ok: true, imageUrls: urls });
  }

  // ── 1枚ごとの加工：回転/トリミング/文字消去 → EPS再ホスト → 配列内の該当URLを差し替え ──
  if (body.action === "transform") {
    if (!body.imageUrl || !body.op) return Response.json({ ok: false, error: "加工内容が不正です。" }, { status: 400 });
    const imgsRaw = await currentImages(token, sku);
    if (imgsRaw == null) return Response.json({ ok: false, error: OFFER_NOT_FOUND });
    // 表示側(クライアント)と実体(eBay)でサイズ変種(s-l1600/s-l500)が違っても一致するよう、サイズを伏せた基準キーで突合する。
    const idx = imgsRaw.map(epsMatchKey).indexOf(epsMatchKey(body.imageUrl));
    if (idx < 0) return Response.json({ ok: false, error: "対象の写真が見つかりませんでした。画面を開き直してください。" });

    const t = await transformListingImage(token, imgsRaw[idx], body.op, body.crop); // 実体URLから加工（内部でs-l1600取得）
    if (!t.ok) {
      const f = friendlyEbayError(t.error);
      if (!f.known) await recordAutoError({ where: "ebay_photo_transform", message: t.error, errorDetail: t.error, productId: body.productId, actor, op: body.op });
      return Response.json({ ok: false, error: f.known ? f.message : t.error, errorKind: f.known ? "known" : "unexpected" });
    }
    const next = imgsRaw.map(epsLargeUrl); // 保存は全てフル解像度(s-l1600)に揃える
    next[idx] = t.url; // 同じ位置に差し替え（並び順は保つ）
    const upd = await updateInventoryItemImages(token, sku, next);
    if (!upd.ok) {
      const f = friendlyEbayError(upd.error);
      if (!f.known) await recordAutoError({ where: "ebay_photo_transform_save", message: f.message, errorDetail: upd.error, productId: body.productId, actor });
      return Response.json({ ok: false, error: f.message, errorKind: f.known ? "known" : "unexpected", errorDetail: upd.error });
    }
    return Response.json({ ok: true, imageUrls: next, newUrl: t.url });
  }

  return Response.json({ ok: false, error: "操作が指定されていません。" }, { status: 400 });
}
