import { kvReadOnly } from "../../lib/kv";
import { ProfitProduct } from "../../lib/profitFilter";
import { isSold } from "../../lib/sold";

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
      // 掲載ゲート＋満了(SOLD)隠し：各商品で ref_gallery(get) と 出品者数(scard listing_actors) をまとめて引く。
      //  ・参考画像(ref_gallery done & 画像≥1)が揃った商品だけ掲載（抽出→画像取得→掲載）
      //  ・出品者が SOLD_THRESHOLD 人以上＝満了は一覧から隠す（共食い防止の上限）
      //  ・手動復活(restored)は管理者が明示的に出したものなのでゲート/満了を免除
      let ready = merged;
      try {
        const pipe = kvReadOnly.pipeline();
        merged.forEach((p) => { pipe.get(`ref_gallery:${p.id}`); pipe.scard(`listing_actors:${p.id}`); });
        const res = (await pipe.exec()) as unknown[];
        ready = merged.filter((p, i) => {
          p.listingCount = Number(res?.[i * 2 + 1] ?? 0); // 出品者数（満了判定の元・カードでも使える）
          if (p.restored) return true;
          if (isSold(p, p.listingCount)) return false;   // 満了は隠す
          let r = res?.[i * 2] as { status?: string; urls?: string[] } | string | null;
          if (typeof r === "string") { try { r = JSON.parse(r); } catch { r = null; } }
          return !!r && typeof r === "object" && r.status === "done" && Array.isArray(r.urls) && r.urls.length > 0;
        });
      } catch {
        // 照会に失敗したらゲートを掛けない（フェイルオープン＝KV障害で一覧が空にならないように）
        ready = merged;
      }

      // セーフティ：ゲートで全消え(ギャラリーワーカー停止・全TTL失効など)した時はブラックアウトを避け全件出す。
      if (ready.length === 0 && merged.length > 0) ready = merged;

      return Response.json(
        { products: ready, lastUpdated, stats },
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
