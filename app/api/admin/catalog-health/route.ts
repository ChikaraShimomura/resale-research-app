// 管理者専用：カタログ「健康診断」。配信(/api/products)と同じ掲載ゲートを再現し、
// 各ゲートが何件落としているかを数える＝「ある日いきなり件数が減った」をサプライズでなく数字で検知する。
// 読み取り専用（出品やKVを変更しない）。/admin から呼んで表示する。
//
// ⚠️ ここのゲート順は app/api/products/route.ts と一致させること（片方だけ変えるとズレる）。
import { getCurrentUserEmail } from "../../../lib/auth/plan";
import { isAdmin } from "../../../lib/auth/admin";
import { kvReadOnly } from "../../../lib/kv";
import { ProfitProduct } from "../../../lib/profitFilter";
import { applySoldComp } from "../../../lib/ebay/soldComp";
import { applyDisplayProfit } from "../../../lib/displayProfit";
import { isSold } from "../../../lib/sold";
import { USD_JPY } from "../../../lib/ebay/landedCostCore.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DECLARED_USD = 800;

export async function GET() {
  if (!isAdmin(await getCurrentUserEmail())) return Response.json({ ok: false }, { status: 404 });

  const [profitable, restoredH, wmH, srcH, overArr, lastUpdated, stats] = await Promise.all([
    kvReadOnly.get<ProfitProduct[]>("profitable_products"),
    kvReadOnly.hgetall<Record<string, unknown>>("restored_products").catch(() => ({})),
    kvReadOnly.hgetall<Record<string, unknown>>("product_watermark").catch(() => ({})),
    kvReadOnly.hgetall<Record<string, unknown>>("catalog_source_status").catch(() => ({})),
    kvReadOnly.get<string[]>("catalog_overpriced_ids").catch(() => []),
    kvReadOnly.get<string>("last_updated"),
    kvReadOnly.get<Record<string, unknown>>("refresh_stats"),
  ]);

  const base = Array.isArray(profitable) ? profitable : [];
  const restored: ProfitProduct[] = [];
  for (const v of Object.values(restoredH ?? {})) {
    let p: ProfitProduct | null = null;
    try { p = (typeof v === "string" ? JSON.parse(v) : v) as ProfitProduct; } catch { continue; }
    if (p?.id) restored.push(p);
  }
  const haveIds = new Set(base.map((p) => p?.id));
  const watermarked = new Set(Object.entries(wmH ?? {}).filter(([, v]) => v === "1" || v === 1).map(([id]) => id));
  const dead = new Set<string>();
  for (const [id, v] of Object.entries(srcH ?? {})) {
    let s: unknown = v;
    if (typeof s === "string") { try { s = JSON.parse(s); } catch { continue; } }
    const st = (s as { status?: string })?.status;
    if (st === "soldout" || st === "dead") dead.add(id);
  }
  for (const id of Array.isArray(overArr) ? overArr : []) dead.add(id);

  const mergedAll = [...restored.filter((p) => p?.id && !haveIds.has(p.id)), ...base];
  const total = mergedAll.length;
  const soldVerifiedCount = mergedAll.filter((p) => p?.soldVerified).length;
  const drops = { watermark: 0, soldFull: 0, gallery: 0, noImage: 0, notVerified: 0, profitThin: 0, over800: 0, deadSource: 0 };

  // ① 透かし除外
  const merged = mergedAll.filter((p) => !watermarked.has(p?.id));
  drops.watermark = total - merged.length;

  // ② 掲載ゲート（満了＝出品者数 SOLD_THRESHOLD 以上 / soldVerifiedはギャラリー免除 / それ以外はref_gallery必須）
  const pipe = kvReadOnly.pipeline();
  merged.forEach((p) => { pipe.get(`ref_gallery:${p.id}`); pipe.scard(`listing_actors:${p.id}`); });
  const res = (await pipe.exec()) as unknown[];
  const ready: ProfitProduct[] = [];
  merged.forEach((p, i) => {
    const lc = Number(res?.[i * 2 + 1] ?? 0);
    p.listingCount = lc;
    if (p.restored) { ready.push(p); return; }
    if (isSold(p, lc)) { drops.soldFull++; return; }
    if (p.soldVerified) { ready.push(p); return; }
    let r = res?.[i * 2] as { status?: string; urls?: string[] } | string | null;
    if (typeof r === "string") { try { r = JSON.parse(r); } catch { r = null; } }
    if (!!r && typeof r === "object" && r.status === "done" && Array.isArray(r.urls) && r.urls.length > 0) ready.push(p);
    else drops.gallery++;
  });

  // ③ 利益/価格/画像/落札確認ゲート（配信と同じ順）
  const priced = (await applySoldComp(ready)).map(applyDisplayProfit);
  let displayed = 0;
  for (const p of priced) {
    if (p.restored) { displayed++; continue; }
    if (!(p.imageUrl && String(p.imageUrl).trim())) { drops.noImage++; continue; }
    if (!p.soldVerified) { drops.notVerified++; continue; }
    if (p.profitKind === "none" || p.profitKind == null) { drops.profitThin++; continue; }
    if ((p.realAvgPrice || 0) / USD_JPY > MAX_DECLARED_USD) { drops.over800++; continue; }
    if (dead.has(p.id)) { drops.deadSource++; continue; }
    displayed++;
  }

  return Response.json({
    ok: true,
    health: {
      at: new Date().toISOString(),
      catalogTotal: total,        // profitable_products(+restored)の総数
      soldVerified: soldVerifiedCount,
      displayed,                  // 実際に掲載される数
      drops,                      // 各ゲートで落ちた数
      lastUpdated: lastUpdated ?? null,
      refreshFunnel: (stats as { funnel?: unknown })?.funnel ?? null, // 取得側(refresh)の楽天0件率など
    },
  });
}
