import Link from "next/link";
import {
  ArrowLeft,
  AlertTriangle,
  Check,
  Smartphone,
  CreditCard,
  Landmark,
  Hand,
} from "lucide-react";

export const metadata = {
  title: "eBayセラー登録 かんたんガイド（画像つき） | 輸出ラボ",
  description:
    "eBayで売上を受け取るためのセラー登録（Payoneer）を、どこを押す・何を入力するか画像つきで一歩ずつ。つまずきやすい所も全部のせました。",
};

/* ── 画面イラストの小部品（実画面をなぞった注釈つき。値はダミー） ── */

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      <div className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 border-b border-gray-100">
        <span className="w-2 h-2 rounded-full bg-gray-200" />
        <span className="w-2 h-2 rounded-full bg-gray-200" />
        <span className="w-2 h-2 rounded-full bg-gray-200" />
      </div>
      <div className="p-3 space-y-2">{children}</div>
    </div>
  );
}

// 押す場所（ハイライト＋「ここを押す」）。<p>内でも使えるよう span で構成する。
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

// 入力欄（ラベル＋入れる値）
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

function StepCard({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
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
      {/* ヘッダー */}
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
            eBayで<b>売上を受け取る</b>ための「セラー登録」を、<b>どこを押す・何を入れる</b>かまで
            画像つきで案内します。<b>初回だけ</b>・入力は10〜15分（＋審査が数日）。
            今日いちばんつまずきやすい所も全部のせました🙆
          </p>
        </div>

        {/* 用意するもの */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="text-[13px] font-black text-gray-800 mb-2.5">先に手元に用意するもの</h2>
          <ul className="space-y-2 text-[13px] text-gray-700">
            <li className="flex items-center gap-2"><Smartphone size={16} className="text-[#BF0000]" /> スマホ（SMS認証コードを受け取る）</li>
            <li className="flex items-center gap-2"><CreditCard size={16} className="text-[#BF0000]" /> 本人確認書類（マイナンバーカード／免許／パスポート）</li>
            <li className="flex items-center gap-2"><Landmark size={16} className="text-[#BF0000]" /> 受け取り用の銀行口座</li>
            <li className="flex items-center gap-2"><CreditCard size={16} className="text-[#BF0000]" /> クレジット／デビットカード（手数料用に1枚）</li>
          </ul>
          <p className="mt-2.5 text-[11px] text-[#BF0000] font-bold">
            ⚠️ 名前・住所は<b>ローマ字</b>で、<b>身分証と完全一致</b>に。ここがズレると審査で止まります。
          </p>
        </div>

        {/* STEP 1 */}
        <StepCard n={1} title="eBayの出品ページで「Sell now」を押す">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            ログインした状態で、出品（Selling）ページを開きます。
          </p>
          <Screen>
            <p className="text-[13px] font-bold text-gray-800">If you don&apos;t love it, list it</p>
            <Tap><BlueBtn>Sell now</BlueBtn></Tap>
          </Screen>
        </StepCard>

        {/* STEP 2 */}
        <StepCard n={2} title="「出品を開始」で商品名を入れて検索 → 候補を選ぶ">
          <Screen>
            <div className="h-9 px-3 flex items-center rounded-lg border border-gray-200 text-[12px] text-gray-400">
              どんな商品を出品しますか
            </div>
            <p className="text-[11px] text-gray-500">例：amiibo アオリ → 🔍検索 → 出た候補をクリック</p>
          </Screen>
          <Warn>
            商品は<b>登録を進めるきっかけ</b>でOK。実際の販売は、アプリの「eBay簡単出品」が自動でやります。
          </Warn>
        </StepCard>

        {/* STEP 3 */}
        <StepCard n={3} title="「Set up your selling account」で「Get started」を押す">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            ここから先が<b>セラー登録の本体</b>。Payoneer（受け取り口座）を作ります。
          </p>
          <Screen>
            <p className="text-[12px] text-gray-700">1. Connect a Payoneer Account</p>
            <p className="text-[12px] text-gray-700">2. Sync eBay and Payoneer</p>
            <Tap><BlueBtn>Get started</BlueBtn></Tap>
          </Screen>
        </StepCard>

        {/* STEP 4 */}
        <StepCard n={4} title="Payoneerの画面で「Sign up」を押す（持っていない場合）">
          <Screen>
            <p className="text-[12px] font-bold text-gray-800">Connect to Payoneer</p>
            <Field label="Email" value="あなたのメール" />
            <p className="text-[12px] text-gray-600">
              New to Payoneer? <Tap><span className="text-[#0064D2] font-bold">Sign up</span></Tap>
            </p>
          </Screen>
          <p className="text-[12px] text-gray-500">
            すでにPayoneerを持っているなら、パスワードを入れて「Sign in」でOK。
          </p>
        </StepCard>

        {/* STEP 5 */}
        <StepCard n={5} title="種別は「個人（Individual）」＋氏名はローマ字で">
          <Screen>
            <Field label="アカウント種別" value="個人 / Individual" ok />
            <Field label="名 / First name" value="CHIKARA" />
            <Field label="姓 / Last name" value="SHIMOMURA" />
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
            <Screen>
              <Field label="番地（Street）" value="1-12-4 Taihei  ▼候補から選ぶ" ok />
              <p className="text-[11px] text-[#BF0000] font-bold">
                ※ ただ打つだけはNG。<b>候補をクリック</b>、または<b>「Enter address manually（手動入力）」</b>を押して確定！
              </p>
              <Field label="都市名 / City（必須）" value="Sumida-ku" ok />
              <Field label="都道府県 / State" value="Tokyo" />
              <Field label="郵便番号" value="130-0012" />
              <Field label="携帯番号（+81）" value="7089425662" ok />
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

        {/* STEP 7 */}
        <StepCard n={7} title="本人確認書類のアップロード＋銀行口座の登録">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            画面の案内に沿って、<b>身分証をスマホで撮ってアップロード</b>。受け取り用の<b>銀行口座</b>も登録します。
          </p>
          <Warn>身分証・口座の<b>名義と住所</b>も、eBay／Payoneerと<b>同じローマ字表記</b>に揃えると一発で通ります。</Warn>
        </StepCard>

        {/* STEP 8 */}
        <StepCard n={8} title="「おめでとうございます！」＝申請完了 → 審査を待つ">
          <Screen>
            <p className="text-[13px] font-black text-[#0064D2]">おめでとうございます！</p>
            <p className="text-[12px] text-gray-700">申請が正常に送信されました。</p>
            <p className="text-[12px] text-gray-500">審査 → 数営業日で確認メールが届きます。</p>
          </Screen>
          <p className="text-[13px] text-gray-700 leading-relaxed">
            ここまで来たら<b>登録作業は完了</b>！あとは<b>Payoneerの承認メール（数日）</b>を待つだけです。
          </p>
        </StepCard>

        {/* 承認後 */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Check size={18} className="text-emerald-600" />
            <h2 className="text-[14px] font-black text-emerald-800">承認メールが届いたら</h2>
          </div>
          <p className="text-[13px] text-emerald-800 leading-relaxed">
            セラー登録は完了！アプリの<b>「eBay簡単出品」</b>を押すと、そのまま<b>公開（出品）</b>まで通るようになります🎈
          </p>
        </div>

        {/* つまずき集 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="text-[13px] font-black text-gray-800 mb-2.5">よくあるつまずき（まとめ）</h2>
          <ul className="space-y-2 text-[12px] text-gray-700 leading-relaxed">
            <li>🔴 <b>「次へ」が押せない</b> → 住所を「候補/手動入力」で確定＋<b>City</b>を入力</li>
            <li>🔴 <b>電話エラー</b> → +81のときは<b>先頭の0を取る</b></li>
            <li>🔴 <b>審査で止まる</b> → 名前・住所を<b>身分証と完全一致</b>のローマ字に</li>
            <li>🔴 <b>コードが通らない</b> → <b>最新のSMS</b>を入れ、入れたら編集しない</li>
          </ul>
        </div>

        <p className="text-center text-[11px] text-gray-400 pt-2 pb-6">
          ※ 画面は分かりやすさのための再現イラストです（入力例はダミー）。eBay・Payoneerの実画面と細部が異なる場合があります。
        </p>
      </main>
    </div>
  );
}
