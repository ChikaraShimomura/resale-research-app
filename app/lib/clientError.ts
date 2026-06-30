// クライアント側の失敗（fetch例外／非ok／非JSON応答）を、原因と状況つきで /api/report/error に“自動”送信する。
// 目的＝「通信エラーで〜できませんでした」等の catch がエラーを握り潰して原因を失う問題を解消し、
//       何が・どのボタン(action)・どのエンドポイントで・どのHTTPステータス/例外で起きたかを必ず記録・追跡できるようにする。
// ユーザーが「開発者に報告」を押さなくても自動で残る。報告自体の失敗は無視（UXを妨げない）。
export interface ClientErrorContext {
  action?: string; // 例 "photo_upload" / "price_edit" / "ship_toggle" / "content_save"
  endpoint?: string; // 例 "/api/ebay/list/photos"
  status?: number; // HTTPステータス（取れれば。fetch例外時は0）
  productId?: string;
  detail?: string; // 例外メッセージ／レスポンス本文の断片／errorDetail
  [k: string]: unknown; // 追加コンテキスト（fileCount 等）
}

// 例外を読みやすい文字列に。Error は "Name: message"、それ以外は String()。
export function errToDetail(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

export async function reportClientError(where: string, ctx: ClientErrorContext): Promise<void> {
  try {
    const head = [ctx.action, ctx.endpoint, ctx.status ? `HTTP ${ctx.status}` : ""].filter(Boolean).join(" ");
    await fetch("/api/report/error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        where,
        message: `[client] ${head} ${ctx.detail ?? ""}`.trim().slice(0, 2000),
        productId: typeof ctx.productId === "string" ? ctx.productId : undefined,
        note: JSON.stringify(ctx).slice(0, 1500), // 全コンテキストを note に（status/action/fileCount 等）
      }),
      keepalive: true, // 画面遷移/アンマウントでも送信を取りこぼさない
    });
  } catch {
    /* 報告自体の失敗は無視 */
  }
}
