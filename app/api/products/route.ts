import { kv } from "@vercel/kv";
import { ProfitProduct } from "../../lib/profitFilter";

// KVを読むだけ。計算・外部API呼び出しは一切しない。
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [profitable, lastUpdated, stats] = await Promise.all([
      kv.get<ProfitProduct[]>("profitable_products"),
      kv.get<string>("last_updated"),
      kv.get<Record<string, unknown>>("refresh_stats"),
    ]);

    if (profitable && profitable.length > 0) {
      return Response.json(
        { products: profitable, lastUpdated, stats },
        // 独自データなので共有CDNにキャッシュさせない（将来の認証/レート制限がエッジで回避されるのを防ぐ）
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }

    // KVにデータがない場合は空を返す
    return Response.json(
      { products: [], lastUpdated: null },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return Response.json(
      { products: [], lastUpdated: null },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
