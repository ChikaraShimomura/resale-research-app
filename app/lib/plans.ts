// サブスクのプラン定義。価格・同時出品上限は「定数」＝実データを見ていつでも調整可。
// listingLimit = 同時に出品中(公開)にできる数。master は無制限(Infinity)。
// free = 閲覧のみ(自動出品0)＝集客の入口。初級は最初 TRIAL_DAYS 日間無料。
export type PlanId = "free" | "beginner" | "intermediate" | "advanced" | "pro" | "master";

export interface Plan {
  id: PlanId;
  name: string;       // 表示名
  priceJpy: number;   // 月額(円)
  listingLimit: number; // 同時出品上限。Infinity=無制限
}

export const PLANS: Record<PlanId, Plan> = {
  free:         { id: "free",         name: "無料",     priceJpy: 0,      listingLimit: 0 },
  beginner:     { id: "beginner",     name: "初級",     priceJpy: 2000,   listingLimit: 10 },
  intermediate: { id: "intermediate", name: "中級",     priceJpy: 3000,   listingLimit: 20 },
  advanced:     { id: "advanced",     name: "上級",     priceJpy: 10000,  listingLimit: 70 },
  pro:          { id: "pro",          name: "プロ",     priceJpy: 30000,  listingLimit: 250 },
  master:       { id: "master",       name: "マスター", priceJpy: 100000, listingLimit: Infinity },
};

// 初級の無料トライアル日数（最初の2ヶ月）。
export const TRIAL_DAYS = 60;

// ペイウォールの有効化スイッチ。Stripe決済が稼働するまでは OFF（=上限ゲートを掛けない＝既存挙動を壊さない）。
// 決済実装後に Vercel 環境変数 PAYWALL_ENABLED=1 でON。
export const PAYWALL_ENABLED = process.env.PAYWALL_ENABLED === "1";
