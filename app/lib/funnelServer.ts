// サーバー側からファネル/登録イベントを1件記録する（/api/track と同じキー設計）。
// Server Action や Route Handler から、クライアントの logEvent を経由せず確実に計上したい時に使う
// （例：サインイン成功の瞬間＝確実な会員登録コンバージョン）。allowlist 外は無視・失敗は黙って捨てる。
import { kv } from "@vercel/kv";
import { cookies } from "next/headers";
import { TRACKED_EVENTS, FUNNEL_TTL, jstDate, evcKey, evuKey } from "./funnel";

export async function recordFunnelEvent(event: string): Promise<void> {
  if (!TRACKED_EVENTS.includes(event)) return; // 未知イベントは無視（無限キー生成・濫用防止）
  try {
    const date = jstDate();
    const actor = (await cookies()).get("rr_did")?.value || "anon";
    await Promise.all([
      kv.incr(evcKey(date, event)),
      kv.expire(evcKey(date, event), FUNNEL_TTL),
      kv.sadd(evuKey(date, event), actor),
      kv.expire(evuKey(date, event), FUNNEL_TTL),
    ]);
  } catch {
    /* 集計失敗は黙って捨てる（ユーザー体験を妨げない） */
  }
}
