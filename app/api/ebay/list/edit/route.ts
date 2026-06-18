import { kvReadOnly } from "../../../../lib/kv";
import { getActorId } from "../../../../lib/auth/actor";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { getOfferForSku, updateOfferPriceQuantity } from "../../../../lib/ebay/listing";
import { getListingSku } from "../../../../lib/ebay/stats";
import { skuForProduct } from "../../../../lib/ebay/sellApi";

// 出品中の「価格・数量」をアプリ内で編集する（eBay.comを触らせない＝出品の管理が外れる原因を断つ）。
// GET  ?id=商品ID         → 現在の価格・数量・公開IDを返す（編集モーダルのプリフィル用）
// POST { productId, priceUsd?, quantity? } → 価格・数量を更新（公開中の出品にも即反映）
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// その商品の出品に使われたSKU（deal.sku）。旧データは決定的SKU rr-{商品ID} にフォールバック。
const skuFor = async (actor: string, productId: string): Promise<string> =>
  (await getListingSku(actor, productId)) ?? skuForProduct(productId);

export async function GET(req: Request) {
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: false, connected: false });
  const token = await getValidAccessToken(actor);
  if (!token) return Response.json({ ok: false, connected: false });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });

  const offer = await getOfferForSku(token, await skuFor(actor, id));
  if (!offer) {
    return Response.json({
      ok: false,
      error: "この出品が見つかりませんでした（eBay側で削除/終了された可能性があります）。",
    });
  }
  // 撮影の参考用：自宅ワーカー(galleryWorker)が取得・保存した楽天ギャラリー(ref_gallery:{id})を返す。
  // 表示専用(eBay出品には載せない)。未取得なら空配列。
  let refImages: string[] = [];
  try {
    const ref = await kvReadOnly.get<{ status?: string; urls?: string[] }>(`ref_gallery:${id}`);
    if (ref?.status === "done" && Array.isArray(ref.urls)) refImages = ref.urls.slice(0, 24);
  } catch {
    /* noop */
  }
  return Response.json({ ok: true, priceUsd: offer.priceUsd, quantity: offer.quantity, listingId: offer.listingId, refImages });
}

export async function POST(req: Request) {
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: false, connected: false });
  const token = await getValidAccessToken(actor);
  if (!token) return Response.json({ ok: false, connected: false });

  const body = (await req.json().catch(() => ({}))) as { productId?: string; priceUsd?: string | number; quantity?: number };
  if (!body.productId) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });

  const opts: { priceUsd?: string; quantity?: number } = {};
  if (body.priceUsd != null && body.priceUsd !== "") {
    const p = Number(body.priceUsd);
    if (!Number.isFinite(p) || p < 0.01) return Response.json({ ok: false, error: "価格(USD)が正しくありません。" }, { status: 400 });
    opts.priceUsd = p.toFixed(2);
  }
  if (body.quantity != null) {
    const q = Math.floor(Number(body.quantity));
    if (!Number.isFinite(q) || q < 1 || q > 30) return Response.json({ ok: false, error: "数量は1〜30で入力してください。" }, { status: 400 });
    opts.quantity = q;
  }
  if (opts.priceUsd == null && opts.quantity == null) {
    return Response.json({ ok: false, error: "変更内容がありません。" }, { status: 400 });
  }

  const sku = await skuFor(actor, body.productId);
  const offer = await getOfferForSku(token, sku);
  if (!offer) return Response.json({ ok: false, error: "この出品が見つかりませんでした（eBay側で削除/終了された可能性があります）。" });

  const r = await updateOfferPriceQuantity(token, sku, offer.offerId, opts);
  if (!r.ok) return Response.json({ ok: false, error: r.error || "更新に失敗しました。" });
  return Response.json({ ok: true });
}
