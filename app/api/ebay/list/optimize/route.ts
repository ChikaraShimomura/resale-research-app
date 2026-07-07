import { kv } from "@vercel/kv";
import { Ratelimit } from "@upstash/ratelimit";
import { getEbayActor, getTeamContext } from "../../../../lib/auth/teamActor";
import { hasPerm } from "../../../../lib/team";
import { canAutoList } from "../../../../lib/auth/plan";
import { getProductById } from "../../../../lib/ebay/productStore";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { getListingSku } from "../../../../lib/ebay/stats";
import { skuForProduct } from "../../../../lib/ebay/sellApi";
import { reviseInventoryItemContent, updateOfferListingDescription, descriptionToHtml } from "../../../../lib/ebay/listing";
import { friendlyEbayError } from "../../../../lib/ebay/errorMessages";
import { recordAutoError } from "../../../../lib/errorReport";
import {
  OPTIMIZE_VERSION,
  buildOptimizedTitle,
  buildOptimizedDescription,
  buildOptimizedAspects,
} from "../../../../lib/ebay/optimizeListing";

// 既存eBay出品を「返品最小化テンプレ」に改訂する。
// 生成はすべて決定論テンプレ（商品データの差し込みのみ）＝AI呼び出しゼロ＝連打しても課金は発生しない。
// GET            → そのアクターで「現テンプレ版」最適化済みの商品ID一覧（ボタンのグレーアウト判定用）。
// POST {productId} → その出品の タイトル・説明・Item Specifics を改訂し、最適化済みフラグ(版つき)を保存。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 最適化済みフラグ。アクター単位のハッシュ（field=商品ID, value=テンプレ版）。
// 個別キー opt:{actor}:{id} だと一覧表示に SCAN が要るため、1ハッシュにまとめて HGETALL 一発で読めるようにする。
const OPT_MAP_KEY = (actor: string) => `opt:${actor}`;
const OPT_MAP_TTL = 730 * 24 * 60 * 60; // 取引台帳/SKU対応表と同じ2年保持で揃える

// 濫用・連打のバックストップ：1アクター30回/日。決定論なので課金は無いが、無駄なeBay書き込みを抑える。
const rl = new Ratelimit({ redis: kv, limiter: Ratelimit.slidingWindow(30, "1 d"), prefix: "rl:optimize:actor", analytics: false });

export async function GET() {
  const actor = await getEbayActor(); // 出品の改訂は出品に使ったeBayアカウント基準
  if (!actor) return Response.json({ ok: false, connected: false, version: OPTIMIZE_VERSION, optimized: [] });
  let optimized: string[] = [];
  try {
    const map = (await kv.hgetall<Record<string, string>>(OPT_MAP_KEY(actor))) ?? {};
    optimized = Object.entries(map)
      .filter(([, v]) => String(v) === OPTIMIZE_VERSION)
      .map(([id]) => id);
  } catch {
    /* フェイルオープン：取得失敗時は未最適化扱い（ボタンは通常表示） */
  }
  return Response.json(
    { ok: true, version: OPTIMIZE_VERSION, optimized },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function POST(req: Request) {
  // 出品の改訂は出品に使ったeBayアカウント(ebayActor=共有はオーナー)基準。権限/プランは本人(viewer)で再判定＝直叩き防止。
  const { viewer, ebayActor, owner, isMember } = await getTeamContext();
  const actor = ebayActor;
  if (!actor) return Response.json({ ok: false, connected: false });
  const teamOp = isMember && !!owner && owner !== viewer;
  if (teamOp && owner && !(await hasPerm(owner, viewer, "list"))) {
    return Response.json({ ok: false, error: "このチームでの最適化の権限がありません。" }, { status: 403 });
  }
  if (!teamOp && !(await canAutoList())) {
    return Response.json({ ok: false, needsPlan: true, error: "この操作にはeBay出品プラン（ライト以上）が必要です。" }, { status: 403 });
  }
  const token = await getValidAccessToken(actor);
  if (!token) return Response.json({ ok: false, connected: false });

  // レート制限（KV障害時はフェイルオープン＝出品操作は止めない）。
  try {
    const { success } = await rl.limit(actor);
    if (!success) {
      return Response.json({ ok: false, error: "本日の最適化の上限に達しました。また明日お試しください。" }, { status: 429 });
    }
  } catch {
    /* フェイルオープン */
  }

  const { productId } = (await req.json().catch(() => ({}))) as { productId?: string };
  const id = (productId || "").trim();
  if (!id || id.length > 256) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });

  // 同テンプレ版で最適化済みなら no-op（再実行で無駄なeBay書き込みをしない）。
  try {
    const cur = await kv.hget<string>(OPT_MAP_KEY(actor), id);
    if (String(cur) === OPTIMIZE_VERSION) {
      return Response.json({ ok: true, alreadyOptimized: true, version: OPTIMIZE_VERSION });
    }
  } catch {
    /* フェイルオープン：判定失敗時はそのまま最適化を試す（PUTは冪等） */
  }

  const product = await getProductById(id);
  if (!product) return Response.json({ ok: false, error: "商品が見つかりませんでした。" }, { status: 404 });

  // その商品の出品に使われたSKU（deal.sku）。旧データは決定的SKU rr-{商品ID} にフォールバック。
  const sku = (await getListingSku(actor, id)) ?? skuForProduct(id);

  // 決定論テンプレで最適化パラメータを生成（AI不使用）。
  const title = buildOptimizedTitle(product);
  const descriptionHtml = descriptionToHtml(buildOptimizedDescription(product));
  const aspects = buildOptimizedAspects(product, product.category);

  // ① 在庫アイテムを改訂（タイトル・説明・Item Specifics）。価格・数量・状態・画像は不変。
  const inv = await reviseInventoryItemContent(token, sku, { title, descriptionHtml, aspects });
  if (!inv.ok) {
    const f = friendlyEbayError(inv.error);
    if (!f.known) await recordAutoError({ where: "ebay_optimize_inventory", message: f.message, errorDetail: inv.error, productId: id, actor });
    return Response.json({ ok: false, error: f.message, errorKind: f.known ? "known" : "unexpected", errorDetail: inv.error });
  }

  // ② 公開中の説明をオファー側にも反映（offer.listingDescription が優先されるため）。
  //    ここが失敗すると説明が反映しきれない＝最適化未完。フラグは立てず再実行できるようにする（①は冪等）。
  const off = await updateOfferListingDescription(token, sku, descriptionHtml);
  if (!off.ok) {
    const f = friendlyEbayError(off.error);
    if (!f.known) await recordAutoError({ where: "ebay_optimize_offer", message: f.message, errorDetail: off.error, productId: id, actor });
    return Response.json({ ok: false, error: f.message, errorKind: f.known ? "known" : "unexpected", errorDetail: off.error });
  }

  // 最適化済みフラグ（版つき）を保存。失敗しても最適化自体は成功（次回また実行されるだけ）。
  try {
    await kv.hset(OPT_MAP_KEY(actor), { [id]: OPTIMIZE_VERSION });
    await kv.expire(OPT_MAP_KEY(actor), OPT_MAP_TTL);
  } catch {
    /* noop */
  }

  return Response.json({ ok: true, version: OPTIMIZE_VERSION });
}
