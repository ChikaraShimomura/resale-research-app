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
  Mail,
  Search,
  Camera,
  HelpCircle,
} from "lucide-react";

export const metadata = {
  title: "eBayセラー登録 徹底ガイド（スマホ画面つき・1タップずつ） | 輸出ラボ",
  description:
    "eBayで売上を受け取るためのセラー登録を、サルでもわかるレベルで。eBayでの出品開始→Payoneer登録＋本人確認(KYC)→eBayに戻って同期・カード・送信→出品まで、どの画面のどこを押すか・何を入力するか・届くメールのリンクまで1タップずつ全部のせ。",
};

/* ── 画面イラストの小部品（実画面をなぞった注釈つき。値はすべてダミー） ── */

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

// スマホ枠：画面イラストを「スマホの画面」と分かるように囲う（角丸外枠＋上部ステータスバー風）
function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[260px] rounded-[26px] border-[5px] border-gray-800 bg-gray-800 shadow-md overflow-hidden">
      {/* ステータスバー風（時刻・電波・電池） */}
      <div className="flex items-center justify-between h-6 px-3 bg-gray-800 text-white text-[9px] font-semibold">
        <span>9:41</span>
        <span className="relative w-9 h-2.5 mx-auto rounded-full bg-gray-700" aria-hidden="true">
          <span className="absolute left-1/2 -translate-x-1/2 top-0.5 w-3 h-1.5 rounded-full bg-gray-600" />
        </span>
        <span className="flex items-center gap-1" aria-hidden="true">
          <span className="text-[8px]">●●●</span>
          <span className="inline-block w-4 h-2 rounded-[2px] border border-white/70 relative">
            <span className="absolute inset-[1px] right-1.5 bg-white rounded-[1px]" />
          </span>
        </span>
      </div>
      {/* 画面本体 */}
      <div className="bg-white">{children}</div>
    </div>
  );
}

function Screen({ logo, children }: { logo?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white overflow-hidden">
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

// 押す場所（ハイライト＋指マーク）。<p>内でも使えるよう span のみで構成する。
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
        className={`min-h-8 py-1 px-2.5 flex items-center rounded-lg border text-[12px] ${
          ok ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-gray-200 text-gray-700"
        }`}
      >
        <span className="leading-snug">{value}</span>
        {ok && <Check size={13} className="ml-auto shrink-0 text-emerald-500" />}
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

// 「つまずいたら」の一言（軽い色味で各STEPに添える）
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 bg-sky-50 border border-sky-100 rounded-xl px-3 py-2">
      <HelpCircle size={15} className="text-sky-500 shrink-0 mt-0.5" />
      <p className="text-[11.5px] text-sky-800 leading-relaxed">
        <b>つまずいたら：</b>
        {children}
      </p>
    </div>
  );
}

// メールのステップ用カード（封筒＋件名の要旨＋押すリンクのハイライト）
function MailCard({
  from,
  subject,
  body,
  link,
}: {
  from: React.ReactNode;
  subject: string;
  body: string;
  link: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100">
        <span className="w-7 h-7 rounded-full bg-[#BF0000]/10 flex items-center justify-center shrink-0">
          <Mail size={15} className="text-[#BF0000]" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] text-gray-500 leading-tight">メールが届きます（差出人：{from}）</p>
          <p className="text-[12.5px] font-bold text-gray-800 leading-tight truncate">{subject}</p>
        </div>
      </div>
      <div className="p-3 space-y-2">
        <p className="text-[12px] text-gray-600 leading-relaxed">{body}</p>
        <p className="text-[12px] text-gray-700">
          本文の中の <Tap><span className="text-[#0064D2] font-bold underline underline-offset-2">{link}</span></Tap> を押す。
        </p>
      </div>
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

// ブロックの見出し（3ブロックの区切り）
function BlockTitle({ no, title, sub }: { no: string; title: string; sub: string }) {
  return (
    <div className="bg-[#BF0000] rounded-2xl shadow-sm px-4 py-3 mt-2">
      <p className="text-white/80 text-[11px] font-bold">ブロック{no}</p>
      <h2 className="text-white text-[15px] font-black leading-snug">{title}</h2>
      <p className="text-white/85 text-[11.5px] mt-0.5">{sub}</p>
    </div>
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
          <span className="text-white font-black text-[15px]">eBayセラー登録 徹底ガイド</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-3">
        {/* イントロ */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-sm text-gray-700 leading-relaxed">
            eBayで<b>売上を受け取る</b>ための登録を、<b>1から全部・1タップずつ</b>ご案内します。
            下のイラストは<b>スマホの画面をそっくり再現</b>したもの。
            <b className="text-[#BF0000]">赤い枠＋指マーク</b>のところを順番に押していけば、
            <b>本人確認（KYC）</b>も<b>届くメールのリンク</b>も迷わず完了できます。初回だけ・入力10〜15分（＋審査の待ち時間）。
          </p>
        </div>

        {/* 全体の流れ */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="text-[13px] font-black text-gray-800 mb-2">全体の流れ（3ブロック）</h2>
          <div className="space-y-1.5 text-[12px] text-gray-600">
            <p>① <b>eBayで出品を始める</b>（STEP1〜6）</p>
            <p>② <b>Payoneer登録＋本人確認(KYC)</b>（STEP7〜13）← <b className="text-[#BF0000]">一番つまずく所</b></p>
            <p>③ <b>eBayに戻って完了→出品</b>（STEP14〜18）</p>
          </div>
          <p className="mt-2 text-[11px] text-gray-500 leading-relaxed">
            途中で<b>メールが2回</b>届きます（Payoneerから1回・eBay/Payoneerから1回）。そのリンクも本ガイドで案内します。
          </p>
        </div>

        {/* 用意するもの */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="text-[13px] font-black text-gray-800 mb-2.5">先に手元に用意するもの</h2>
          <ul className="space-y-2 text-[13px] text-gray-700">
            <li className="flex items-center gap-2"><Smartphone size={16} className="text-[#BF0000] shrink-0" /> スマホ（SMS認証コードを受け取る）</li>
            <li className="flex items-center gap-2"><CreditCard size={16} className="text-[#BF0000] shrink-0" /> 本人確認書類（マイナンバーカード／免許証／パスポート）</li>
            <li className="flex items-center gap-2"><Landmark size={16} className="text-[#BF0000] shrink-0" /> 受け取り用の銀行口座</li>
            <li className="flex items-center gap-2"><CreditCard size={16} className="text-[#BF0000] shrink-0" /> クレジット／デビットカード（手数料用に1枚・VISA/Master）</li>
          </ul>
          <p className="mt-2.5 text-[11px] text-[#BF0000] font-bold">
            ⚠️ 名前・住所は<b>ローマ字</b>で、<b>身分証と完全一致</b>に。ここがズレると審査で止まります。
          </p>
        </div>

        {/* ========== ブロック1 ========== */}
        <BlockTitle no="1" title="eBayで出品を始める" sub="ログイン → 出品メニュー → 商品を選んでセラー登録の入口へ" />

        {/* STEP 1 — ログイン */}
        <StepCard n={1} title="eBayにログインする">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            まずはeBayにログイン。メールアドレスとパスワードを入れて<b>「Sign in」</b>を押します。
          </p>
          <Phone>
            <Screen logo={<EbayLogo />}>
              <p className="text-[13px] font-bold text-gray-800">Hello! Sign in to eBay</p>
              <Field label="Email or username" value="あなたのメール" />
              <Field label="Password" value="••••••••" />
              <Tap><BlueBtn>Sign in</BlueBtn></Tap>
            </Screen>
          </Phone>
          <Tip>アカウントが無ければ「Create account」から先に登録を。買い物用アカウントがあればそのままでOK。</Tip>
        </StepCard>

        {/* STEP 2 — Sellメニュー */}
        <StepCard n={2} title="上部メニューの「出品（Sell）」を押して Selling ページを開く">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            画面いちばん上のメニューから<b>「Sell（出品）」</b>を押します。出品用のページ（Selling）が開きます。
          </p>
          <Phone>
            <Screen logo={<EbayLogo />}>
              <div className="flex items-center justify-between text-[12px] text-gray-600 border-b border-gray-100 pb-1.5">
                <span>My eBay</span>
                <Tap><span className="font-bold text-gray-800">Sell</span></Tap>
                <span>Watchlist</span>
              </div>
              <p className="text-[11px] text-gray-500">「Sell」を押すと出品ページに移動します</p>
            </Screen>
          </Phone>
          <Tip>メニューが見当たらない時は、右上の「☰（三本線）」を押すと中に「Sell」があります。</Tip>
        </StepCard>

        {/* STEP 3 — Sell now */}
        <StepCard n={3} title="青い「Sell now」を押す">
          <p className="text-[13px] text-gray-600 leading-relaxed">Selling ページの青いボタン<b>「Sell now」</b>を押して出品を始めます。</p>
          <Phone>
            <Screen logo={<EbayLogo />}>
              <p className="text-[13px] font-bold text-gray-800">If you don&apos;t love it, list it</p>
              <p className="text-[11px] text-gray-500">使わないモノを出品してみましょう</p>
              <Tap><BlueBtn>Sell now</BlueBtn></Tap>
            </Screen>
          </Phone>
        </StepCard>

        {/* STEP 4 — 検索 */}
        <StepCard n={4} title="「出品を開始」: 検索ボックスに商品名を入れて検索する">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            <b>「どんな商品を出品しますか？」</b>と聞かれます。検索ボックスに<b>商品名</b>を入れて検索（🔍）します。
          </p>
          <Phone>
            <Screen logo={<EbayLogo />}>
              <p className="text-[12px] font-bold text-gray-800">What are you selling?</p>
              <div className="h-9 px-3 flex items-center gap-2 rounded-lg border border-gray-200 text-[12px] text-gray-700">
                <Search size={14} className="text-gray-400 shrink-0" />
                <span>amiibo アオリ</span>
              </div>
              <Tap><BlueBtn>Search</BlueBtn></Tap>
            </Screen>
          </Phone>
          <Tip>日本語でも英語でもOK。型番やキーワードでも探せます。</Tip>
        </StepCard>

        {/* STEP 5 — 候補を選ぶ */}
        <StepCard n={5} title="出た候補から近い商品を選ぶ（無ければ「一致なしで続行」）">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            検索結果から<b>いちばん近い商品</b>をタップ。ピッタリが無ければ<b>「Continue without a match（一致なしで続行）」</b>系を選べばOK。
          </p>
          <Phone>
            <Screen logo={<EbayLogo />}>
              <Tap>
                <span className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg border border-gray-200 text-[11px] text-gray-700">
                  <span className="w-7 h-7 rounded bg-gray-100 shrink-0" />
                  近い商品の候補をタップ
                </span>
              </Tap>
              <p className="text-[11px] text-[#0064D2] font-bold underline underline-offset-2">Continue without a match →</p>
            </Screen>
          </Phone>
          <Warn>商品は<b>登録を進めるきっかけ</b>でOK。実際の販売は、アプリ（輸出ラボ）の「eBay簡単出品」が自動でやります。</Warn>
        </StepCard>

        {/* STEP 6 — Get started */}
        <StepCard n={6} title="「Set up your selling account」で「Get started」を押す">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            ここから先が<b>セラー登録の本体</b>。<b>4ステップ</b>を順にやっていきます（②③④はブロック3で）。
          </p>
          <Phone>
            <Screen logo={<EbayLogo />}>
              <p className="text-[12px] font-bold text-gray-800">Set up your selling account</p>
              <p className="text-[11px] text-gray-700">① Connect a Payoneer account</p>
              <p className="text-[11px] text-gray-400">② Sync eBay and Payoneer</p>
              <p className="text-[11px] text-gray-400">③ Add your financial info（カード）</p>
              <p className="text-[11px] text-gray-400">④ Submit registration</p>
              <Tap><BlueBtn>Get started</BlueBtn></Tap>
            </Screen>
          </Phone>
          <Tip>「①〜④って何？」と不安でも大丈夫。①でPayoneer（売上の受け取り口座）を作り、②③④はあとで自動的に戻ってきます。</Tip>
        </StepCard>

        {/* ========== ブロック2 ========== */}
        <BlockTitle no="2" title="Payoneer登録＋本人確認（KYC）" sub="売上の受け取り口座を作る。ここが一番つまずく所。落ち着いて1つずつ。" />

        {/* STEP 7 — Sign up */}
        <StepCard n={7} title="「Connect to Payoneer」で「Sign up」を押す（持っていない場合）">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            Payoneer（ペイオニア）の画面に切り替わります。<b>初めての人</b>は<b>「Sign up」</b>を押して新規登録します。
          </p>
          <Phone>
            <Screen logo={<PayoneerLogo />}>
              <p className="text-[12px] font-bold text-gray-800">Connect to Payoneer</p>
              <Field label="Email" value="あなたのメール" />
              <p className="text-[12px] text-gray-600">
                New to Payoneer? <Tap><span className="text-[#0064D2] font-bold">Sign up</span></Tap>
              </p>
            </Screen>
          </Phone>
          <Tip>すでにPayoneerを持っているなら、パスワードを入れて「Sign in（ログイン）」でOK。新規登録は不要です。</Tip>
        </StepCard>

        {/* STEP 8 — 種別＋氏名 */}
        <StepCard n={8} title="種別は「個人（Individual）」を選ぶ＋氏名はローマ字で">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            アカウントの種類は<b>「個人（Individual）」</b>を選びます。氏名は<b>ローマ字</b>（半角英字）で入力します。
          </p>
          <Phone>
            <Screen logo={<PayoneerLogo />}>
              <Field label="アカウント種別" value="個人 / Individual" ok />
              <Field label="名 / First name" value="TARO" />
              <Field label="姓 / Last name" value="YAMADA" />
            </Screen>
          </Phone>
          <Warn>氏名は<b>身分証と完全一致</b>のローマ字に（eBayの表示名とも揃える）。ここがズレると後の審査で止まります。</Warn>
        </StepCard>

        {/* STEP 9 — 連絡先情報（最重要） */}
        <section className="bg-white rounded-2xl border-2 border-[#BF0000]/40 shadow-sm p-4">
          <div className="flex items-center gap-2.5 mb-1">
            <span className="w-7 h-7 rounded-full bg-[#BF0000] text-white flex items-center justify-center text-sm font-black shrink-0">9</span>
            <h2 className="text-[14px] font-black text-gray-800 leading-snug">連絡先情報（★一番つまずく所）</h2>
          </div>
          <p className="text-[11px] text-[#BF0000] font-bold mb-3">ここで「次へ」が押せない人が続出！下の3つを必ず守って 👇</p>
          <div className="space-y-3">
            <Phone>
              <Screen logo={<PayoneerLogo />}>
                <Field label="番地（Street address）" value="1-2-3 Marunouchi ▼候補から選ぶ" ok />
                <p className="text-[11px] text-[#BF0000] font-bold leading-relaxed">
                  ① ただ打つだけはNG。<b>出てきた候補をタップ</b>、または
                  <b>「Enter address manually（手動入力）」</b>を押して<b>確定</b>させる！
                </p>
                <Field label="都市名 / City（必須）" value="Chiyoda-ku" ok />
                <p className="text-[11px] text-[#BF0000] font-bold">② <b>City（都市名）</b>を必ず埋める（空だと進めません）</p>
                <Field label="都道府県 / State" value="Tokyo" />
                <Field label="郵便番号 / ZIP" value="100-0005" />
                <Field label="携帯番号（+81）" value="9012345678" ok />
                <p className="text-[11px] text-[#BF0000] font-bold">③ 電話は<b>先頭の0を取る</b>（090… → 90…）</p>
                <Field label="SMS認証コード" value="届いた6桁を最新で入力" />
              </Screen>
            </Phone>
            <Warn>
              <b>「次へ」が押せない3大原因</b>：<br />
              ① 住所を<b>候補/手動入力で確定</b>していない<br />
              ② <b>City（都市名）が空</b><br />
              ③ 電話に<b>先頭の0が付いている</b>
            </Warn>
            <p className="text-[12px] text-gray-500 leading-relaxed">
              SMS認証コードは数分で期限切れ。<b>コードを入れたら他をいじらず</b>、すぐ「次へ」を押すのがコツ。
              古いコードが残っていたら、届いた<b>最新の6桁</b>に入れ直してください。
            </p>
          </div>
        </section>

        {/* STEP 10 — KYC */}
        <StepCard n={10} title="本人確認（KYC）: 書類番号の入力 or 書類を撮影してアップロード">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            <b>本人確認（KYC）</b>＝Payoneerが「本人かどうか」を確認する手続き。
            <b>書類番号を入力</b>するか、画面の案内で<b>書類を撮影してアップロード</b>します。
          </p>
          <Phone>
            <Screen logo={<PayoneerLogo />}>
              <Field label="本人確認書類の種類" value="運転免許証 / マイナンバー / パスポート" />
              <Field label="書類番号" value="番号を入力（例: 免許証番号）" />
              <p className="text-[11px] text-gray-500 flex items-center gap-1">
                <Camera size={13} className="text-gray-400 shrink-0" />
                環境によっては<b>書類の撮影アップロード</b>を求められます
              </p>
            </Screen>
          </Phone>
          <Warn>
            身分証の<b>名義と住所</b>も、eBay／Payoneerと<b>同じローマ字表記</b>に揃えて。<br />
            撮影する時は<b>明るい場所で・全体がはっきり</b>写るように。反射やブレに注意。
          </Warn>
        </StepCard>

        {/* STEP 11 — 銀行口座 */}
        <StepCard n={11} title="受け取り銀行口座を登録する">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            売上を最終的に振り込んでもらう<b>あなたの銀行口座</b>を登録します（<b>本人名義</b>）。
          </p>
          <Phone>
            <Screen logo={<PayoneerLogo />}>
              <Field label="銀行名 / Bank" value="〇〇銀行" />
              <Field label="支店・口座番号" value="支店名・口座番号（本人名義）" />
              <Field label="口座名義（ローマ字）" value="TARO YAMADA" ok />
            </Screen>
          </Phone>
          <Tip>口座名義は<b>通帳・キャッシュカードのローマ字表記</b>と同じに。氏名と一致していれば安心です。</Tip>
        </StepCard>

        {/* STEP 12 — 申請完了 */}
        <StepCard n={12} title="「おめでとうございます！」＝Payoneerへの申請完了">
          <p className="text-[13px] text-gray-600 leading-relaxed">この画面が出たら、Payoneerへの<b>申請は送信完了</b>です。</p>
          <Phone>
            <Screen logo={<PayoneerLogo />}>
              <p className="text-[13px] font-black text-[#1e9bff]">🎉 おめでとうございます！</p>
              <p className="text-[12px] text-gray-700">申請が正常に送信されました。審査中です。</p>
            </Screen>
          </Phone>
          <Warn>
            これは<b>「Payoneerへ申請できた」だけ</b>。eBayで<b>出品できる</b>ようになるには、
            このあとの<b>メール</b>と、ブロック3の<b>eBay側の手順＋本人確認の審査</b>がもう一段必要です。
          </Warn>
        </StepCard>

        {/* STEP 13 — Payoneerメール */}
        <StepCard n={13} title="メール: Payoneerから「アカウント有効化／承認」のお知らせが届く">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            申請後、Payoneerから<b>下のような内容のメール</b>が届きます。本文の<b>リンク／案内に従って</b>進めてください。
          </p>
          <MailCard
            from={<PayoneerLogo />}
            subject="（例）あなたのPayoneerアカウントについて"
            body="アカウントの有効化・確認をご案内する内容のメールです。本文中の案内に従い、必要ならリンクを押して手続きを完了します。"
            link="アカウントを確認する / Activate"
          />
          <Warn>
            ⚠️ 実際の<b>件名は環境によって変わります</b>（「ようこそ」「確認のお願い」など）。
            <b>差出人がPayoneer</b>で、<b>アカウントの有効化・確認</b>を案内する内容なら、それが該当メールです。
            <b>このメールが来ても、まだ出品はできません</b>（次のブロック3へ）。
          </Warn>
          <Tip>メールが見当たらない時は<b>迷惑メールフォルダ</b>も確認を。差出人で検索すると早く見つかります。</Tip>
        </StepCard>

        {/* ========== ブロック3 ========== */}
        <BlockTitle no="3" title="eBayに戻って完了 → 出品" sub="同期 → カード登録 → 送信 → 審査メール → アプリで公開！" />

        {/* STEP 14 — Sync */}
        <StepCard n={14} title="eBayに戻る → ② Sync（eBayとPayoneerを同期）→ Continue">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            Payoneerが終わると<b>eBayの「Set up selling account」に戻ります</b>。
            ②<b>Sync</b>では、Payoneerの氏名・住所がeBayに取り込まれるので、内容を確認して<b>「Continue」</b>を押します。
          </p>
          <Phone>
            <Screen logo={<EbayLogo />}>
              <p className="text-[12px] text-gray-700">② Sync eBay and Payoneer profiles</p>
              <p className="text-[11px] text-gray-500">Payoneerの氏名・住所が反映 → 内容を確認</p>
              <Tap><BlueBtn>Continue</BlueBtn></Tap>
            </Screen>
          </Phone>
          <Tip>戻れなかった時は、eBayの「Account → Selling」から<b>登録の続き</b>を開けます。</Tip>
        </StepCard>

        {/* STEP 15 — カード */}
        <StepCard n={15} title="③ Add financial info: 手数料用のカードを登録（VISA/Master）">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            売上から払えない手数料が出た時のために、<b>カードを1枚</b>登録します（<b>VISA／Master</b>）。
          </p>
          <Phone>
            <Screen logo={<EbayLogo />}>
              <p className="text-[12px] text-gray-700">③ Add your financial info</p>
              <Field label="カード番号" value="•••• •••• •••• ••••" />
              <Field label="有効期限 / セキュリティコード" value="MM/YY ・ •••" />
            </Screen>
          </Phone>
          <Tip>デビットカードでも登録できる場合があります。ブランドが<b>VISA/Master</b>かを確認。</Tip>
        </StepCard>

        {/* STEP 16 — Submit */}
        <StepCard n={16} title="④ Submit registration で送信する">
          <p className="text-[13px] text-gray-600 leading-relaxed">最後に登録情報を送信します。これでeBay側の申請は完了です。</p>
          <Phone>
            <Screen logo={<EbayLogo />}>
              <p className="text-[12px] text-gray-700">④ Submit registration info</p>
              <Tap><BlueBtn>Submit registration</BlueBtn></Tap>
            </Screen>
          </Phone>
        </StepCard>

        {/* STEP 17 — 準備OKメール */}
        <StepCard n={17} title="メール: 「アカウントの準備ができました」のお知らせが届く（＝出品解禁）">
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
            <Clock size={16} className="text-blue-500 shrink-0 mt-0.5" />
            <p className="text-[12px] text-blue-800 leading-relaxed">
              eBay／Payoneerが<b>本人確認（KYC）を審査</b>します。<b>早ければ数分、長いと数日</b>。
              完了すると<b>下のような内容のメール</b>が届きます。
            </p>
          </div>
          <MailCard
            from={<EbayLogo />}
            subject="（例）出品できる状態になりました"
            body="本人確認の審査が終わり、アカウントの準備が整ったことをお知らせする内容のメールです。これが出品解禁の合図です。"
            link="出品を始める / Start selling"
          />
          <Warn>
            ⚠️ <b>件名は環境によって変わります</b>（「準備ができました」「出品できます」など）。
            差出人が<b>eBay／Payoneer</b>で、<b>「準備OK・出品できる状態」</b>を知らせる内容ならそれが合図。
            この<b>メールが届くまで</b>は、アプリで出品しようとすると次のように待ち表示になります（正常）。
          </Warn>
          <Tip>「アカウントの最終確認待ち」と出ても<b>エラーではありません</b>。メールを待ってからもう一度どうぞ。</Tip>
        </StepCard>

        {/* STEP 18 — 完了・出品 */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[13px] font-black shrink-0">18</span>
            <h2 className="text-[14px] font-black text-emerald-800">準備OKメールが届いたら、アプリで出品！</h2>
          </div>
          <p className="text-[13px] text-emerald-800 leading-relaxed">
            セラー登録は完了！アプリ（輸出ラボ）に戻り、<b>「eBay簡単出品」→「確認できた・出品する」</b>を押すと、
            そのまま<b>公開（出品）</b>されます 🎈 これ以降は<b>1タップ</b>で出品できます。
          </p>
          <Phone>
            <Screen logo={<span className="font-black text-[13px] text-[#BF0000]">輸出ラボ</span>}>
              <p className="text-[12px] font-bold text-gray-800">eBay簡単出品</p>
              <p className="text-[11px] text-gray-500">写真だけで、そのまま公開できます</p>
              <Tap>
                <span className="inline-flex items-center justify-center h-9 px-5 rounded-full bg-[#BF0000] text-white text-[13px] font-bold">
                  確認できた・出品する
                </span>
              </Tap>
            </Screen>
          </Phone>
          <Link
            href="/guide/payoneer-withdraw"
            className="mt-3 inline-flex items-center gap-1 text-[12px] font-bold text-[#0064D2] underline underline-offset-2"
          >
            💴 売れたら → 売上の受け取り（Payoneer出金）の方法はこちら
          </Link>
        </div>

        {/* つまずき集 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="text-[13px] font-black text-gray-800 mb-2.5">よくあるつまずき（まとめ）</h2>
          <ul className="space-y-2 text-[12px] text-gray-700 leading-relaxed">
            <li>🔴 <b>「次へ」が押せない</b>（STEP9）→ 住所を<b>候補/手動入力で確定</b>＋<b>City（都市名）</b>を入力＋電話の<b>先頭0を取る</b>。この3つでほぼ解決。</li>
            <li>🔴 <b>「出品できませんでした」と長いエラー</b> → 実は<b>本人確認(KYC)の審査待ち</b>（STEP17）。<b>準備OKメール後</b>に再出品すればOK（故障ではありません）。</li>
            <li>🔴 <b>承認メールが来たのに出品できない</b> → それは<b>Payoneerの承認メール（STEP13）</b>。<b>出品解禁はeBayの準備OKメール（STEP17）</b>のほう。別物です。</li>
            <li>🔴 <b>審査で止まる</b> → 名前・住所を<b>身分証と完全一致</b>のローマ字に揃え直す。</li>
            <li>🔴 <b>メールが見つからない</b> → <b>迷惑メールフォルダ</b>を確認。差出人（eBay / Payoneer）で検索すると早い。</li>
          </ul>
        </div>

        <p className="text-center text-[11px] text-gray-400 pt-2 pb-6">
          ※ 画面は分かりやすさのための再現イラストです（入力例はすべてダミー）。eBay・Payoneerの実画面やメールの件名は、時期・環境により細部が異なる場合があります。
        </p>
      </main>
    </div>
  );
}
