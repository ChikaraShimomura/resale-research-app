import { kv } from "@vercel/kv";
import { getTeamContext } from "../../../../lib/auth/teamActor";
import { hasPerm } from "../../../../lib/team";
import { canAutoList } from "../../../../lib/auth/plan";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { withdrawListingForSku } from "../../../../lib/ebay/listing";
import { getListingSku, markStopped } from "../../../../lib/ebay/stats";
import { skuForProduct } from "../../../../lib/ebay/sellApi";
import { friendlyEbayError } from "../../../../lib/ebay/errorMessages";

// 「出品停止」: eBayの出品(オファー)を取り下げて終了し、「出品停止中一覧」へ移す。
// オファーは残す＝あとで再出品できる。Dealの記録(仕入れ額等)も保持。
// チーム共有：取り下げは出品アカウント(ebayActor)、dealの停止フラグは共有名前空間(dataActor=オーナー)。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { viewer, dataActor, ebayActor, owner, isMember } = await getTeamContext();
  if (!ebayActor) return Response.json({ ok: false, connected: false });
  // ★停止も出品操作＝権限とプランを再判定(直叩き防止)。チームメンバーは'list'権限、非チームは本人のプラン(ライト以上)。
  const teamOp = isMember && !!owner && owner !== viewer;
  if (teamOp && owner && !(await hasPerm(owner, viewer, "list"))) {
    return Response.json({ ok: false, error: "このチームでの出品停止の権限がありません。" }, { status: 403 });
  }
  if (!teamOp && !(await canAutoList())) {
    return Response.json({ ok: false, needsPlan: true, error: "この操作にはeBay出品プラン（ライト以上）が必要です。" }, { status: 403 });
  }
  const token = await getValidAccessToken(ebayActor);
  if (!token) return Response.json({ ok: false, connected: false });

  const body = (await req.json().catch(() => ({}))) as { productId?: string };
  if (!body.productId) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });

  const sku = (await getListingSku(ebayActor, body.productId)) ?? skuForProduct(body.productId);
  const r = await withdrawListingForSku(token, sku);
  if (!r.ok) {
    const f = friendlyEbayError(r.error);
    return Response.json({ ok: false, error: f.message, errorKind: f.known ? "known" : "unexpected", errorDetail: r.error });
  }

  // 出品停止中一覧へ移す（共有dealに停止フラグ stoppedAt を付与。dealが無ければ何もしない）。
  await markStopped(dataActor ?? ebayActor, body.productId);
  // 無在庫出品を停止したら、その品はカタログの非表示から戻す（もう出品していない＝再び仕入れ検討/他者が買える）。
  // 有在庫や非無在庫の停止では used_dropship に載っていないので srem は no-op（無害）。
  try { await kv.srem(`used_dropship:${dataActor ?? ebayActor}`, body.productId); } catch { /* noop */ }
  return Response.json({ ok: true, ended: r.ended });
}
