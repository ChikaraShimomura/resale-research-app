import { kvReadOnly } from "../../lib/kv";
import { ProfitProduct } from "../../lib/profitFilter";

// KVを読むだけ。計算・外部API呼び出しは一切しない。読み取り専用トークンを使用。
export const dynamic = "force-dynamic";

// 手動復活した商品(restored_products)を取り出す。リフレッシュが処理中にカタログを何度も上書きしても、
// 復活商品が検索から消えないよう、配信のたびにここで必ず合流させる（恒久対応・タイミング非依存）。
async function getRestoredProducts(): Promise<ProfitProduct[]> {
  try {
    const h = (await kvReadOnly.hgetall<Record<string, unknown>>("restored_products")) ?? {};
    const out: ProfitProduct[] = [];
    for (const v of Object.values(h)) {
      let p: unknown = v;
      if (typeof p === "string") {
        try { p = JSON.parse(p); } catch { continue; }
      }
      if (p && typeof p === "object" && (p as ProfitProduct).id) out.push(p as ProfitProduct);
    }
    return out;
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const [profitable, lastUpdated, stats, restored, wmHash] = await Promise.all([
      kvReadOnly.get<ProfitProduct[]>("profitable_products"),
      kvReadOnly.get<string>("last_updated"),
      kvReadOnly.get<Record<string, unknown>>("refresh_stats"),
      getRestoredProducts(),
      // 透かし入り商品の記録（checkWatermarks.mjs が Haiku 検知で作る {id:"1"=透かし/"0"=クリーン}）。
      kvReadOnly.hgetall<Record<string, unknown>>("product_watermark").catch(() => ({})),
    ]);

    // 透かし入り（値が "1"/1）の商品IDは一覧から除外する（商品データは消さない＝可逆。記録ベース）。
    const watermarkedIds = new Set(
      Object.entries(wmHash ?? {}).filter(([, v]) => v === "1" || v === 1).map(([id]) => id)
    );

    // 復活商品をカタログへ合流（カタログに既にあるidは重複させない）。復活分は先頭側（新着扱い）。
    const base = Array.isArray(profitable) ? profitable : [];
    const haveIds = new Set(base.map((p) => p?.id));
    const merged = [...restored.filter((p) => p?.id && !haveIds.has(p.id)), ...base].filter(
      (p) => !watermarkedIds.has(p?.id)
    );

    if (merged.length > 0) {
      // 各商品の出品クリック回数（ライバル数の目安）を pipeline でまとめて付与。
      try {
        const pipe = kvReadOnly.pipeline();
        merged.forEach((p) => pipe.scard(`listing_actors:${p.id}`));
        const counts = (await pipe.exec()) as number[];
        merged.forEach((p, i) => { p.listingCount = counts?.[i] ?? 0; });
      } catch {
        merged.forEach((p) => { p.listingCount = 0; });
      }

      return Response.json(
        { products: merged, lastUpdated, stats },
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
