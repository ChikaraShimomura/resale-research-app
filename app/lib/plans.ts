// サブスクのプラン定義。価格・同時出品上限は「定数」＝実データを見ていつでも調整可。
// listingLimit = 同時に出品中(公開)にできる数。master/admin は無制限(Infinity)。
//
// 権限は5種類（＋未購読の入口 free）:
//  - free    : ログイン済み・未購読。閲覧のみ（自動出品0）＝集客の入口。
//  - amateur(表示=ライト)       : ¥5,000/月。最初の30日（TRIAL_DAYS）無料。
//  - veteran(表示=スタンダード) : ¥20,000/月。
// ※ id は内部キー(Stripeのenv名 STRIPE_PRICE_* と対応)・name は画面表示。idは変えない。
//  - pro     : プロ       ¥30,000/月。
//  - master  : 身内（管理者が管理画面で指定）。無料・無制限。
//  - admin   : 管理者（ADMIN_EMAILS）。無料・無制限＋/admin＋身内の指定。
// promax(プロMAX) = 自動出品(eBay)が使える最上位プラン。価格は仮(¥100,000)・見直し予定。
export type PlanId = "free" | "amateur" | "veteran" | "pro" | "promax" | "master" | "admin";

export interface Plan {
  id: PlanId;
  name: string;         // 表示名
  priceJpy: number;     // 月額(円)。0=無料(free/master/admin)
  listingLimit: number; // 同時出品上限。Infinity=無制限
  paid: boolean;        // Stripeの購読対象か（=料金ページに申込ボタンを出す）
}

export const PLANS: Record<PlanId, Plan> = {
  free:    { id: "free",    name: "無料",       priceJpy: 0,    listingLimit: 0,        paid: false },
  amateur: { id: "amateur", name: "ライト",     priceJpy: 5000,  listingLimit: 10,      paid: true  },
  veteran: { id: "veteran", name: "スタンダード", priceJpy: 20000, listingLimit: 50,    paid: true  },
  pro:     { id: "pro",     name: "プロ",       priceJpy: 30000, listingLimit: 100,     paid: true  },
  // ⚠️価格は仮(¥100,000)・見直し予定。自動出品(eBay)が使える唯一の有料プラン。
  promax:  { id: "promax",  name: "プロMAX",    priceJpy: 100000, listingLimit: 300,    paid: true  },
  master:  { id: "master",  name: "身内",       priceJpy: 0,    listingLimit: Infinity, paid: false },
  admin:   { id: "admin",   name: "管理者",     priceJpy: 0,    listingLimit: Infinity, paid: false },
};

// 料金ページに並べる有料プラン（表示順）＝自己申込の対象。
// ⚠️プロMAX(promax)は当面ここから外す＝料金カード非表示＋checkoutでも弾く。理由＝STRIPE_PRICE_PROMAX未設定で
//   押すと「No such price」になる／無在庫(dropship)は規約グレー([[resale-app-mukaiko-ebay-policy]])で今は売り込まない。
//   再掲載する時は "promax" を戻し、Stripeで¥100,000のPrice作成＋STRIPE_PRICE_PROMAX env を設定すること。
export const PAID_PLAN_IDS: PlanId[] = ["amateur", "veteran", "pro"];

// プランの序列（アップグレード/ダウングレード判定用）。free<ライト<スタンダード<プロ<プロMAX。身内/管理者は無制限=最上位扱い。
const PLAN_RANK: Record<PlanId, number> = { free: 0, amateur: 1, veteran: 2, pro: 3, promax: 4, master: 9, admin: 9 };
export function planRank(id: PlanId): number {
  return PLAN_RANK[id] ?? 0;
}

// eBay自動出品(写真だけで出品)を使えるプランか＝有料プラン全て（ライト以上）＋身内/管理者。
// ユーザー指示2026-06-27（リリース監査）：訴求「写真だけ自動出品」と整合させ、ライト以上に開放。free は不可（閲覧のみ）。
export function planCanAutoList(plan: PlanId): boolean {
  return PLANS[plan]?.paid === true || plan === "master" || plan === "admin";
}

// 「在庫ありのまま＝無在庫転売」を登録できるプランか＝最上位(プロMAX)＋身内/管理者に限定。
// 通常の有在庫出品(canAutoList)とは別ゲート。仕入れ元にまだ在庫がある品の「仕入れた」を許すかの判定に使う。
export function planCanDropship(plan: PlanId): boolean {
  return plan === "promax" || plan === "master" || plan === "admin";
}

// ライト(amateur)の無料トライアル日数（最初の30日＝約1ヶ月）。スタンダード/プロ はトライアルなし。
export const TRIAL_DAYS = 30;
export function trialDaysFor(plan: PlanId): number {
  return plan === "amateur" ? TRIAL_DAYS : 0;
}

// ペイウォールの有効化スイッチ。Stripe決済が稼働するまでは OFF（=上限ゲートを掛けない＝既存挙動を壊さない）。
// 決済実装後に Vercel 環境変数 PAYWALL_ENABLED=1 でON。
export const PAYWALL_ENABLED = process.env.PAYWALL_ENABLED === "1";
