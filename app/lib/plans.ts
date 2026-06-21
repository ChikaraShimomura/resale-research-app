// サブスクのプラン定義。価格・同時出品上限は「定数」＝実データを見ていつでも調整可。
// listingLimit = 同時に出品中(公開)にできる数。master/admin は無制限(Infinity)。
//
// 権限は5種類（＋未購読の入口 free）:
//  - free    : ログイン済み・未購読。閲覧のみ（自動出品0）＝集客の入口。
//  - amateur : アマチュア ¥500/月。最初の30日（TRIAL_DAYS）無料。
//  - veteran : ベテラン   ¥2,000/月。
//  - pro     : プロ       ¥3,000/月。
//  - master  : 身内（管理者が管理画面で指定）。無料・無制限。
//  - admin   : 管理者（ADMIN_EMAILS）。無料・無制限＋/admin＋身内の指定。
export type PlanId = "free" | "amateur" | "veteran" | "pro" | "master" | "admin";

export interface Plan {
  id: PlanId;
  name: string;         // 表示名
  priceJpy: number;     // 月額(円)。0=無料(free/master/admin)
  listingLimit: number; // 同時出品上限。Infinity=無制限
  paid: boolean;        // Stripeの購読対象か（=料金ページに申込ボタンを出す）
}

export const PLANS: Record<PlanId, Plan> = {
  free:    { id: "free",    name: "無料",       priceJpy: 0,    listingLimit: 0,        paid: false },
  amateur: { id: "amateur", name: "アマチュア", priceJpy: 500,  listingLimit: 10,       paid: true  },
  veteran: { id: "veteran", name: "ベテラン",   priceJpy: 2000, listingLimit: 30,       paid: true  },
  pro:     { id: "pro",     name: "プロ",       priceJpy: 3000, listingLimit: 100,      paid: true  },
  master:  { id: "master",  name: "身内",       priceJpy: 0,    listingLimit: Infinity, paid: false },
  admin:   { id: "admin",   name: "管理者",     priceJpy: 0,    listingLimit: Infinity, paid: false },
};

// 料金ページに並べる有料プラン（表示順）。
export const PAID_PLAN_IDS: PlanId[] = ["amateur", "veteran", "pro"];

// アマチュアの無料トライアル日数（最初の30日＝約1ヶ月）。veteran/pro はトライアルなし。
export const TRIAL_DAYS = 30;
export function trialDaysFor(plan: PlanId): number {
  return plan === "amateur" ? TRIAL_DAYS : 0;
}

// ペイウォールの有効化スイッチ。Stripe決済が稼働するまでは OFF（=上限ゲートを掛けない＝既存挙動を壊さない）。
// 決済実装後に Vercel 環境変数 PAYWALL_ENABLED=1 でON。
export const PAYWALL_ENABLED = process.env.PAYWALL_ENABLED === "1";
