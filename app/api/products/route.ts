import { kvReadOnly } from "../../lib/kv";
import { ProfitProduct } from "../../lib/profitFilter";
import { isSold } from "../../lib/sold";
import { landedCost } from "../../lib/ebay/landedCost";

// カタログに保存されている realProfit は「国際送料前」の粗利。配信時にここで国際送料(目安)＋米国関税を
// 差し引いて“本当に手元に残る利益”に直す（単一ソース＝二重計上しない／再ビルド不要で制度変更に即追従）。
const USD_JPY = 155;
function withLandedCost(p: ProfitProduct): ProfitProduct {
  const valueUsd = (p.realAvgPrice || 0) / USD_JPY;
  const landed = landedCost(p.category, valueUsd);
  const effBuy = (p.source?.price ?? 0) + (p.source?.shippingJpy ?? 0) - (p.source?.pointAmount ?? 0);
  const netProfit = Math.round((p.realProfit ?? 0) - landed.subtractJpy);
  const netRate = effBuy > 0 ? Math.round((netProfit / effBuy) * 100) : (p.realProfitRate ?? 0);
  return { ...p, realProfit: netProfit, realProfitRate: netRate };
}

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
    const [profitable, lastUpdated, stats, restored, wmHash, srcStatus] = await Promise.all([
      kvReadOnly.get<ProfitProduct[]>("profitable_products"),
      kvReadOnly.get<string>("last_updated"),
      kvReadOnly.get<Record<string, unknown>>("refresh_stats"),
      getRestoredProducts(),
      // 透かし入り商品の記録（checkWatermarks.mjs が Haiku 検知で作る {id:"1"=透かし/"0"=クリーン}）。
      kvReadOnly.hgetall<Record<string, unknown>>("product_watermark").catch(() => ({})),
      // 仕入れ元(楽天)の売切/削除フラグ（住宅IPワーカー sourceLivenessWorker が実ページ確認して記録）。
      kvReadOnly.hgetall<Record<string, unknown>>("catalog_source_status").catch(() => ({})),
    ]);

    // 透かし入り（値が "1"/1）の商品IDは一覧から除外する（商品データは消さない＝可逆。記録ベース）。
    const watermarkedIds = new Set(
      Object.entries(wmHash ?? {}).filter(([, v]) => v === "1" || v === 1).map(([id]) => id)
    );

    // 楽天で売切/削除の商品IDは一覧から隠す（実ページ確認＝権威。在庫復活でワーカーが解除→自動で戻る）。
    const deadSourceIds = new Set(
      Object.entries(srcStatus ?? {})
        .filter(([, v]) => {
          let s: unknown = v;
          if (typeof s === "string") { try { s = JSON.parse(s); } catch { return false; } }
          const st = (s as { status?: string })?.status;
          return st === "soldout" || st === "dead";
        })
        .map(([id]) => id)
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

      // 国際送料・米国関税を差し引いて利益を正直化。
      //  ・net≤0(構造赤字)は隠す
      //  ・$800超は米国DDP関税を郵便のZonosで処理できず初心者が扱えない＝カタログから除外
      // (restoredは管理者裁量で常に残す)
      const MAX_DECLARED_USD = 800;
      const hasImage = (p: ProfitProduct) => !!(p.imageUrl && String(p.imageUrl).trim()); // 「画像無し」カードを出さない
      let priced = ready
        .map(withLandedCost)
        .filter(hasImage)
        .filter(
          (p) =>
            p.restored ||
            ((p.realProfit ?? 0) > 0 &&
              (p.realAvgPrice || 0) / USD_JPY <= MAX_DECLARED_USD &&
              !deadSourceIds.has(p.id)) // 楽天で売切/削除は隠す
        );
      if (priced.length === 0 && ready.length > 0) priced = ready.map(withLandedCost).filter(hasImage); // 全消しは避ける(画像ありのみ)

      return Response.json(
        { products: priced, lastUpdated, stats },
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
