// eBay Trading API GetUser で「本人のフィードバック評価数(FeedbackScore)＋好評価率」を取得する。
// 承認制(Marketplace Insights等)ではなく、既存のOAuthユーザートークンを X-EBAY-API-IAF-TOKEN に
// 載せれば叩ける（eps.ts の UploadSiteHostedPictures と同じ作法／Trading APIはOAuthスコープ不要）。
// 取得失敗時は null（フェイルオープン）＝呼び出し側は自分の販売記録(soldCount)へ自動フォールバック。
const ENV = process.env.EBAY_ENV === "sandbox" ? "sandbox" : "production";
const TRADING_API = ENV === "sandbox" ? "https://api.sandbox.ebay.com/ws/api.dll" : "https://api.ebay.com/ws/api.dll";
const COMPAT_LEVEL = "1193"; // eps.ts と揃える（現行の安定値）

export interface FeedbackInfo {
  score: number | null;       // FeedbackScore（累計の評価数）
  positivePct: number | null; // PositiveFeedbackPercent（好評価率 %）
}

export async function getFeedbackScore(token: string): Promise<FeedbackInfo> {
  try {
    // UserID 省略＝認証ユーザー自身の情報。FeedbackScore/PositiveFeedbackPercent は本人なら既定で返る。
    const body =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents">` +
      `<DetailLevel>ReturnSummary</DetailLevel>` +
      `</GetUserRequest>`;
    const res = await fetch(TRADING_API, {
      method: "POST",
      headers: {
        "X-EBAY-API-CALL-NAME": "GetUser",
        "X-EBAY-API-COMPATIBILITY-LEVEL": COMPAT_LEVEL,
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-IAF-TOKEN": token,
        "Content-Type": "text/xml",
      },
      body,
      signal: AbortSignal.timeout(12000),
    });
    const xml = await res.text();
    const ack = /<Ack>(.*?)<\/Ack>/.exec(xml)?.[1] ?? "";
    if (ack !== "Success" && ack !== "Warning") return { score: null, positivePct: null };
    const scoreStr = /<FeedbackScore>(\d+)<\/FeedbackScore>/.exec(xml)?.[1];
    const pctStr = /<PositiveFeedbackPercent>([\d.]+)<\/PositiveFeedbackPercent>/.exec(xml)?.[1];
    return {
      score: scoreStr != null ? parseInt(scoreStr, 10) : null,
      positivePct: pctStr != null ? Math.round(parseFloat(pctStr) * 10) / 10 : null,
    };
  } catch {
    return { score: null, positivePct: null };
  }
}
