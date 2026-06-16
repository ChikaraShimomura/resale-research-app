# 認証基盤 ＆ 利益可視化 — 設計（確定版）

最終更新: 2026-06-16 / セッション 4c132503

## 0. 背景・最重要事実
利益トラッキングは **既に実装済み**（作り直し不要）:
- eBay連携は `sell.fulfillment` 含む3スコープ取得済 → `/api/ebay/sold` が実際の売上注文を取得
- `ebay_sku_map:{did}` で eBay出品 → カタログ商品 → 楽天原価 に紐付け
- `ebay_deals:{did}`（商品ごと: 仕入れ/ポイント/出品日/売却額/売却日）に記録
- `GrowthDashboard` + `/api/ebay/stats`（`app/lib/ebay/stats.ts`）が実利益を計算・表示
  - 計算: `利益 = 売上(USD×155) − eBay手数料(13.25%+¥47) − 仕入れ + ポイント`

**→ 認証の役割は「新規の利益計算を作る」ことではなく、端末Cookie(`rr_did`)だけの identity を “消えない・端末跨ぎのアカウント” に昇格させること。**

## 1. 認証方式（確定）
- **楽天ログイン: 不採用**。第三者向け公開SSO無し＋楽天購入は読めない（確定事項）＝価値ゼロ。
- **eBayログイン強制: 不採用**。eBayアカウント未保有のユーザーが多く、ゲートにすると入口で落ちる。
- **背骨 = メールアドレス + パスワード**（最も馴染みがある／eBay未連携でもアカウント作成・別端末復元が可能）。
  - Supabase Auth が bcrypt+ソルトでサーバー側ハッシュ＋パスワードリセット一式を肩代わり（暗号処理は自前実装ゼロ）。
- **eBay連携 = アカウントに紐付け**（売上データの源。アカウント＝実質その人のeBay）。
- **2段階認証 = TOTP（認証アプリ）を「任意(opt-in)」で**。「メール2FA」は採用しない（理由は §2.5）。
- **任意・非ゲート**: ゲストは従来通り登録不要で全機能。「サインインすると利益ダッシュボードが端末を跨いで保存される」とメリット提示。

## 2. 永続化（確定）
- **Supabase(Postgres)** に accounts ＋ 利益台帳(deals) を永続化（KVのTTLで履歴が消える問題を解消）。
- KV は eBayトークン・売却キャッシュ・funnel に継続利用。

## 2.5 2段階認証(2FA)の方針（確定・裏取り済 2026-06-16）
**「メール2FA」は採用しない。** 一見セキュア向上に見えて、この構成では逆効果:
- **NISTが明示的に禁止**: SP 800-63B-4 (2025-07) §3.1.3.1「Email SHALL NOT be used for out-of-band authentication」。メールは特定デバイスの所持を証明できず、正規の認証経路として認められていない。
- **同一経路問題（OWASP独立性要件 違反）**: パスワードリセットもメール、2要素コードもメール → 両方が「メール受信箱の支配」に収束。OWASP「各要素は同一攻撃で破られてはならない」を満たさず、手間だけ増えて独立した守りはほぼ増えない（受信箱を取られたらPWも2FAも同時突破）。

**本物の2FAが要るなら TOTP（認証アプリ：Google Authenticator等）を opt-in で:**
- Supabase Auth に標準搭載・**無料**（公式：TOTP MFA APIは全プロジェクトでデフォルト有効・追加課金なし）。※ SMS/電話MFAは有料アドオン(~$75/月＋送信課金)なので使わない。
- TOTPはローカル生成で経路傍受が無く、受信箱の連鎖被害も無いため email/SMS OTPより明確に強い。
- ただし**必須化しない**。守る資産＝失効可能なeBay OAuthトークン（銀行口座ではない）→ NISTのAAL1相当でMFA不要、OWASPもリスクベース(step-up)推奨、UXデータ上も必須2FAは登録離脱を増やす。→ **opt-in（オンにしたい人だけ）**が最適点。
- 実装はTOTPが一番重い（QR表示/AAL判定/RLS enforcement）ため、**P1はPWのみ、TOTP opt-inはP2/P3**で追加。
- さらに上を狙うなら passkey/FIDO2（フィッシング耐性・低摩擦）が上位互換。TOTPはAiTMフィッシングには耐性なし、という限界も認識しておく。

## 3. データモデル
### Supabase
```sql
accounts(
  id uuid pk default gen_random_uuid(),
  email text unique,            -- magic-link
  ebay_user_id text,            -- 連携時に保存(任意・表示/重複検知用)
  created_at timestamptz default now(),
  last_login_at timestamptz
)
device_links(                   -- 端末 → アカウント
  did text pk,                  -- rr_did
  account_id uuid references accounts(id),
  linked_at timestamptz default now()
)
deals(                          -- 利益台帳(永続・ebay_deals の移行先)
  account_id uuid references accounts(id),
  product_id text,
  title text,
  purchase_jpy int,
  points int,
  shipping_jpy int,
  listed_at timestamptz,
  sold_usd numeric,             -- null=未売却
  sold_at timestamptz,
  fee_jpy int,
  profit_jpy int,
  primary key (account_id, product_id)
)
```
### KV（継続）
- `ebay_token:{accountId}`（旧 `:{did}`）/ `ebay_sku_map:{accountId}` / `ebay_sold:{accountId}` / funnel(evc/evu)。
- ゲスト中は accountId = did（暫定）。サインインで本accountIdへ移行。

## 4. 識別の昇格フロー
1. ゲスト: `rr_did` をそのまま userId（今と完全に同じ）。
2. サインイン（magic-link）→ accounts 作成 → device_links に `did→account_id`。
3. 既存の actor-scoped データ（ebay_token/sku_map/sold + ebay_deals）を `did` → `account_id` へ移行（リネーム/alias）＋ ebay_deals を deals テーブルへ転記。
4. 別端末で同メールログイン → 同 account_id に紐付け → ダッシュボードは account 単位で合算。
5. eBay連携は account に紐付け（callback で `ebay_user_id` を保存。重複連携検知）。

## 5. ダッシュボード強化（認証後に可能）
既存(totalProfit/称号)に加えて:
- 端末跨ぎ合算 / 月別・週別の利益タイムライン / 商品別損益明細 / 「早く売れた順」(avgDaysToSell は Insights 承認後)。

## 6. 実装フェーズ
- **P1 認証土台**: `getUserId()` 抽象化（cookie did or session account）。**Supabase Auth でメアド+PW**（signUp / signInWithPassword / resetPasswordForEmail）＋ `@supabase/ssr` クッキーセッション（middlewareで `getUser()` トークン更新、server側は `getSession()` を信用しない）。カスタムSMTP設定（§7）。device_links 移行。既存 `:{did}` キーを `getUserId()` 経由に。
- **P2 永続台帳**: ebay_deals → Supabase deals 同期（sold sync 時に upsert）。ダッシュボードに timeline/明細。
- **P3 復元・2FA・将来課金**: 別端末復元の磨き込み。**TOTP 2FA を opt-in 追加**（mfa.enroll/challenge/verify + AAL2判定）。プラン課金の土台（accounts に plan 列）。

## 7. セキュリティ/プライバシー & 実務上の必須対応
- **⚠️ カスタムSMTP必須**: Supabase無料の組み込みメールは **~2通/時** 制限で本番不可。確認/リセット/OTPメールを送るには独自SMTP必須。→ 既存の Gmail SMTP（`GMAIL_USERNAME`/`PASSWORD`、週次レポートで使用中）流用、または Resend 無料枠。
- **⚠️ 漏洩パスワード検知(HaveIBeenPwned)は Pro限定**で無料枠に無い → 無料枠では自前で最低文字数（例:8〜10字）等の最小ポリシーを課す。
- パスワードハッシュは Supabase が bcrypt+ソルトで担保（自前実装しない）。リセット/確認トークンも Supabase が生成・期限・単回使用を管理（自前で作らない）。
- セッションは HttpOnly/Secure/SameSite。Supabase Auth はレート制限が全プロジェクト標準（token bucket / 429）。
- eBayトークンは現状の AES-256-GCM 暗号化を維持（鍵 `EBAY_TOKEN_ENC_KEY`）。
- アカウント＝任意。ゲストの体験・funnel を壊さない（最優先）。
- プライバシーポリシー更新（アカウント/メール保持の明記）。

## 8. 未確定・要検討（実装着手前）
- カスタムSMTPの送信元（既存 Gmail SMTP 流用 vs Resend 無料枠）の確定。
- パスワード最小ポリシー（文字数/簡易強度）の具体値。
- eBay「ログイン直」も将来欲しいなら `commerce.identity.readonly` スコープ追加（※ Insights スコープは承認前に足さない、は別件で継続）。
- 既存ゲストデータの移行UX（「この端末の実績をアカウントに引き継ぐ？」）。
- TOTP opt-in を入れる場合の AAL2 enforcement 方針（アプリ層 vs RLS の `auth.jwt()->>'aal' = 'aal2'`）。

## 9. 裏取りソース（2026-06-16 / 多エージェント検証で確認済）
- メール2FA禁止: NIST SP 800-63B-4 §3.1.3.1「Email SHALL NOT be used for out-of-band authentication」 https://pages.nist.gov/800-63-4/sp800-63b/authenticators/
- 要素独立性: OWASP MFA Cheat Sheet（同一攻撃で破られる要素はMFAにならない）/ リスクベース(step-up)推奨。
- Supabase 無料TOTP: https://supabase.com/docs/guides/auth/auth-mfa/totp 「TOTP MFA API is free to use and is enabled on all Supabase projects by default」。SMS/電話MFAは有料アドオン。
- 無料枠: 50,000 MAU / bcrypt+ソルト全プラン / 漏洩PW検知はPro限定 / 組み込みメール~2通/時。 https://supabase.com/pricing , https://supabase.com/docs/guides/auth/password-security
- Next.js実装: `@supabase/ssr`（browser/server client + middleware で `getUser()`）。effort順: magic-link ≈ email-OTP < email+password ≪ +TOTP MFA。
