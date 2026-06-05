import Link from "next/link";
import { ArrowLeft, ArrowRight, AlertCircle, CheckCircle, Globe, CreditCard, Truck, FileText, DollarSign, ExternalLink } from "lucide-react";

function StepNumber({ n, color = "bg-indigo-600" }: { n: number; color?: string }) {
  return (
    <div className={`w-8 h-8 rounded-full ${color} text-white flex items-center justify-center font-bold text-sm shrink-0`}>
      {n}
    </div>
  );
}

function SectionTitle({ icon: Icon, title, sub, color = "bg-indigo-50", iconColor = "text-indigo-600" }: {
  icon: React.ElementType; title: string; sub: string; color?: string; iconColor?: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className={`w-10 h-10 ${color} rounded-xl flex items-center justify-center shrink-0`}>
        <Icon size={20} className={iconColor} />
      </div>
      <div>
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        <p className="text-xs text-gray-500">{sub}</p>
      </div>
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 bg-indigo-50 border border-indigo-100 rounded-xl p-3 text-sm text-indigo-700">
      <CheckCircle size={15} className="shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 text-sm text-amber-700">
      <AlertCircle size={15} className="shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-0.5 text-indigo-600 underline underline-offset-2 hover:text-indigo-800">
      {children}<ExternalLink size={11} className="shrink-0" />
    </a>
  );
}

function FlowDiagram({ steps, bg }: { steps: { emoji: string; label: string }[]; bg: string }) {
  return (
    <div className="flex items-center mb-6 gap-1 overflow-x-auto pb-1">
      {steps.map((item, i) => (
        <div key={i} className="flex items-center gap-1 shrink-0">
          <div className="flex flex-col items-center gap-1">
            <div className={`w-11 h-11 ${bg} rounded-xl flex items-center justify-center text-lg`}>
              {item.emoji}
            </div>
            <span className="text-xs text-gray-500 text-center whitespace-pre-line leading-tight">{item.label}</span>
          </div>
          {i < steps.length - 1 && <ArrowRight size={13} className="text-gray-300 shrink-0 mb-4" />}
        </div>
      ))}
    </div>
  );
}

export default function GuidePage() {
  return (
    <div className="min-h-dvh bg-gray-50">
      <nav className="bg-white border-b border-gray-100 px-4 py-4 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg text-indigo-600">輸出で副業しようよ</Link>
        <Link href="/search" className="text-xs text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50">商品を探す</Link>
      </nav>

      <main className="max-w-xl mx-auto px-4 py-8 pb-16">
        <Link href="/search" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-6">
          <ArrowLeft size={14} /> 商品一覧に戻る
        </Link>

        <h1 className="text-2xl font-bold text-gray-900 mb-1">はじめてガイド</h1>
        <p className="text-sm text-gray-500 mb-8">eBayへの出品方法と、海外への発送手順をわかりやすく解説します。</p>

        {/* 目次 */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-6">
          <p className="text-xs font-semibold text-gray-500 mb-3">このページの内容</p>
          <div className="space-y-2">
            {[
              { href: "#ebay", label: "① eBayへの出品方法", color: "text-indigo-600" },
              { href: "#shipping", label: "② 海外への発送方法（EMS）", color: "text-indigo-600" },
              { href: "#faq", label: "③ よくある質問", color: "text-gray-600" },
            ].map((item) => (
              <a key={item.href} href={item.href} className={`block text-sm ${item.color} hover:underline`}>{item.label}</a>
            ))}
          </div>
        </div>

        {/* ============ eBay出品 ============ */}
        <section id="ebay" className="bg-white rounded-2xl border border-gray-200 p-5 mb-6">
          <SectionTitle icon={Globe} title="eBayへの出品方法" sub="アカウント作成から出品完了まで" />

          <FlowDiagram bg="bg-indigo-50" steps={[
            { emoji: "👤", label: "アカウント\n作成" },
            { emoji: "📸", label: "商品\n撮影" },
            { emoji: "📝", label: "出品\n登録" },
            { emoji: "💰", label: "売れた!" },
            { emoji: "📦", label: "発送" },
          ]} />

          {/* STEP 1 */}
          <div className="flex gap-3 mb-5">
            <StepNumber n={1} />
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 mb-1">eBayアカウントを作る</h3>
              <p className="text-sm text-gray-500 mb-2">
                <ExtLink href="https://www.ebay.com/">ebay.com</ExtLink> にアクセスし「Register」から登録。メールアドレスとパスワードだけで作れます。
              </p>
              <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-500 space-y-1">
                <p>① <ExtLink href="https://signup.ebay.com/">ebay.com/register</ExtLink> を開く</p>
                <p>② 右上「Register」をクリック</p>
                <p>③ 名前・メール・パスワードを入力</p>
                <p>④ 「Create account」で完了</p>
              </div>
              <div className="mt-2">
                <Tip>まず「Buyer」として登録し、出品時に自動的に「Seller」になります</Tip>
              </div>
            </div>
          </div>

          {/* STEP 2 */}
          <div className="flex gap-3 mb-5">
            <StepNumber n={2} />
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 mb-1">商品を撮影する</h3>
              <p className="text-sm text-gray-500 mb-2">写真がよければ高く売れます。明るい場所でスマホで十分です。</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { icon: "☀️", title: "自然光で撮る", desc: "窓際が最適。暗いと安く見える" },
                  { icon: "🔄", title: "複数アングル", desc: "前・後・横・細部を撮る" },
                  { icon: "📏", title: "サイズ感を出す", desc: "定規や手を添えると◎" },
                  { icon: "🚫", title: "傷は必ず撮る", desc: "隠すとトラブルのもと" },
                ].map((item) => (
                  <div key={item.title} className="bg-gray-50 rounded-xl p-3">
                    <p className="text-base mb-1">{item.icon}</p>
                    <p className="text-xs font-semibold text-gray-700">{item.title}</p>
                    <p className="text-xs text-gray-400">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* STEP 3 */}
          <div className="flex gap-3 mb-5">
            <StepNumber n={3} />
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 mb-1">出品登録する</h3>
              <p className="text-sm text-gray-500 mb-2">
                <ExtLink href="https://www.ebay.com/sh/lst/active">Seller Hub</ExtLink> または「Sell」ボタンから出品できます。
              </p>
              <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-600 space-y-2">
                <div className="flex gap-2">
                  <span className="bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-bold shrink-0">タイトル</span>
                  <span>英語で商品名を書く。「Pokemon Card Box Scarlet Violet Japanese」のようにキーワードを詰める</span>
                </div>
                <div className="flex gap-2">
                  <span className="bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-bold shrink-0">カテゴリ</span>
                  <span>検索して近いカテゴリを選ぶ</span>
                </div>
                <div className="flex gap-2">
                  <span className="bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-bold shrink-0">状態</span>
                  <span>New / Like New / Very Good / Good / Acceptable から選ぶ</span>
                </div>
                <div className="flex gap-2">
                  <span className="bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-bold shrink-0">価格</span>
                  <span>「Fixed Price（即決）」がおすすめ。<ExtLink href="https://www.ebay.com/sh/res/search">Sold Listings</ExtLink> で相場を確認して設定</span>
                </div>
                <div className="flex gap-2">
                  <span className="bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-bold shrink-0">送料</span>
                  <span>「International shipping」で日本から発送可能な国を指定。EMSが扱いやすい</span>
                </div>
              </div>
              <div className="mt-2 space-y-2">
                <Tip>説明文は短くてOK。状態・サイズ・同梱物だけ書けば十分です</Tip>
                <Warn>eBay手数料は最終落札価格の約13.25%です。価格設定に織り込みましょう</Warn>
              </div>
            </div>
          </div>

          {/* STEP 4 */}
          <div className="flex gap-3">
            <StepNumber n={4} />
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 mb-1">支払い受け取り（Payoneer）</h3>
              <p className="text-sm text-gray-500 mb-2">
                eBayの売上は <ExtLink href="https://www.payoneer.com/ja/">Payoneer</ExtLink> で受け取り、日本の銀行口座に振り込めます。
              </p>
              <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-500 space-y-1">
                <p>① <ExtLink href="https://www.payoneer.com/ja/accounts/register/">payoneer.com</ExtLink> でアカウント作成</p>
                <p>② eBayの <ExtLink href="https://www.ebay.com/sh/fin/payouts">Seller Hub &gt; 支払い設定</ExtLink> でPayoneerと連携</p>
                <p>③ 売上は自動でPayoneerに入金</p>
                <p>④ 日本の銀行口座に出金（手数料約1.2%）</p>
              </div>
            </div>
          </div>
        </section>

        {/* ============ 国際発送 ============ */}
        <section id="shipping" className="bg-white rounded-2xl border border-gray-200 p-5 mb-6">
          <SectionTitle icon={Truck} title="海外への発送方法" sub="郵便局EMS がいちばん簡単でおすすめ" />

          <div className="mb-5">
            <p className="text-sm font-semibold text-gray-700 mb-2">発送方法の比較</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left p-2 border border-gray-100 text-gray-500">方法</th>
                    <th className="text-left p-2 border border-gray-100 text-gray-500">料金目安</th>
                    <th className="text-left p-2 border border-gray-100 text-gray-500">日数</th>
                    <th className="text-left p-2 border border-gray-100 text-gray-500">追跡</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: "EMS（郵便局）", href: "https://www.post.japanpost.jp/int/service/ems.html", price: "¥2,500〜", days: "3〜5日", track: "✅", highlight: true },
                    { name: "国際小形包装物", href: "https://www.post.japanpost.jp/int/service/small_packet.html", price: "¥1,000〜", days: "7〜14日", track: "✅", highlight: false },
                    { name: "FedEx / DHL", href: "https://www.fedex.com/ja-jp/", price: "¥3,500〜", days: "1〜3日", track: "✅", highlight: false },
                  ].map((row) => (
                    <tr key={row.name} className={row.highlight ? "bg-indigo-50" : ""}>
                      <td className="p-2 border border-gray-100 font-medium text-gray-700">
                        <a href={row.href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline underline-offset-1">{row.name}</a>
                        {row.highlight && <span className="text-indigo-500 text-xs ml-1">★おすすめ</span>}
                      </td>
                      <td className="p-2 border border-gray-100 text-gray-500">{row.price}</td>
                      <td className="p-2 border border-gray-100 text-gray-500">{row.days}</td>
                      <td className="p-2 border border-gray-100 text-gray-500">{row.track}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              ※ 料金詳細は <ExtLink href="https://www.post.japanpost.jp/int/charge/list/index.html">郵便局 国際郵便料金表</ExtLink> で確認できます
            </p>
          </div>

          <p className="text-sm font-semibold text-gray-700 mb-3">EMSで送る手順</p>

          <div className="flex gap-3 mb-4">
            <StepNumber n={1} />
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 mb-1">梱包する</h3>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {[
                  { emoji: "📦", label: "箱に入れる" },
                  { emoji: "🫧", label: "プチプチで包む" },
                  { emoji: "📏", label: "サイズ・重さを計る" },
                ].map((item) => (
                  <div key={item.label} className="bg-gray-50 rounded-xl p-2 flex flex-col items-center gap-1">
                    <span className="text-xl">{item.emoji}</span>
                    <span className="text-xs text-gray-500 text-center">{item.label}</span>
                  </div>
                ))}
              </div>
              <Tip>プチプチは100均で十分。壊れやすいものは二重にしましょう</Tip>
            </div>
          </div>

          <div className="flex gap-3 mb-4">
            <StepNumber n={2} />
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 mb-1">税関申告書を書く</h3>
              <p className="text-sm text-gray-500 mb-2">郵便局の窓口に持っていくと、タブレットで入力できます。</p>
              <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-600 space-y-1.5">
                <div className="flex gap-2"><FileText size={12} className="text-gray-400 shrink-0 mt-0.5" /><span><b>内容品名（英語）</b>　例：Trading Card / Toy / Electronics</span></div>
                <div className="flex gap-2"><FileText size={12} className="text-gray-400 shrink-0 mt-0.5" /><span><b>数量</b>　1個なら「1」</span></div>
                <div className="flex gap-2"><DollarSign size={12} className="text-gray-400 shrink-0 mt-0.5" /><span><b>価格（USD）</b>　実際の販売価格を正直に書く</span></div>
                <div className="flex gap-2"><FileText size={12} className="text-gray-400 shrink-0 mt-0.5" /><span><b>用途</b>　「Sale（販売）」を選ぶ</span></div>
              </div>
              <div className="mt-2">
                <Warn>価格を低く申告する「低価格申告」は違法です。正直に書きましょう</Warn>
              </div>
            </div>
          </div>

          <div className="flex gap-3 mb-4">
            <StepNumber n={3} />
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 mb-1">郵便局の窓口で発送</h3>
              <p className="text-sm text-gray-500 mb-2">
                「EMSで送りたいです」と伝えるだけでOK。<ExtLink href="https://www.post.japanpost.jp/int/service/ems.html">EMS詳細はこちら</ExtLink>
              </p>
              <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-500 space-y-1">
                <p>✅ 持ち物：梱包済みの荷物・届け先住所</p>
                <p>✅ 支払い：その場で現金かカード</p>
                <p>✅ 追跡番号のレシートを必ずもらう</p>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <StepNumber n={4} />
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 mb-1">eBayに追跡番号を登録する</h3>
              <p className="text-sm text-gray-500 mb-2">発送したらすぐに <ExtLink href="https://www.ebay.com/sh/ord/">eBay Seller Hub &gt; Orders</ExtLink> へ追跡番号を入力します。</p>
              <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-500 space-y-1">
                <p>① eBay「Orders」から該当の注文を開く</p>
                <p>② 「Add tracking number」をクリック</p>
                <p>③ 追跡番号と「Japan Post (EMS)」を入力</p>
                <p>④ 「Submit」で完了</p>
              </div>
              <div className="mt-2">
                <Tip>追跡番号を入れると買い手に自動通知が届き、評価アップにつながります</Tip>
              </div>
            </div>
          </div>
        </section>

        {/* ============ よくある質問 ============ */}
        <section id="faq" className="bg-white rounded-2xl border border-gray-200 p-5 mb-6">
          <SectionTitle icon={CreditCard} title="よくある質問" sub="はじめての方が迷うポイント" />
          <div className="space-y-4">
            {[
              {
                q: "英語ができなくても大丈夫？",
                a: "大丈夫です。商品タイトルや説明文はChatGPTに「この商品の英語の出品文を書いて」と頼めばすぐ作ってもらえます。",
              },
              {
                q: "売れなかったらどうする？",
                a: "一定期間後に自動で出品終了になるだけです。手数料は売れたときだけかかるので、売れなくても損はありません。",
              },
              {
                q: "クレームが来たらどうする？",
                a: "まず謝罪し返金or再送を提案しましょう。eBayはバイヤー保護が強いので、誠実に対応することが大切です。",
              },
              {
                q: "確定申告は必要？",
                a: "副業収入が年間20万円を超える場合は確定申告が必要です。領収書や発送記録をとっておきましょう。",
              },
            ].map((faq) => (
              <div key={faq.q} className="border-b border-gray-100 pb-4 last:border-0 last:pb-0">
                <p className="text-sm font-semibold text-gray-800 mb-1">Q. {faq.q}</p>
                <p className="text-sm text-gray-500">A. {faq.a}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="text-center">
          <Link href="/search" className="inline-block px-8 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors">
            さっそく商品を探す
          </Link>
        </div>
      </main>
    </div>
  );
}
