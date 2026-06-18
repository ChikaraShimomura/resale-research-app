import { kv } from "@vercel/kv";
import { Ratelimit } from "@upstash/ratelimit";
import { cookies, headers } from "next/headers";
import { sendEmail, REPORT_TO, emailConfigured } from "../../../lib/email";

// 「開発者に報告」用エンドポイント。
// POST: 出品などで予期せぬエラーが出た時、画面の「開発者に報告」ボタンから状況を送る。
//   → KV(error_reports) に積む＋運用者へメール通知。
// GET : ?secret=<CRON_SECRET> で直近の報告を取得（開発者＝Claudeがセッションで取り込んで修正するため）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIST_KEY = "error_reports";
const KEEP = 200; // 直近200件だけ保持
const TTL = 60 * 24 * 60 * 60; // 60日

const rl = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(20, "10 m"), // 1IPあたり20回/10分（濫用防止）
  prefix: "rl:report:err",
  analytics: false,
});

function clientIp(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "0.0.0.0";
}

interface ErrorReport {
  where?: string; // 例 "ebay_listing"
  message?: string; // エラーメッセージ
  steps?: { step: string; ok: boolean; error?: string }[];
  productId?: string;
  coreKeyword?: string;
  category?: unknown;
  priceUsd?: string;
  strategy?: string;
  condition?: string;
  quantity?: number;
  aspects?: Record<string, string>;
  note?: string; // ユーザーの自由記述（任意）
}

export async function POST(req: Request) {
  try {
    const h = await headers();
    const { success } = await rl.limit(clientIp(h));
    if (!success) return Response.json({ ok: false, error: "しばらくしてからお試しください。" }, { status: 429 });
  } catch {
    /* レート制限の障害はフェイルオープン */
  }

  let body: ErrorReport = {};
  try {
    body = (await req.json()) as ErrorReport;
  } catch {
    return Response.json({ ok: false, error: "本文を読み取れませんでした。" }, { status: 400 });
  }

  const h = await headers();
  const actor = (await cookies()).get("rr_did")?.value || "anon";
  const report = {
    ...body,
    actor,
    ua: h.get("user-agent")?.slice(0, 300) || "",
    ts: new Date().toISOString(),
  };

  try {
    await kv.lpush(LIST_KEY, JSON.stringify(report));
    await kv.ltrim(LIST_KEY, 0, KEEP - 1);
    await kv.expire(LIST_KEY, TTL);
  } catch {
    /* 保存失敗は黙って続行（メール通知が残る） */
  }

  // 運用者へメール通知（ベストエフォート）。
  if (emailConfigured()) {
    const stepsHtml = (report.steps ?? [])
      .map((s) => `<li>${s.ok ? "✅" : "⚠️"} ${escapeHtml(s.step)}${s.error ? `：${escapeHtml(s.error)}` : ""}</li>`)
      .join("");
    const html = `
      <div style="font-family:sans-serif;font-size:13px;line-height:1.7;color:#111">
        <h2 style="color:#2D323B;font-size:16px;margin:0 0 8px">⚠️ ユーザーからエラー報告（${escapeHtml(report.where || "unknown")}）</h2>
        <p><b>メッセージ:</b> ${escapeHtml(report.message || "(なし)")}</p>
        ${stepsHtml ? `<p><b>ステップ:</b></p><ul>${stepsHtml}</ul>` : ""}
        <p><b>商品ID:</b> ${escapeHtml(report.productId || "-")}<br>
        <b>coreKeyword:</b> ${escapeHtml(report.coreKeyword || "-")}<br>
        <b>カテゴリ:</b> ${escapeHtml(JSON.stringify(report.category ?? null))}<br>
        <b>価格(USD):</b> ${escapeHtml(report.priceUsd || "-")} / <b>売り方:</b> ${escapeHtml(report.strategy || "-")} / <b>状態:</b> ${escapeHtml(report.condition || "-")} / <b>個数:</b> ${report.quantity ?? "-"}<br>
        <b>必須項目:</b> ${escapeHtml(JSON.stringify(report.aspects ?? {}))}</p>
        ${report.note ? `<p><b>ユーザーメモ:</b> ${escapeHtml(report.note)}</p>` : ""}
        <p style="color:#6b7280;font-size:11px">端末:${escapeHtml(report.actor)} / ${escapeHtml(report.ua)}<br>${escapeHtml(report.ts)}</p>
        <p style="color:#9ca3af;font-size:11px">※ 直近の報告は GET /api/report/error?secret=&lt;CRON_SECRET&gt; で一覧取得できます。</p>
      </div>`;
    try {
      await sendEmail({
        to: REPORT_TO,
        subject: `⚠️ 出品エラー報告: ${(report.message || "unknown").slice(0, 60)}`,
        html,
      });
    } catch {
      /* メール失敗でもKVには残る */
    }
  }

  return Response.json({ ok: true });
}

// 開発者（Claude）が直近の報告を取り込むための取得API。?secret= で認証。
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  if (!secret || url.searchParams.get("secret") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const consume = url.searchParams.get("consume") === "1"; // 自動修復ジョブ用：取り込んだ分をpendingから除去
  let items: string[] = [];
  try {
    items = (await kv.lrange<string>(LIST_KEY, 0, limit - 1)) ?? [];
    if (consume && items.length) {
      // 取り込んだ分は done に退避してから pending から除去（二重修正の防止）。
      await kv.lpush("error_reports:done", ...items);
      await kv.ltrim("error_reports:done", 0, 499);
      await kv.ltrim(LIST_KEY, items.length, -1);
    }
  } catch {
    /* 取得失敗は空配列 */
  }
  const reports = items.map((s) => {
    try {
      return typeof s === "string" ? JSON.parse(s) : s;
    } catch {
      return s;
    }
  });
  return Response.json({ ok: true, count: reports.length, reports });
}

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
