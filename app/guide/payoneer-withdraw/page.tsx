import Link from "next/link";
import { ArrowLeft, AlertTriangle, Check, Landmark, Hand, Clock, Wallet } from "lucide-react";

export const metadata = {
  title: "Payoneerから日本の銀行口座へ出金する方法（画像つき） | 輸出ラボ",
  description:
    "eBayの売上はPayoneerに入ります。そこから日本の銀行口座へ出金（引き出し）する方法を、どこを押す・何を入れるか画像つきで一歩ずつ。手数料・着金日数も。",
};

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

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      <div className="flex items-center h-8 px-2.5 bg-gray-50 border-b border-gray-100">
        <PayoneerLogo />
      </div>
      <div className="p-3 space-y-2">{children}</div>
    </div>
  );
}

function Tap({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-flex">
      <span className="absolute -inset-1 rounded-xl ring-2 ring-[#BF0000] animate-pulse" aria-hidden="true" />
      <span className="relative">{children}</span>
      <span className="absolute -right-2 -bottom-3 text-[#BF0000]"><Hand size={18} /></span>
    </span>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center h-8 px-4 rounded-lg bg-gray-100 text-gray-700 text-[12px] font-bold">
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

export default function PayoneerWithdrawGuide() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA]">
      <header className="bg-gradient-to-r from-[#BF0000] to-[#BF0000] px-3 py-2.5 shadow-sm sticky top-0 z-20">
        <div className="max-w-2xl mx-auto flex items-center gap-2">
          <Link href="/guide" aria-label="戻る" className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 text-white shrink-0">
            <ArrowLeft size={18} />
          </Link>
          <span className="text-white font-black text-[15px]">売上を受け取る（Payoneer出金）</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-3">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Wallet size={18} className="text-[#BF0000]" />
            <h2 className="text-[14px] font-black text-gray-800">eBayの売上 → あなたの銀行口座へ</h2>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">
            eBayで売れたお金は、まず<b>Payoneer</b>に入ります。そこから<b>日本の銀行口座へ「出金（引き出し）」</b>して、
            やっと手元のお金になります。やり方を一歩ずつ案内します（初回の口座登録だけ少し待ちます）。
          </p>
        </div>

        {/* 用意 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="text-[13px] font-black text-gray-800 mb-2.5">用意するもの</h2>
          <ul className="space-y-2 text-[13px] text-gray-700">
            <li className="flex items-center gap-2"><Landmark size={16} className="text-[#BF0000]" /> 出金先の<b>銀行口座</b>（あなた本人名義）</li>
          </ul>
          <p className="mt-2.5 text-[11px] text-[#BF0000] font-bold">
            ⚠️ 口座の<b>名義は、Payoneer登録名と完全一致</b>（ローマ字）。違うと出金できません。
          </p>
        </div>

        {/* STEP 1 */}
        <StepCard n={1} title="Payoneerにログインする">
          <p className="text-[13px] text-gray-600 leading-relaxed">
            <a href="https://login.payoneer.com/" target="_blank" rel="noopener noreferrer" className="text-[#0064D2] font-bold underline">login.payoneer.com</a> から、登録したメール・パスワードでログイン。
          </p>
        </StepCard>

        {/* STEP 2 */}
        <StepCard n={2} title="出金先の銀行口座を登録（初回だけ）">
          <Screen>
            <p className="text-[12px] text-gray-700">設定 → 銀行口座 → 銀行口座を追加</p>
            <Field label="銀行名・支店・口座番号" value="あなたの口座（本人名義）" />
            <Field label="口座名義（ローマ字）" value="TARO YAMADA（Payoneerと同じ）" ok />
          </Screen>
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
            <Clock size={16} className="text-blue-500 shrink-0 mt-0.5" />
            <p className="text-[12px] text-blue-800 leading-relaxed">
              口座の<b>審査に最大3営業日</b>かかります（初回だけ）。次回からは即出金できます。
            </p>
          </div>
        </StepCard>

        {/* STEP 3 */}
        <StepCard n={3} title="メニューから「引き出し」→「銀行口座宛」を選ぶ">
          <Screen>
            <p className="text-[12px] text-gray-700">上部メニュー</p>
            <Tap><Pill>引き出し</Pill></Tap>
            <p className="text-[11px] text-gray-500">→ 出てきた中から <b>「銀行口座宛」</b> を選ぶ</p>
          </Screen>
        </StepCard>

        {/* STEP 4 */}
        <StepCard n={4} title="出金する金額を入力する">
          <Screen>
            <Field label="出金先" value="登録した銀行口座（円）" ok />
            <Field label="金額" value="例: $200 → 約30,000円（為替で変動）" />
            <p className="text-[11px] text-gray-500">USD残高を円で受け取ると、両替（為替）も同時に行われます</p>
          </Screen>
          <Warn>
            <b>手数料の目安</b>：出金手数料が<b>取引額の約1〜2%</b>＋（USD→円のとき）<b>為替手数料 最大2%</b>。
            少額（$100未満）は最低$1。<b>まとめて出金</b>した方が手数料率は下がります。
          </Warn>
        </StepCard>

        {/* STEP 5 */}
        <StepCard n={5} title="内容を確認して「送信」→ 着金を待つ">
          <Screen>
            <p className="text-[12px] text-gray-700">金額・手数料・着金額を確認</p>
            <Tap><Pill>送信する</Pill></Tap>
          </Screen>
          <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2.5">
            <Check size={16} className="text-emerald-600 shrink-0 mt-0.5" />
            <p className="text-[12px] text-emerald-800 leading-relaxed">
              手続き後に確認メールが届き、<b>3〜5営業日</b>で銀行口座に着金します🎉
            </p>
          </div>
        </StepCard>

        {/* 手数料まとめ */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="text-[13px] font-black text-gray-800 mb-2.5">手数料・日数まとめ</h2>
          <ul className="space-y-1.5 text-[12px] text-gray-700 leading-relaxed">
            <li>💴 出金手数料：取引額の<b>約1〜2%</b>（少額は最低$1）</li>
            <li>💱 為替手数料：USD→円のとき<b>最大2%</b>上乗せ</li>
            <li>🏦 口座登録の審査：初回<b>最大3営業日</b></li>
            <li>⏱ 着金：手続き後<b>3〜5営業日</b></li>
            <li>👤 <b>口座名義はPayoneer登録名と完全一致</b>（一番のつまずき）</li>
          </ul>
        </div>

        {/* つまずき */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="text-[13px] font-black text-gray-800 mb-2.5">よくあるつまずき</h2>
          <ul className="space-y-2 text-[12px] text-gray-700 leading-relaxed">
            <li>🔴 <b>出金できない</b> → 口座名義がPayoneerの名前と<b>不一致</b>。ローマ字表記まで合わせる</li>
            <li>🔴 <b>すぐ出金できない</b> → 初回は<b>口座審査(最大3営業日)</b>がある。次回から即OK</li>
            <li>🔴 <b>手数料が高く感じる</b> → こまめより<b>まとめて出金</b>。為替分も考え、円安のタイミングが有利</li>
          </ul>
        </div>

        <div className="text-center pt-2 pb-6">
          <Link href="/guide/ebay-seller" className="text-[12px] font-bold text-[#0064D2] underline underline-offset-2">
            ← eBayセラー登録ガイドに戻る
          </Link>
        </div>
      </main>
    </div>
  );
}
