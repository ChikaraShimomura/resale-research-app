# 課金ON（Stripe本番化）チェックリスト

価格改定（ライト¥5,000 / スタンダード¥20,000 / プロ¥30,000 / プロMAX¥100,000仮）後の「課金をONにする」手順。
**コード側は配線・価格反映ともに完了済み**。以下はすべて Stripe / Vercel / 法務側の外部設定（Claudeはここに触れない）。

> 🔴 最重要：`plans.ts` の価格は**画面表示専用**。実際の請求額は `STRIPE_PRICE_*` が指す **StripeのPrice ID** で決まる。
> Stripeの金額は不変なので、**新価格(¥5,000等)で請求するには Stripe で新しい Price を作り、env を差し替える**こと。
> でないと「画面¥5,000／請求¥500」のズレ＝景表法トラブルになる。

## 0. 事前
- ユーザー＝個人事業主。**まず Test mode で全フロー確認 → Live化**（Test↔Liveは鍵/商品/Webhook/顧客が完全別）。

## 1. 特商法の実情報（課金には法的に必須）
- `LEGAL_OPERATOR_NAME` … 運営者氏名（本名・必須）
- `LEGAL_ADDRESS` / `LEGAL_PHONE` … 任意。未設定なら /legal が「請求があれば遅滞なく開示」と表示（通信販売の省略方式・自宅非公開向け）
- `LEGAL_CONTACT_EMAIL` … 既定 support@yushutsu-fukugyo.com
- /legal はこの env を読むので、入れれば即反映。

## 2. Stripe で価格を作成（まず Test mode）
- 月額・JPY・継続課金（recurring）で商品を作成：
  - ライト **¥5,000** / スタンダード **¥20,000** / プロ **¥30,000**（必要ならプロMAX **¥100,000**）
- 各 **Price ID（`price_...`）**を控える。⚠️旧¥500等の Price は流用不可＝新金額で作り直す。

## 3. Stripe Webhook
- エンドポイント追加：`https://www.yushutsu-fukugyo.com/api/billing/webhook`
- イベント：`checkout.session.completed` / `customer.subscription.created` / `customer.subscription.updated` / `customer.subscription.deleted`
- **Signing secret（`whsec_...`）**を控える。

## 4. Customer Portal
- Settings > Billing > Customer portal を有効化。
- **プラン切替(plan switching)をON**にし、対象に3〜4商品を追加（購読者がポータルでアップグレードできるように）。

## 5. Vercel 環境変数（チャットに貼らず Vercel に直接）
```
STRIPE_SECRET_KEY        = sk_test_…（Live化時 sk_live_…）
STRIPE_PRICE_AMATEUR     = price_…（¥5,000）
STRIPE_PRICE_VETERAN     = price_…（¥20,000）
STRIPE_PRICE_PRO         = price_…（¥30,000）
STRIPE_PRICE_PROMAX      = price_…（¥100,000・任意）
STRIPE_WEBHOOK_SECRET    = whsec_…
LEGAL_OPERATOR_NAME      = （本名）
LEGAL_ADDRESS / LEGAL_PHONE / LEGAL_CONTACT_EMAIL = （任意）
ADMIN_EMAILS             = chikara0323@gmail.com（既設定か確認）
SUPABASE_SERVICE_ROLE_KEY = （登録ユーザー一覧用・任意）
PAYWALL_ENABLED          = 1   ← 最後にON
```
→ 設定後 **Redeploy**（env は再デプロイで反映）。

## 6. 疎通確認（Test mode）
- /pricing に3カード表示 → ライト申込（30日無料＝今日¥0）→ Checkout 完了 → /settings に「ライト（トライアル中）」反映 → ポータルで解約（合計¥0）。
- Stripe Dashboard の Webhook ログで配信成功を確認。

## 7. Live化
- Stripe を本番モードに（本人確認＋振込口座）。
- 本番モードで 商品/価格・Webhook・ポータルを**作り直す**。
- Vercel env を Live値（sk_live_ / whsec_本番 / price_本番×3〜4）に差替 → Redeploy。

## 8. コンプラ最終確認
- 有料 ×「稼げる」訴求＝内職商法（業務提供誘引販売）の罠 → **機能訴求のまま**にする。
- /legal が実情報で埋まっているか最終確認。

---
チェック観点：**表示価格(plans.ts) と Stripe請求(Price ID) が必ず一致**していること。
