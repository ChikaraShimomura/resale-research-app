import { kvReadOnly } from "../../lib/kv";
import { ProfitProduct } from "../../lib/profitFilter";

// KVを読むだけ。計算・外部API呼び出しは一切しない。読み取り専用トークンを使用。
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [profitable, lastUpdated, stats] = await Promise.all([
      kvReadOnly.get<ProfitProduct[]>("profitable_products"),
      kvReadOnly.get<string>("last_updated"),
      kvReadOnly.get<Record<string, unknown>>("refresh_stats"),
    ]);

    if (profitable && profitable.length > 0) {
      // 各商品の出品クリック回数（ライバル数の目安）を pipeline でまとめて付与。
      // これでカード側の個別 fetch を省き、「ライバルの少ない順」ソートも可能に。
      try {
        const pipe = kvReadOnly.pipeline();
        profitable.forEach((p) => pipe.scard(`listing_actors:${p.id}`));
        const counts = (await pipe.exec()) as number[];
        profitable.forEach((p, i) => { p.listingCount = counts?.[i] ?? 0; });
      } catch {
        profitable.forEach((p) => { p.listingCount = 0; });
      }

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
