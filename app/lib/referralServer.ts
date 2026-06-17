import { kv } from "@vercel/kv";
import { cookies } from "next/headers";

// 紹介(リファラル)計測。インフルエンサーごとに /r/{code} のクリックと、その後の新規登録(成果)を集計する。
// 成果報酬は signups(新規登録数)基準で支払う想定。KV: ref_clicks:{code} / ref_signups:{code} / ref_codes(set)。
export const REF_COOKIE = "rr_ref";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90日

// 半角英数・ハイフン・アンダースコアのみ・40字まで(任意のコード文字列を安全化)。
export function sanitizeRefCode(raw: string | undefined | null): string {
  return (raw || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
}

// /r/{code} のクリックを計上（コードを集合にも登録）。
export async function recordReferralClick(code: string): Promise<void> {
  try {
    await kv.incr(`ref_clicks:${code}`);
    await kv.sadd("ref_codes", code);
  } catch {
    /* noop */
  }
}

// 新規登録時に呼ぶ。ref cookie があれば成果(signup)を1件計上し、cookieを消費して二重計上を防ぐ。
export async function captureSignupReferral(): Promise<void> {
  try {
    const jar = await cookies();
    const code = sanitizeRefCode(jar.get(REF_COOKIE)?.value);
    if (!code) return;
    await kv.incr(`ref_signups:${code}`);
    await kv.sadd("ref_codes", code);
    jar.delete(REF_COOKIE);
  } catch {
    /* noop */
  }
}

export interface ReferralStat {
  code: string;
  clicks: number;
  signups: number;
}

// 管理画面用: 全コードのクリック/登録を集計（登録数の多い順）。
export async function getReferralStats(): Promise<ReferralStat[]> {
  try {
    const codes = (await kv.smembers("ref_codes")) as string[] | null;
    if (!codes || codes.length === 0) return [];
    const pipe = kv.pipeline();
    codes.forEach((c) => {
      pipe.get(`ref_clicks:${c}`);
      pipe.get(`ref_signups:${c}`);
    });
    const res = (await pipe.exec()) as (number | string | null)[];
    return codes
      .map((c, i) => ({
        code: c,
        clicks: Number(res[i * 2] ?? 0),
        signups: Number(res[i * 2 + 1] ?? 0),
      }))
      .sort((a, b) => b.signups - a.signups || b.clicks - a.clicks);
  } catch {
    return [];
  }
}

export { COOKIE_MAX_AGE };
