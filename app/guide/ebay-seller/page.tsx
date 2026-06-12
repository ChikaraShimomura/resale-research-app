import Link from "next/link";
import {
  ArrowLeft,
  AlertTriangle,
  Check,
  Smartphone,
  CreditCard,
  Landmark,
  Hand,
  Clock,
} from "lucide-react";

export const metadata = {
  title: "eBayセラー登録 かんたんガイド（画像つき・本人確認まで） | 輸出ラボ",
  description:
    "eBayで売上を受け取るためのセラー登録（Payoneer・本人確認/KYC・eBay側の同期/カード/送信）を、どこを押す・何を入力するか画像つきで一歩ずつ。出品できるまで全部のせ。",
};

/* ── 画面イラストの小部品（実画面をなぞった注釈つき。値はダミー） ── */

// 各サービスのロゴ風（実画面に近づけるため）
function EbayLogo() {
  return (
    <span className="font-black text-[15px] tracking-tight leading-none">
      <span className="text-[#E53238]">e</span>
      <span className="text-[#0064D2]">b</span>
      <span className="text-[#F5AF02]">a</span>
      <span className="text-[#86B817]">y</span>
    </span>
  );
}
function PayoneerLogo() {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="relative w-4 h-4 rounded-full"
        style={{ background: "conic-gradient(from 90deg, #ff6a00, #ff2db4, #8a3ffc, #1e9bff, #ff6a00)" }}
      >
        <span className="absolute inset-[3px] rounded-full bg-white" />
      </span>
      <span className="font-bold text-[13px] text-gray-800">Payoneer</span>
    </span>
  );
}

function Screen({ logo, children }: { logo?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      <div className="flex items-center justify-center h-8 px-2.5 bg-gray-50 border-b border-gray-100">
        {logo ?? (
          <span className="flex gap-1" aria-hidden="true">
            <span className="w-2 h-2 rounded-full bg-gray-200" />
            <span className="w-2 h-2 rounded-full bg-gray-200" />
            <span className="w-2 h-2 rounded-full bg-gray-200" />
          </span>
        )}
      </div>
      <div className="p-3 space-y-2">{children}</div>
    </div>
  );
}

// 押す場所（ハイライト＋指マーク）。<p>内でも使えるよう span で構成する。
function Tap({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-flex">
      <span className="absolute -inset-1 rounded-xl ring-2 ring-[#BF0000] animate-pulse" aria-hidden="true" />
      <span className="relative">{children}</span>
      <span className="absolute -right-2 -bottom-3 text-[#BF0000]">
        <Hand size={18} />
      </span>
    </span>
  );
}

function BlueBtn({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center h-9 px-5 rounded-full bg-[#0064D2] text-white text-[13px] font-bold">
      {children}
    </span>
  );
}

function Field({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-gray-400 mb-0.5">{label}</p>
      <div
        className={`h-8 px-2.5 flex items-center rounded-lg border text-[12px] ${
          ok ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-gray-200 text-gray-700"
        }`}
      >
        {value}
        {ok && <Check size={13} className="ml-auto text-emerald-500" />}
      </div>
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
      <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
      <p className="text-[12px] text-amber-800 leading-relaxed">{children}</p>
    </div>
  );
}

function StepCard({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-7 h-7 rounded-full bg-[#BF0000] text-white flex items-center justify-center text-sm font-black shrink-0">
          {n}
        </span>
        <h2 className="text-[14px] font-black text-gray-800 leading-snug">{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export default function EbaySellerGuidePage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA]">
      <header className="bg-gradient-to-r from-[#BF0000] to-[#BF0000] px-3 py-2.5 shadow-sm sticky top-0 z-20">
        <div className="max-w-2xl mx-auto flex items-center gap-2">
          <Link
            href="/guide"
            aria-label="戻る"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 text-white shrink-0"
          >
            <ArrowLeft size={18} />
          </Link>
          <span className="text-white font-black text-[15px]">eBayセラー登録 かんたんガイド</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-3">
        {/* イントロ */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-sm text-gray-700 leading-relaxed">
            eBayで<b>売上を受け取る</b>ための登録を、<b>どこを押す・何を入れる</b>かまで画像つきで案内します。
            <b>本人確認（KYC）</b>と、その後の<b>eBay側の手順（同期・カード・送信）</b>、
            <b>出品できるまで</b>全部のせました。初回だけ・入力10〜15分（＋審査）。
          </p>
        </div>

        {/* 全体の流れ */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="text-[13px] font-black text-gray-800 mb-2">全体の流れ（3ブロック）</h2>
          <div className="space-y-1.5 text-[12px] text-gray-600">
            <p>① <b>eBayで出品を始める</b>（STEP1〜3）</p>
            <p>② <b>Payoneer登録＋本人確認</b>（STEP4〜8）← 一番つまずく所</p>
            <p>③ <b>eBayに戻って同期・カード・送信→審査→出品</b>（STEP9〜13）</p>
          </div>
        </div>

        {/* 用意するもの */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="text-[13px] font-black text-gray-800 mb-2.5">先に手元に用意するもの</h2>
          <ul className="space-y-2 text-[13px] text-gray-700">
            <li className="flex items-center gap-2"><Smartphone size={16} className="text-[#BF0000]" /> スマホ（SMS認証コードを受け取る）</li>
            <li className="flex items-center gap-2"><CreditCard size={16} className="text-[#BF0000]" /> 本人確認書類（マイナンバーカード／免許／パスポート）</li>
            <li className="flex items-center gap-2"><Landmark size={16} className="text-[#BF0000]" /> 受け取り用の銀行口座</li>
            <li className="flex items-center gap-2"><CreditCard size={16} className="text-[#BF0000]" /> クレジット／デビットカード（手数料用に1枚・VISA/Master）</li>
          </ul>
          <p className="mt-2.5 text-[11px] text-[#BF0000] font-bold">
            ⚠️ 名前・住所は<b>ローマ字</b>で、<b>身分証と完全一致</b>に。ここがズレると審査で止まります。
          </p>
        </div>

        {/* STEP 1 */}
        <StepCard n={1} title="eBayの出品ページで「Sell now」を押す">
          <p className="text-[13px] text-gray-600 leading-relaxed">ログインした状態で、出品（Selling）ページを開きます。</p>
          <Screen logo={<EbayLogo />}>
            <p className="text-[13px] font-bold text-gray-800">If you don&apos;t love it, list it</p>
            <Tap><BlueBtn>Sell now</BlueBtn></Tap>
          </Screen>
        </StepCard>

        {/* STEP 2 */}
        <StepCard n={2} title="「出品を開始」で商品名を入れて検索 → 候補を選ぶ">
          <Screen logo={<EbayLogo />}>
            <div className="h-9 px-3 flex items-center rounded-lg border border-gray-200 text-[12px] text-gray-400">
              どんな商品を出品しますか
            </div>
            <p className="text-[11px] text-gray-500">例：amiibo アオリ → 🔍検索 → 出た候補をクリック</p>
          </Screen>
          <Warn>商品は<b>登録を進めるきっかけ</b>でOK。実際の販売は、アプリの「eBay簡単出品」が自動でやります。</Warn>
        </StepCard>

        {/* STEP 3 */}
        <StepCard n={3} title="「Set up your selling account」で「Get started」を押す">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            ここから先が<b>セラー登録の本体</b>。<b>4ステップ</b>を順にやっていきます。
          </p>
          <Screen logo={<EbayLogo />}>
            <p className="text-[11px] text-gray-700">1. Connect a Payoneer Account</p>
            <p className="text-[11px] text-gray-700">2. Sync eBay and Payoneer</p>
            <p className="text-[11px] text-gray-700">3. Add your financial info（カード）</p>
            <p className="text-[11px] text-gray-700">4. Submit registration</p>
            <Tap><BlueBtn>Get started</BlueBtn></Tap>
          </Screen>
        </StepCard>

        {/* STEP 4 */}
        <StepCard n={4} title="Payoneerの画面で「Sign up」を押す（持っていない場合）">
          <Screen logo={<PayoneerLogo />}>
            <p className="text-[12px] font-bold text-gray-800">Connect to Payoneer</p>
            <Field label="Email" value="あなたのメール" />
            <p className="text-[12px] text-gray-600">
              New to Payoneer? <Tap><span className="text-[#0064D2] font-bold">Sign up</span></Tap>
            </p>
          </Screen>
          <p className="text-[12px] text-gray-500">すでにPayoneerを持っているなら、パスワードを入れて「Sign in」でOK。</p>
        </StepCard>

        {/* STEP 5 */}
        <StepCard n={5} title="種別は「個人（Individual）」＋氏名はローマ字で">
          <Screen logo={<PayoneerLogo />}>
            <Field label="アカウント種別" value="個人 / Individual" ok />
            <Field label="名 / First name" value="TARO" />
            <Field label="姓 / Last name" value="YAMADA" />
          </Screen>
          <Warn>氏名は<b>身分証と完全一致</b>のローマ字に（eBayの表示名と同じに揃える）。</Warn>
        </StepCard>

        {/* STEP 6 — 最重要 */}
        <section className="bg-white rounded-2xl border-2 border-[#BF0000]/40 shadow-sm p-4">
          <div className="flex items-center gap-2.5 mb-1">
            <span className="w-7 h-7 rounded-full bg-[#BF0000] text-white flex items-center justify-center text-sm font-black shrink-0">6</span>
            <h2 className="text-[14px] font-black text-gray-800 leading-snug">連絡先情報（★一番つまずく所）</h2>
          </div>
          <p className="text-[11px] text-[#BF0000] font-bold mb-3">ここで「次へ」が押せない人が続出！下の3つを必ず守って👇</p>
          <div className="space-y-3">
            <Screen logo={<PayoneerLogo />}>
              <Field label="番地（Street）" value="1-2-3 Marunouchi  ▼候補から選ぶ" ok />
              <p className="text-[11px] text-[#BF0000] font-bold">
                ※ ただ打つだけはNG。<b>候補をクリック</b>、または<b>「Enter address manually（手動入力）」</b>を押して確定！
              </p>
              <Field label="都市名 / City（必須）" value="Chiyoda-ku" ok />
              <Field label="都道府県 / State" value="Tokyo" />
              <Field label="郵便番号" value="100-0005" />
              <Field label="携帯番号（+81）" value="9012345678" ok />
              <p className="text-[11px] text-[#BF0000] font-bold">※ 電話は<b>先頭の0を取る</b>（090… → 90…）</p>
              <Field label="認証コード" value="SMSの6桁を最新で入力" />
            </Screen>
            <Warn>
              <b>「次へ」が押せない3大原因</b>：<br />
              ① 住所を<b>候補/手動入力で確定</b>していない<br />
              ② <b>City（都市名）が空</b><br />
              ③ 電話に<b>先頭の0が付いている</b>
            </Warn>
            <p className="text-[12px] text-gray-500 leading-relaxed">
              認証コードは数分で期限切れ。<b>コードを入れたら編集せず</b>、すぐ「次へ」を押すのがコツ。
            </p>
          </div>
        </section>

        {/* STEP 7 — 本人確認(KYC) */}
        <StepCard n={7} title="本人確認（KYC）＋ 受け取り銀行口座の登録">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            <b>本人確認（KYC）</b>＝Payoneerが「本人かどうか」を確認する手続きです。画面の案内に沿って進めます。
          </p>
          <Screen logo={<PayoneerLogo />}>
            <Field label="本人確認書類の種類" value="運転免許証 / マイナンバー / パスポート" />
            <Field label="書類番号" value="番号を入力（例: 免許証番号）" />
            <p className="text-[11px] text-gray-500">環境によっては書類の<b>撮影アップロード</b>を求められます</p>
            <Field label="受け取り銀行口座" value="銀行名・支店・口座番号（本人名義）" />
          </Screen>
          <Warn>
            身分証・口座の<b>名義と住所</b>も、eBay／Payoneerと<b>同じローマ字表記</b>に。<br />
            ※ 最初は<b>番号入力だけ</b>でも、<b>後日 追加で書類提出</b>を求められることがあります（正常）。
          </Warn>
        </StepCard>

        {/* STEP 8 — Payoneer申請完了 */}
        <StepCard n={8} title="「おめでとうございます！」＝Payoneerへの申請完了">
          <Screen logo={<PayoneerLogo />}>
            <p className="text-[13px] font-black text-[#1e9bff]">おめでとうございます！</p>
            <p className="text-[12px] text-gray-700">申請が正常に送信されました。審査中です。</p>
          </Screen>
          <Warn>
            <b>承認メールは早ければ数分</b>で届きます。でもこれは<b>「Payoneer口座ができた」だけ</b>。
            eBayで<b>出品できる</b>ようになるには、次のSTEP（eBay側）と<b>本人確認の審査</b>がもう一段必要です。
          </Warn>
        </StepCard>

        {/* STEP 9 — eBayに戻る → 同期 */}
        <StepCard n={9} title="eBayに戻る → eBayとPayoneerを「同期」する">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            Payoneerが終わると<b>eBayの画面に戻ります</b>。Payoneerの情報がeBayに取り込まれるので、内容を確認して進めます。
          </p>
          <Screen logo={<EbayLogo />}>
            <p className="text-[12px] text-gray-700">2. Sync eBay and Payoneer profiles</p>
            <p className="text-[11px] text-gray-500">Payoneerの氏名・住所が反映 → 確認</p>
            <Tap><BlueBtn>Continue</BlueBtn></Tap>
          </Screen>
        </StepCard>

        {/* STEP 10 — カード登録 */}
        <StepCard n={10} title="手数料用のカードを登録（Add your financial info）">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            売上から払えない手数料が出た時のために、<b>カードを1枚</b>登録します（VISA／Masterのみ）。
          </p>
          <Screen logo={<EbayLogo />}>
            <Field label="カード番号" value="•••• •••• •••• ••••" />
            <Field label="有効期限 / セキュリティコード" value="MM/YY ・ •••" />
          </Screen>
        </StepCard>

        {/* STEP 11 — 送信 */}
        <StepCard n={11} title="「Submit registration」で送信する">
          <p className="text-[13px] text-gray-600 leading-relaxed">最後に登録情報を送信します。これでeBay側の申請が完了です。</p>
          <Screen logo={<EbayLogo />}>
            <p className="text-[12px] text-gray-700">4. Submit registration info</p>
            <Tap><BlueBtn>Submit registration</BlueBtn></Tap>
          </Screen>
        </StepCard>

        {/* STEP 12 — 審査待ち */}
        <StepCard n={12} title="本人確認の審査を待つ → 「準備OK」メールが届く">
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
            <Clock size={16} className="text-blue-500 shrink-0 mt-0.5" />
            <p className="text-[12px] text-blue-800 leading-relaxed">
              eBay／Payoneerが<b>本人確認（KYC）を審査</b>します。<b>早ければ数分、長いと数日</b>。
              完了すると<b>「アカウントの準備ができました」メール</b>が届きます。
            </p>
          </div>
          <Warn>
            審査が終わる前にアプリで出品しようとすると、<b>「アカウントの最終確認待ち」</b>と出ます。
            <b>これは正常</b>。メールを待ってからもう一度どうぞ（エラーではありません）。
          </Warn>
        </StepCard>

        {/* STEP 13 — 完了・出品 */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Check size={18} className="text-emerald-600" />
            <h2 className="text-[14px] font-black text-emerald-800">STEP13：準備OKメールが届いたら出品！</h2>
          </div>
          <p className="text-[13px] text-emerald-800 leading-relaxed">
            セラー登録は完了！アプリの<b>「eBay簡単出品」→「確認できた・出品する」</b>を押すと、
            そのまま<b>公開（出品）</b>されます🎈 これ以降は<b>1タップ</b>で出品できます。
          </p>
        </div>

        {/* つまずき集 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="text-[13px] font-black text-gray-800 mb-2.5">よくあるつまずき（まとめ）</h2>
          <ul className="space-y-2 text-[12px] text-gray-700 leading-relaxed">
            <li>🔴 <b>「次へ」が押せない</b>（STEP6）→ 住所を「候補/手動入力」で確定＋<b>City</b>を入力＋電話の<b>0を取る</b></li>
            <li>🔴 <b>「出品できませんでした」と長いエラー</b> → 実は<b>本人確認(KYC)の審査待ち</b>（STEP12）。<b>準備OKメール後</b>に再出品でOK</li>
            <li>🔴 <b>承認メールが来たのに出品できない</b> → そのメールは<b>Payoneer口座の承認</b>。eBay側の<b>同期・カード・送信（STEP9〜11）と審査</b>が別途必要</li>
            <li>🔴 <b>審査で止まる</b> → 名前・住所を<b>身分証と完全一致</b>のローマ字に</li>
          </ul>
        </div>

        <p className="text-center text-[11px] text-gray-400 pt-2 pb-6">
          ※ 画面は分かりやすさのための再現イラストです（入力例はダミー）。eBay・Payoneerの実画面と細部が異なる場合があります。
        </p>
      </main>
    </div>
  );
}
