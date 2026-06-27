import { kvReadOnly } from "../../../../lib/kv";
import { getEbayActor } from "../../../../lib/auth/teamActor";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { getOfferForSku, updateOfferPriceQuantity, updateOfferPriceFull, updateOfferShipping, listFulfillmentPolicies } from "../../../../lib/ebay/listing";
import { getListingSku } from "../../../../lib/ebay/stats";
import { skuForProduct } from "../../../../lib/ebay/sellApi";
import { friendlyEbayError } from "../../../../lib/ebay/errorMessages";
import { recordAutoError } from "../../../../lib/errorReport";
import { getProductById } from "../../../../lib/ebay/productStore";
import { breakevenUsd } from "../../../../lib/ebay/priceModel";
import { estimateWeightG, USD_JPY } from "../../../../lib/ebay/landedCost";

// 出品中の「価格・数量」をアプリ内で編集する（eBay.comを触らせない＝出品の管理が外れる原因を断つ）。
// GET  ?id=商品ID         → 現在の価格・数量・公開IDを返す（編集モーダルのプリフィル用）
// POST { productId, priceUsd?, quantity? } → 価格・数量を更新（公開中の出品にも即反映）
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// その商品の出品に使われたSKU（deal.sku）。旧データは決定的SKU rr-{商品ID} にフォールバック。
const skuFor = async (actor: string, productId: string): Promise<string> =>
  (await getListingSku(actor, productId)) ?? skuForProduct(productId);

// 商品の損益分岐(±0・USD)を SSOT(priceModel) で算出。原価=psnap.source.price、重量=weight:{id}キャッシュ(無ければカテゴリ概算)。
// 手入力価格がこれ未満なら赤字＝編集モーダルで警告し、承知(acceptLoss)が無ければ更新を弾く。出品モーダル/商品管理と同じ式。
async function breakevenUsdFor(id: string): Promise<number> {
  try {
    const snap = await getProductById(id);
    const costJpy = Number((snap as { source?: { price?: number } } | null)?.source?.price) || 0;
    const wRaw = await kvReadOnly.get<number>(`weight:${id}`);
    const weightG = typeof wRaw === "number" && wRaw > 0 ? wRaw : estimateWeightG((snap as { category?: string } | null)?.category);
    if (costJpy > 0 && weightG > 0) return Math.round(breakevenUsd(costJpy, weightG) * 100) / 100;
  } catch { /* floor不明でも編集自体は使える（警告が出ないだけ） */ }
  return 0;
}

// 出品が見つからない時の文言。\n で「見出し＋詳細」を改行（表示側は whitespace-pre-line で1行目を独立表示）。
// チーム個別モードでは「別メンバーのeBayに出した出品」は本人以外から取得できないため、その可能性も伝える。
const OFFER_NOT_FOUND =
  "この出品が見つかりませんでした。\n違うチームメイトが出品したか、eBay側で終了された可能性があります。";

export async function GET(req: Request) {
  const actor = await getEbayActor(); // 出品中の編集は出品に使ったeBayアカウント基準（共有=オーナー/個別=本人）
  if (!actor) return Response.json({ ok: false, connected: false });
  const token = await getValidAccessToken(actor);
  if (!token) return Response.json({ ok: false, connected: false });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });

  const offer = await getOfferForSku(token, await skuFor(actor, id));
  if (!offer) {
    return Response.json({
      ok: false,
      error: OFFER_NOT_FOUND,
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
  // 送料の出し方（送料込み/別）の現在状態＋切替プレビュー。配送ポリシーのcostUsdから判定。
  let ship: { mode: "free" | "paid"; canFree: boolean; foldUsd: number; unfoldUsd: number } | null = null;
  try {
    const policies = await listFulfillmentPolicies(token);
    const cur = policies.find((p) => p.fulfillmentPolicyId === offer.fulfillmentPolicyId) || null;
    const free = policies.find((p) => Number(p.costUsd) < 0.01) || null;
    const paid = policies.filter((p) => Number(p.costUsd) >= 0.01).sort((a, b) => Number(a.costUsd) - Number(b.costUsd));
    const mode: "free" | "paid" = cur && Number(cur.costUsd) < 0.01 ? "free" : "paid";
    ship = {
      mode,
      canFree: !!free,
      foldUsd: mode === "paid" ? Number(cur?.costUsd || 0) : 0,   // 送料込みにした時に価格へ上乗せされる額
      unfoldUsd: paid[0] ? Number(paid[0].costUsd) : 0,            // 送料別に戻した時に価格から引かれる額(最安の有料送料)
    };
  } catch {
    /* 送料状態が取れなくても価格/数量編集は使えるようにする */
  }
  const floorUsd = await breakevenUsdFor(id); // 損益分岐(±0)。手入力価格がこれ未満なら赤字警告に使う。0=不明
  return Response.json({ ok: true, priceUsd: offer.priceUsd, quantity: offer.quantity, listingId: offer.listingId, refImages, ship, floorUsd });
}

export async function POST(req: Request) {
  const actor = await getEbayActor(); // 出品中の編集は出品に使ったeBayアカウント基準（共有=オーナー/個別=本人）
  if (!actor) return Response.json({ ok: false, connected: false });
  const token = await getValidAccessToken(actor);
  if (!token) return Response.json({ ok: false, connected: false });

  const body = (await req.json().catch(() => ({}))) as { productId?: string; priceUsd?: string | number; quantity?: number; shipMode?: "free" | "paid"; acceptLoss?: boolean };
  if (!body.productId) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });

  // ── 送料の出し方（送料込み/別）の切替。価格と配送ポリシーを同時更新する（価格/数量編集とは別操作）。──
  if (body.shipMode === "free" || body.shipMode === "paid") {
    const sku = await skuFor(actor, body.productId);
    const offer = await getOfferForSku(token, sku);
    if (!offer) return Response.json({ ok: false, error: OFFER_NOT_FOUND });
    const policies = await listFulfillmentPolicies(token);
    const cur = policies.find((p) => p.fulfillmentPolicyId === offer.fulfillmentPolicyId) || null;
    const free = policies.find((p) => Number(p.costUsd) < 0.01) || null;
    const paid = policies.filter((p) => Number(p.costUsd) >= 0.01).sort((a, b) => Number(a.costUsd) - Number(b.costUsd));
    const curPrice = Number(offer.priceUsd || 0);
    const curIsFree = !!cur && Number(cur.costUsd) < 0.01;
    let newPrice: string, newPolicyId: string;
    if (body.shipMode === "free") {
      if (!free) return Response.json({ ok: false, error: "eBayに『送料無料』の配送ポリシーがありません。eBayで送料無料ポリシーを1つ作成すると切替できます。" });
      if (curIsFree) return Response.json({ ok: true, already: true, mode: "free" }); // 既に送料込み
      newPrice = (Math.round((curPrice + Number(cur?.costUsd || 0)) * 100) / 100).toFixed(2); // 現在の送料を価格に上乗せ（円未満の浮動小数誤差を防ぐためセント丸め）
      newPolicyId = free.fulfillmentPolicyId;
    } else {
      if (curIsFree === false) return Response.json({ ok: true, already: true, mode: "paid" }); // 既に送料別
      const target = paid[0]; // 最安の有料送料に戻す
      if (!target) return Response.json({ ok: false, error: "有料の配送ポリシーがありません。" });
      newPrice = Math.max(0.01, Math.round((curPrice - Number(target.costUsd)) * 100) / 100).toFixed(2); // 上乗せ分を価格から引く（セント丸め）
      newPolicyId = target.fulfillmentPolicyId;
    }
    const sr = await updateOfferShipping(token, offer.offerId, { priceUsd: newPrice, fulfillmentPolicyId: newPolicyId });
    if (!sr.ok) {
      const f = friendlyEbayError(sr.error);
      if (!f.known) await recordAutoError({ where: "ebay_edit_shipmode", message: f.message, errorDetail: sr.error, productId: body.productId, actor, shipMode: body.shipMode });
      return Response.json({ ok: false, error: f.message, errorKind: f.known ? "known" : "unexpected", errorDetail: sr.error });
    }
    return Response.json({ ok: true, mode: body.shipMode, priceUsd: newPrice });
  }

  const opts: { priceUsd?: string; quantity?: number } = {};
  if (body.priceUsd != null && body.priceUsd !== "") {
    const p = Number(body.priceUsd);
    if (!Number.isFinite(p) || p < 0.01) return Response.json({ ok: false, error: "価格(USD)が正しくありません。" }, { status: 400 });
    // 損益分岐(±0)未満＝赤字。承知(acceptLoss)が無ければ弾く＝手入力で気づかず赤字価格を送るのを防ぐ(出品モーダルと同じ作法)。
    if (!body.acceptLoss) {
      const floor = await breakevenUsdFor(body.productId);
      if (floor > 0 && p < floor) {
        return Response.json({ ok: false, belowFloor: true, floorUsd: floor, error: `この価格は損益分岐（約¥${Math.round(floor * USD_JPY).toLocaleString("ja-JP")}）を下回り、赤字になります。` });
      }
    }
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
  if (!offer) return Response.json({ ok: false, error: OFFER_NOT_FOUND });

  // 価格のみ変更でも、現在の数量(availability)を更新リクエストに同梱する。
  // 在庫(availability)が欠けた状態だと #25604「Availability not found」系で400になることがあるため、
  // 現数量を明示して送る（同値なので実質no-op・安全側）。数量が取れない時は触らない。
  if (opts.priceUsd != null && opts.quantity == null && typeof offer.quantity === "number" && offer.quantity >= 1) {
    opts.quantity = offer.quantity;
  }

  // 価格変更を含む時はフルoffer PUT（Best Offerは廃止＝bestOfferTermsを除去して出す。旧しきい値との衝突＝
  // 「価格の指定に問題があります」も根治。既存出品からのBest Offer除去の移行も兼ねる）。
  // 数量だけの変更は従来どおり bulk_update_price_quantity（軽い）。
  const r =
    opts.priceUsd != null
      ? await updateOfferPriceFull(token, offer.offerId, { priceUsd: opts.priceUsd, quantity: opts.quantity })
      : await updateOfferPriceQuantity(token, sku, offer.offerId, opts);
  if (!r.ok) {
    const f = friendlyEbayError(r.error);
    // リリース硬化中：価格変更の失敗は既知/未知を問わず生エラーをKVに残す（既知はメール抑止=silent）。原因の特定を確実にする。
    await recordAutoError({ where: "ebay_edit_price", message: f.message, errorDetail: r.error, productId: body.productId, actor, priceUsd: opts.priceUsd, quantity: opts.quantity, silent: f.known });
    return Response.json({ ok: false, error: f.message, errorKind: f.known ? "known" : "unexpected", errorDetail: r.error });
  }
  return Response.json({ ok: true });
}
