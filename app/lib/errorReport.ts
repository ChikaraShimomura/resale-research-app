import { kv } from "@vercel/kv";
import { sendEmail, REPORT_TO, emailConfigured } from "./email";

// サーバー側で「予期せぬエラー」を自動記録する共通ハンドラ。
// ユーザーの「開発者に報告」操作を待たず、未知のeBayエラー等が出たら即KV(error_reports)へ積み＋運用者へメール。
// → 開発者(Claude)が GET /api/report/error?…（Bearer CRON_SECRET）で取り込み、修正→リリースできる。
// 「予期せぬエラー系はすべてキャッチして回収する」ための土台（ユーザー指示2026-06-27）。
const LIST_KEY = "error_reports";
const KEEP = 200;
const TTL = 60 * 24 * 60 * 60;

export interface AutoErrorReport {
  where: string;            // 例 "ebay_edit_price" / "ebay_publish"
  message?: string;         // ユーザー向けに変換後の端的な文
  errorDetail?: string;     // 生のeBayエラー（詳細・診断用）
  productId?: string;
  actor?: string;
  silent?: boolean;         // true=KVには残すがメール通知はしない（既知エラーの診断ログ用）
  [k: string]: unknown;     // priceUsd 等の文脈
}

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

export async function recordAutoError(input: AutoErrorReport): Promise<void> {
  const report = { ...input, auto: true, ts: new Date().toISOString() };
  try {
    await kv.lpush(LIST_KEY, JSON.stringify(report));
    await kv.ltrim(LIST_KEY, 0, KEEP - 1);
    await kv.expire(LIST_KEY, TTL);
  } catch {
    /* KV障害でもメール通知は試みる */
  }
  if (!input.silent && emailConfigured()) {
    try {
      await sendEmail({
        to: REPORT_TO,
        subject: `⚠️ 自動エラー検知: ${String(input.message || input.where).slice(0, 60)}`,
        html: `<div style="font-family:sans-serif;font-size:13px;line-height:1.7;color:#111">
          <h2 style="color:#2D323B;font-size:16px;margin:0 0 8px">⚠️ 自動エラー検知（${esc(input.where)}）</h2>
          <p><b>メッセージ:</b> ${esc(input.message || "-")}</p>
          ${input.errorDetail ? `<p><b>詳細(生エラー):</b> ${esc(String(input.errorDetail))}</p>` : ""}
          <p><b>商品ID:</b> ${esc(input.productId || "-")} / <b>端末:</b> ${esc(input.actor || "-")}</p>
          <p style="color:#9ca3af;font-size:11px">${esc(report.ts)} ／ 一覧は GET /api/report/error（Bearer CRON_SECRET）</p>
        </div>`,
      });
    } catch {
      /* メール失敗でもKVには残る */
    }
  }
}
