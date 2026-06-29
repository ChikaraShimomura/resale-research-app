import Link from "next/link";
import { Gift } from "lucide-react";
import { getCurrentUserEmail } from "../lib/auth/plan";
import { getTrialInfo } from "../lib/billing";
import { PLANS, PAYWALL_ENABLED } from "../lib/plans";

// 無料トライアル中の人に「あと◯日／その後は月¥X で自動継続」を予告するバナー。
// 目的＝①透明性（自動課金になることを事前に伝え“知らずに課金”を防ぐ）②期間中に価値を使い切ってもらう誘導。
// trialing でなければ何も出さない。PAYWALL_ENABLED が立っている時のみ意味を持つ。
export default async function TrialBanner({ className = "" }: { className?: string }) {
  if (!PAYWALL_ENABLED) return null;
  const info = await getTrialInfo(await getCurrentUserEmail());
  if (!info) return null; // trialing でなければ何も描画しない＝空マージンも残らない
  const price = PLANS[info.plan]?.priceJpy ?? 0;
  const planName = PLANS[info.plan]?.name ?? "";

  return (
    <div className={`rounded-2xl border border-[#A98B5C]/40 bg-[#A98B5C]/[0.08] p-3.5 shadow-sm ${className}`}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-[#A98B5C]" aria-hidden="true"><Gift size={18} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-black text-[#2D323B] leading-snug">
            無料期間はあと <span className="text-[#A98B5C]">{info.daysLeft}日</span>
            {info.daysLeft <= 3 ? "（まもなく終了）" : ""}
          </p>
          <p className="text-[11px] text-gray-600 leading-relaxed mt-0.5">
            <span className="whitespace-nowrap">その後は<b className="text-[#2D323B]">{planName}・月¥{price.toLocaleString("ja-JP")}</b>で自動継続。</span><wbr />
            <span className="whitespace-nowrap">今のうちに儲かる中古をたくさん探そう。</span>
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Link href="/catalog"
              className="inline-flex items-center h-9 px-4 rounded-xl bg-[#2D323B] text-white text-[12px] font-bold active:bg-[#1A1D23]">
              中古カタログを見る →
            </Link>
            <Link href="/settings" className="text-[11px] text-gray-500 underline underline-offset-2">
              プラン・解約の管理
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
