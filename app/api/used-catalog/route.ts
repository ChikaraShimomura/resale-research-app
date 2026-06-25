import { getUsedCatalog, type UsedCatalogItem } from "../../lib/usedCatalog";
import { canViewCatalog } from "../../lib/auth/plan";
import { recordFunnelEvent } from "../../lib/funnelServer";

// 中古利益カタログの配信。KVを読むだけ（計算・外部API無し・読み取り専用トークン）。
export const dynamic = "force-dynamic";

// 未購読(free)向けマスク：許可リスト方式で安全フィールドだけ返す＝仕入れ値・仕入れ先URL・型番・想定売値は渡さない。
// 見せるのは ブランド/ジャンル/状態/利益率(ティーザー) だけ。
function maskUsed(p: UsedCatalogItem): UsedCatalogItem {
  return {
    modelKey: p.modelKey,
    brand: p.brand,
    name: p.name,
    code: "",
    cat: p.cat,
    ebayMedianJpy: 0,
    buyJpy: 0,
    condition: p.condition,
    profitJpy: 0,
    profitRate: p.profitRate, // 利益率だけティーザー
    hardoffUrl: "",
    imageUrl: "",
    site: p.site,
    masked: true,
  } as UsedCatalogItem & { masked: true };
}

export async function GET() {
  const canView = await canViewCatalog();
  if (!canView) await recordFunnelEvent("paywall_hit");
  const items = await getUsedCatalog();
  return Response.json(
    {
      items: canView ? items : items.map(maskUsed),
      count: items.length,
      masked: !canView,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
