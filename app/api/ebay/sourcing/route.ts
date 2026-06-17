import { getActorId } from "../../../lib/auth/actor";
import { listSourcingForUser, recordSourcing, markPurchased, removeSourcing } from "../../../lib/ebay/sourcing";
import { listListedProductIds } from "../../../lib/ebay/stats";

// マイページ「仕入れ中の商品」一覧と、その記録/印付け/取消。アカウント単位の KV ハッシュ ebay_sourcing を読み書きする。
// eBay もカタログも叩かない。ログイン時は actor=acct:{uuid} なので別端末でも同じ仕入れ中が返る。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 仕入れ中（楽天で仕入れる押下・未出品）の一覧。既に出品済み(deals)に入ったものは除外＝出品中一覧へ移る。
export async function GET() {
  const actor = await getActorId();
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
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: false }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    productId?: string;
    title?: string;
    imageUrl?: string;
    purchase?: number;
    points?: number;
  };
  const productId = (body.productId || "").trim();
  if (!productId) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });

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
