// 管理者専用：中古利益カタログの「健康診断」。配信(/catalog)と同じ掲載ゲートを再現し、
// 各ゲートが何件落としているか＝「ある日いきなり件数が減った」を数字で検知する。読み取り専用。
//
// ⚠️ ここのゲートは app/catalog/page.tsx の base フィルタと一致させること
//    （ebayConfirmed・profitRate>=5・!isProhibited。per-actorの hidden は個人差なので除外）。
import { getCurrentUserEmail } from "../../../lib/auth/plan";
import { isAdmin } from "../../../lib/auth/admin";
import { getUsedCatalog, isProhibited, isJunk } from "../../../lib/usedCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_PROFIT_RATE = 5; // /catalog と同じ：純利益率5%未満は非掲載

export async function GET() {
  if (!isAdmin(await getCurrentUserEmail())) return Response.json({ ok: false }, { status: 404 });

  const all = await getUsedCatalog(); // used_catalog（profitJpyが数値の有効分）
  const total = all.length;
  const drops = { notConfirmed: 0, profitThin: 0, prohibited: 0 };
  const byGenre: Record<string, number> = {};
  let junk = 0;
  let displayed = 0;

  for (const p of all) {
    if (isJunk(p.condition)) junk++;
    // 配信ゲート（/catalog と同順）。最初に落ちた理由だけ計上する。
    if (!p.ebayConfirmed) { drops.notConfirmed++; continue; } // 型番一致で相場確定していない＝目安のみ→非掲載
    if (!(p.profitRate >= MIN_PROFIT_RATE)) { drops.profitThin++; continue; } // 利益率が薄い
    if (isProhibited(`${p.brand} ${p.name}`)) { drops.prohibited++; continue; } // 発送不可(危険物)
    displayed++;
    const cat = p.cat || "中古";
    byGenre[cat] = (byGenre[cat] || 0) + 1;
  }

  const confirmed = total - drops.notConfirmed;

  return Response.json({
    ok: true,
    health: {
      at: new Date().toISOString(),
      total,       // used_catalog 総数
      confirmed,   // 型番一致で相場確定(ebayConfirmed)
      displayed,   // 実際に /catalog に掲載される数
      junk,        // ジャンク件数（参考・掲載は許可）
      drops,       // 各ゲートで落ちた数
      byGenre,     // 掲載分のジャンル内訳
    },
  });
}
