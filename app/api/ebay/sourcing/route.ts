import { kv } from "@vercel/kv";
import { Ratelimit } from "@upstash/ratelimit";
import { getTeamContext } from "../../../lib/auth/teamActor";
import { listSourcingForUser, recordSourcing, markPurchased, removeSourcing } from "../../../lib/ebay/sourcing";
import { listListedProductIds } from "../../../lib/ebay/stats";

// マイページ「仕入れ中の商品」一覧と、その記録/印付け/取消。アカウント単位の KV ハッシュ ebay_sourcing を読み書きする。
// eBay もカタログも叩かない。ログイン時は actor=acct:{uuid} なので別端末でも同じ仕入れ中が返る。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 濫用防止: 書き込み(POST)は1アクター60回/10分。ユニークproductIdを大量addして ebay_sourcing を肥大化させるのを防ぐ。
const rl = new Ratelimit({ redis: kv, limiter: Ratelimit.slidingWindow(60, "10 m"), prefix: "rl:sourcing:actor", analytics: false });

// GET: 仕入れ中（楽天で仕入れる押下・未出品）の一覧。既に出品済み(deals)に入ったものは除外＝出品中一覧へ移る。
export async function GET() {
  const { dataActor: actor } = await getTeamContext(); // チーム共有：仕入れ中も全員で同じ一覧
  if (!actor) return Response.json({ ok: false, items: [] }, { headers: { "Cache-Control": "private, no-store" } });
  const [items, listed] = await Promise.all([listSourcingForUser(actor), listListedProductIds(actor)]);
  const listedSet = new Set(listed);
  return Response.json(
    { ok: true, items: items.filter((x) => !listedSet.has(x.id)) },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

// POST: { action: "add"|"purchased"|"remove", productId, title?, imageUrl?, purchase?, points? }
export async function POST(req: Request) {
  const { viewer, dataActor: actor } = await getTeamContext();
  if (!actor || !viewer) return Response.json({ ok: false }, { status: 401 });
  // レート制限は本人(viewer)単位で濫用防止。仕入れ中データは共有名前空間(actor)へ。
  try {
    const { success } = await rl.limit(viewer);
    if (!success) return Response.json({ ok: false, error: "しばらくしてからお試しください。" }, { status: 429 });
  } catch { /* フェイルオープン */ }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    productId?: string;
    title?: string;
    imageUrl?: string;
    purchase?: number;
    points?: number;
  };
  const productId = (body.productId || "").trim();
  // 非空＋妥当長のみ受理（巨大な productId をキーにして肥大化させるのを防ぐ）。
  if (!productId || productId.length > 256) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });

  // 「楽天で仕入れる」押下時に仕入れ中として記録（表示用スナップショット付き）。
  if (body.action === "add") {
    await recordSourcing(actor, productId, {
      title: (body.title || "").slice(0, 200),
      imageUrl: body.imageUrl,
      purchase: Number(body.purchase) > 0 ? Number(body.purchase) : 0,
      points: Number(body.points) > 0 ? Number(body.points) : 0,
      addedAt: new Date().toISOString(),
    });
    return Response.json({ ok: true });
  }

  if (body.action === "purchased") {
    await markPurchased(actor, productId);
    return Response.json({ ok: true });
  }

  if (body.action === "remove") {
    await removeSourcing(actor, productId);
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false, error: "不明な操作です。" }, { status: 400 });
}
