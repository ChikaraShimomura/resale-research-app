import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";

export const metadata: Metadata = {
  title: "利用規約",
  description: "輸出ラボの利用規約。サービス内容・利用者の責任・免責・禁止事項などの取り扱いについて。",
  alternates: { canonical: "https://www.yushutsu-fukugyo.com/terms" },
};

// ⚠️ これは法的な叩き台です。本番運用（特に有料化）の前に、行政書士・弁護士の確認を受けてください。
// 〔運営者名〕〔所在地〕〔管轄裁判所〕は実情報に置き換えること（特商法表記とも整合させる）。

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7 first:mt-0">
      <h2 className="flex items-center gap-2 text-[15px] font-black text-gray-900 mb-2">
        <span aria-hidden="true" className="w-1 h-4 bg-[#2D323B] rounded-full shrink-0" />
        {title}
      </h2>
      <div className="space-y-2 text-[13px] text-gray-600 leading-relaxed">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden="true" className="mt-[7px] shrink-0 w-1 h-1 rounded-full bg-[#2D323B]" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

export default function TermsPage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header className="bg-[#2D323B] sticky top-0 z-20 shadow-sm" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-3 flex items-center gap-2 max-w-2xl mx-auto">
          <Link href="/" aria-label="戻る"
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/20 text-white text-xl font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <h1 className="text-white font-black text-base">利用規約</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-3">
        <article className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-4">
          <p className="text-[13px] text-gray-600 leading-relaxed mb-1">
            本利用規約（以下「本規約」）は、輸出ラボ（以下「本サービス」）の利用条件を定めるものです。利用者は、本サービスを登録・利用することで本規約に同意したものとみなされます。
          </p>

          <Section title="第1条（本サービスの内容）">
            <p>本サービスは、楽天市場等で販売される商品の情報をもとに、海外（eBay等）での想定相場・想定利益などを参考情報として表示し、出品作業を補助するツールです。</p>
            <p>表示される相場・利益率・価格はいずれも<strong className="font-bold text-gray-900">想定・目安</strong>であり、その正確性・最新性・実現性を保証するものではありません。本サービスは利用者の利益・売上・成果を一切保証しません。</p>
          </Section>

          <Section title="第2条（アカウント登録）">
            <Bullets items={[
              "利用には会員登録（メールアドレス等）が必要です。登録情報は正確かつ最新の内容を維持してください。",
              "アカウントの管理責任は利用者にあります。第三者への貸与・共有はできません。",
              "登録情報の取り扱いは、別途定めるプライバシーポリシーによります。",
            ]} />
          </Section>

          <Section title="第3条（料金）">
            <p>本サービスには無料で利用できる範囲と、有料プランがあります。現時点では一部機能を無料で提供していますが、将来、有料プランへの移行・課金を行う場合があります。</p>
            <p>有料プランを提供する際は、料金・支払方法・提供時期・解約方法・返金の可否等を、別途「特定商取引法に基づく表記」および申込画面で明示します。</p>
          </Section>

          <Section title="第4条（利用者の責任）">
            <p>本サービスは情報提供・作業補助を行うツールであり、実際の仕入れ・出品・販売・発送・輸出は利用者自身の責任と判断で行うものです。利用者は、自らの取引について以下を自身の責任で確認・遵守します。</p>
            <Bullets items={[
              "eBay・楽天・Payoneer等、利用する各サービスの利用規約・ポリシーを遵守すること。違反による利用停止・アカウント閉鎖等の責任は利用者が負います。",
              "出品・販売・輸出する商品が、各プラットフォームの規約および関係法令（関税法・外為法・輸出規制、薬機法、その他の各種規制）に適合していること。危険物・輸出禁制品・各国の規制品等の発送可否は利用者が確認すること。",
              "中古品を反復継続して仕入れ・転売する場合は、古物営業法上の古物商許可が必要となる場合があります。許可の要否は利用者自身でご確認ください（新品の転売には原則不要とされています）。",
              "在庫を持たずに出品する形態（いわゆる無在庫）は、各プラットフォームの規約で制限・禁止される場合があります。採用の可否・リスクは利用者の責任で判断すること。",
              "出品に用いる商品画像・文章等の知的財産権・利用許諾を確認すること。可能な限り、利用者自身が撮影した実物写真の使用を推奨します。",
              "売上・利益・税務（確定申告等）に関する一切の取り扱い。",
            ]} />
          </Section>

          <Section title="第5条（禁止事項）">
            <Bullets items={[
              "法令・公序良俗・各プラットフォーム規約に違反する行為。",
              "本サービスの運営を妨害する行為、不正アクセス、過度な自動取得（スクレイピング等）。",
              "第三者の権利（知的財産権・プライバシー等）を侵害する行為。",
              "虚偽の情報による登録、アカウントの不正利用・共有。",
            ]} />
          </Section>

          <Section title="第6条（免責）">
            <Bullets items={[
              "本サービスが表示する相場・利益・価格・カテゴリ等の情報は想定・目安であり、正確性・実現性・特定目的への適合性を保証しません。",
              "本サービスの利用または利用できなかったことにより利用者に生じた損害について、本サービスは責任を負いません。ただし、本サービスの故意または重大な過失による場合はこの限りではありません。",
              "外部サービス（eBay・楽天・決済事業者等）の仕様変更・停止・障害により生じた不利益について、本サービスは責任を負いません。",
            ]} />
            <p className="text-[12px] text-gray-400">※ 消費者契約法その他の強行法規に反する範囲では、上記免責は適用されません。</p>
          </Section>

          <Section title="第7条（サービスの変更・中断・終了）">
            <p>本サービスは、事前の通知なく、内容の変更・追加・中断・終了を行うことがあります。これにより利用者に生じた損害について、前条の範囲で責任を負いません。</p>
          </Section>

          <Section title="第8条（個人情報の取り扱い）">
            <p>個人情報の取り扱いについては、別途定める<Link href="/privacy" className="text-[#2D323B] underline">プライバシーポリシー</Link>によります。</p>
          </Section>

          <Section title="第9条（規約の変更）">
            <p>本サービスは、必要に応じて本規約を変更することがあります。変更後の規約は本ページに掲示した時点から効力を生じます。重要な変更は本サービス上で告知します。</p>
          </Section>

          <Section title="第10条（準拠法・管轄）">
            <p>本規約は日本法に準拠します。本サービスに関して紛争が生じた場合は、〔運営者所在地を管轄する裁判所〕を第一審の専属的合意管轄裁判所とします。</p>
          </Section>

          <p className="mt-7 text-[12px] text-gray-400">制定日：2026年6月18日 ／ 運営者：〔運営者名〕</p>
        </article>
      </main>

      <BottomNav />
    </div>
  );
}
