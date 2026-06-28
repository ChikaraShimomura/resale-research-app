import { kvReadOnly } from "../../lib/kv";
import { ProfitProduct } from "../../lib/profitFilter";
import { isSold } from "../../lib/sold";
import { applyDisplayProfit } from "../../lib/displayProfit";
import { applySoldComp } from "../../lib/ebay/soldComp";
import { canViewCatalog } from "../../lib/auth/plan";
import { recordFunnelEvent } from "../../lib/funnelServer";
import { USD_JPY } from "../../lib/ebay/landedCostCore.mjs"; // SSOT(env駆動/既定155)に統一

// 配信時に realProfit を「現金純利益（ポイントは外す＋国際送料/米国関税を差し引く）」に直す。
// 変換は app/lib/displayProfit.ts に一本化（ランキング/商品詳細と同一ロジック＝表示の単一ソース）。
// 掲載可否(現金で稼げる/ポイ活専用/掲載しない)も applyDisplayProfit が profitKind で判定する。

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

// 未購読(free)向けマスク：許可リスト方式で安全フィールドだけ再構築する＝利益額・価格・仕入れ先URL・
// coreKeyword・eBay相場/照合/落札リンク等の「actionableな研究」はクライアントに一切渡さない（漏洩防止）。
// 見せるのは タイトル/画像/カテゴリ/利益率(ティーザー)/出品者数 だけ。
function maskProduct(p: ProfitProduct): ProfitProduct {
  return {
    id: p.id,
    title: p.title,
    imageUrl: p.imageUrl,
    category: p.category,
    realProfitRate: p.realProfitRate, // 利益率だけティーザーとして見せる
    listingCount: p.listingCount,
    masked: true,
    // 型を満たすためのゼロ/空のみ（機微は渡さない）
    realAvgPrice: 0,
    realProfit: 0,
    realCount: 0,
    source: { site: "rakuten", siteName: "", price: 0, url: "" },
  } as ProfitProduct;
}

export async function GET() {
  // 利益商品は購読者(＋身内/管理者)はフル配信。未購読(free)は「リスト見せ・数値マスク」＝
  // タイトル/画像/利益率だけのティーザーを返し、利益額・価格・仕入れ先はサーバー側で除去(maskProduct)。
  // PAYWALL_ENABLED が OFF の間は canViewCatalog が常に true（＝全員フル＝既存挙動）。
  const canView = await canViewCatalog();
  if (!canView) await recordFunnelEvent("paywall_hit"); // 収益ファネル：未購読がマスク壁に到達
  try {
    const [profitable, lastUpdated, stats, restored, wmHash, srcStatus, overpricedArr] = await Promise.all([
      kvReadOnly.get<ProfitProduct[]>("profitable_products"),
      kvReadOnly.get<string>("last_updated"),
      kvReadOnly.get<Record<string, unknown>>("refresh_stats"),
      getRestoredProducts(),
      // 透かし入り商品の記録（checkWatermarks.mjs が Haiku 検知で作る {id:"1"=透かし/"0"=クリーン}）。
      kvReadOnly.hgetall<Record<string, unknown>>("product_watermark").catch(() => ({})),
      // 仕入れ元の売切/削除フラグ（住宅IPワーカー sourceLivenessWorker が実ページ確認して記録）。
      kvReadOnly.hgetall<Record<string, unknown>>("catalog_source_status").catch(() => ({})),
      // 箱価格(複数タイプ)で原価誤認＝不採算の商品ID（refresh が記録）。一覧からも隠す（防御的・通常はカタログ除外済み）。
      kvReadOnly.get<string[]>("catalog_overpriced_ids").catch(() => []),
    ]);

    // 透かし入り（値が "1"/1）の商品IDは一覧から除外する（商品データは消さない＝可逆。記録ベース）。
    const watermarkedIds = new Set(
      Object.entries(wmHash ?? {}).filter(([, v]) => v === "1" || v === 1).map(([id]) => id)
    );

    // 仕入れ元で売切/削除の商品IDは一覧から隠す（実ページ確認＝権威。在庫復活でワーカーが解除→自動で戻る）。
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
    // 箱価格で不採算の商品も一覧から隠す（同じ「見せない」集合に合流）。
    for (const id of Array.isArray(overpricedArr) ? overpricedArr : []) deadSourceIds.add(id);

    // 復活商品をカタログへ合流（カタログに既にあるidは重複させない）。復活分は先頭側（新着扱い）。
    const base = Array.isArray(profitable) ? profitable : [];
    const haveIds = new Set(base.map((p) => p?.id));
    const merged = [...restored.filter((p) => p?.id && !haveIds.has(p.id)), ...base].filter(
      (p) => !watermarkedIds.has(p?.id)
    );

    if (merged.length > 0) {
      // 掲載ゲート＋満了(SOLD)隠し：各商品で ref_gallery(get) と 出品者数(scard listing_actors) をまとめて引く。
      //  ・落札確定(soldVerified)品は表示画像(imageUrl)があれば掲載＝ref_galleryは「出品時のギャラリー候補」用で表示要件ではない。
      //    （落札発掘では新品が常に入る。ギャラリー取得を待つと新品が永久に非表示でカタログが空になる→ワーカーが後追いで埋める。
      //     出品フロー(prepare/edit)は ref_gallery 未取得でもAPI画像にフォールバックするので出品も可能）
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
          if (p.soldVerified) return true;               // 落札確定品はギャラリーを待たず掲載（imageUrlの有無は後段 hasImage で担保）
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

      // eBay直近落札 × 仕入れ元で利益を再判定（新鮮な落札中央値がある商品だけ反映・無ければ現在出品相場のまま）。
      ready = await applySoldComp(ready);

      // 国際送料・米国関税を差し引いて利益を正直化。
      //  ・net≤0(構造赤字)は隠す
      //  ・$800超は米国DDP関税を郵便のZonosで処理できず初心者が扱えない＝カタログから除外
      // (restoredは管理者裁量で常に残す)
      const MAX_DECLARED_USD = 800;
      const hasImage = (p: ProfitProduct) => !!(p.imageUrl && String(p.imageUrl).trim()); // 「画像無し」カードを出さない
      let priced = ready
        .map(applyDisplayProfit)
        .filter(hasImage)
        .filter(
          (p) =>
            p.restored ||
            (p.soldVerified && // ★eBay落札をAI画像で確認できた商品だけ掲載（未確定＝落札実績が確認できない品は出さない・ユーザー方針2026-06-23）
              p.profitKind !== "none" && // cash(現金純利益率≥10%)＋point(ポイ活専用=現金<10%でもポイント込みで損しない)を掲載。ポイント込みでも赤字は除外。
              (p.realAvgPrice || 0) / USD_JPY <= MAX_DECLARED_USD &&
              !deadSourceIds.has(p.id)) // 仕入れ元で売切/削除は隠す
        );
      // 確定品が0でも未確定は出さない（「確実に実績あり」方針）。手動復活(restored)だけは救済。
      if (priced.length === 0 && ready.length > 0) {
        priced = ready.map(applyDisplayProfit).filter(hasImage).filter((p) => p.restored && !deadSourceIds.has(p.id));
      }

      return Response.json(
        { products: canView ? priced : priced.map(maskProduct), lastUpdated, stats, masked: !canView },
        // 独自データなので共有CDNにキャッシュさせない（将来の認証/レート制限がエッジで回避されるのを防ぐ）
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }

    // KVにデータがない場合は空を返す
    return Response.json(
      { products: [], lastUpdated: null, masked: !canView },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return Response.json(
      { products: [], lastUpdated: null, masked: !canView },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
