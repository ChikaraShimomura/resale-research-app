import { kv } from "@vercel/kv";
import { cookies } from "next/headers";

// 自分の端末(rr_did)の「出品した」寄与を全商品から取り消す（テスト押下のクリーンアップ用）。
// アクター単位の SREM のみなので、他人のデータには一切触れない＝秘密鍵不要で安全。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const actor = (await cookies()).get("rr_did")?.value;
  if (!actor) return Response.json({ ok: false, removed: 0 });

  let removed = 0;
  let cursor = 0;
  try {
    do {
      const [next, keys] = await kv.scan(cursor, { match: "listing_actors:*", count: 200 });
      cursor = Number(next);
      for (const key of keys) {
        const n = await kv.srem(key, actor);
        if (n) removed++;
      }
    } while (cursor !== 0);
  } catch {
    /* noop */
  }
  return Response.json({ ok: true, removed });
}
