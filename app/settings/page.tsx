import type { Metadata } from "next";
import Link from "next/link";
import AuthButton from "../components/AuthButton";
import BottomNav from "../components/BottomNav";
import PushSettings from "../components/PushSettings";
import InstallButton from "../components/InstallButton";
import MfaSetup from "../components/MfaSetup";
import { getPlan } from "../lib/auth/plan";
import { getActorId } from "../lib/auth/actor";
import { listDealsForUser } from "../lib/ebay/stats";
import { PLANS, PAYWALL_ENABLED } from "../lib/plans";

// 「輸出ラボアカウント設定」＝このサービス自体のアカウント設定（アプリ追加・プラン/課金・2段階認証・通知）。
// eBay連携・送料・発送元などの「eBayアカウント設定」は別ページ /settings/ebay に分離（混在を避ける）。
export const metadata: Metadata = {
  title: "輸出ラボアカウント設定",
  robots: { index: false },
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const justSubscribed = sp.billing === "success"; // Checkout完了の戻り先(/settings?billing=success)＝直後の次アクションを出す
  const plan = await getPlan();
  const isAdminUser = plan === "admin";
  const isPaid = plan === "amateur" || plan === "veteran" || plan === "pro";
  // 使用量メーター（同時出品数 / 上限）。購読者のみ・eBay未連携なら0。
  const limit = PLANS[plan].listingLimit;
  let liveCount = 0;
  if (PAYWALL_ENABLED && isPaid) {
    try {
      const actor = await getActorId();
      if (actor) liveCount = (await listDealsForUser(actor)).live.length;
    } catch {
      /* 取得失敗は0扱い（メーターは控えめに） */
    }
  }
  const nearLimit = Number.isFinite(limit) && limit > 0 && liveCount / limit >= 0.8;
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header className="bg-gradient-to-r from-[#2D323B] to-[#2D323B] shadow-sm sticky top-0 z-20"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <Link href="/mypage" aria-label="マイページに戻る"
            className="w-11 h-11 flex items-center justify-center rounded-full bg-white/20 text-white text-xl font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <span className="text-white font-black text-base tracking-tight">輸出ラボアカウント設定</span>
          <div className="ml-auto"><AuthButton /></div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-3 space-y-3">
        {/* 課金直後の“次アクション”＝買った直後の離脱を防ぐ。中古カタログ/ランキングへすぐ送る。 */}
        {justSubscribed && (
          <section className="bg-gradient-to-br from-[#2D323B] to-[#1A1D23] text-white rounded-2xl p-5 shadow-md text-center">
            <p className="text-base font-black mb-1.5">ご加入ありがとうございます</p>
            <p className="text-[12px] text-white/85 leading-relaxed mb-4">
              {plan === "amateur"
                ? "30日間の無料期間がスタートしました（期間中はいつでも解約OK）。"
                : "ご利用ありがとうございます。"}
              <wbr />さっそく、いま儲かる中古を探しましょう。
            </p>
            <div className="flex gap-2">
              <Link href="/catalog"
                className="flex-1 inline-flex items-center justify-center h-11 rounded-xl bg-white text-[#2D323B] text-sm font-black active:opacity-90">
                中古カタログを見る →
              </Link>
              <Link href="/ranking"
                className="inline-flex items-center justify-center h-11 px-4 rounded-xl bg-white/15 text-white text-sm font-bold active:bg-white/25">
                ランキング
              </Link>
            </div>
          </section>
        )}

        {/* アプリとして使う（ホーム画面に追加）＝バナーを閉じた後でもいつでもここから追加できる常設導線 */}
        <section className="bg-white rounded-2xl p-4 border border-[#A98B5C]/25 shadow-sm">
          <InstallButton />
        </section>

        {/* プラン（PAYWALL_ENABLED時のみ表示）。現在のプラン・申込/解約・管理者導線。 */}
        {(PAYWALL_ENABLED || isAdminUser) && (
          <section className="bg-white rounded-2xl p-4 border border-[#A98B5C]/25 shadow-sm">
            <h2 className="text-sm font-black text-gray-800 mb-1">プラン</h2>
            <p className="text-[13px] text-gray-600 mb-3">
              現在のプラン：<b className="text-[#2D323B]">{PLANS[plan].name}</b>
            </p>

            {/* 使用量メーター（同時出品 X / 上限）。上限が近い/到達ならアップグレードを促す。 */}
            {PAYWALL_ENABLED && isPaid && Number.isFinite(limit) && (
              <div className="mb-3">
                <div className="flex items-center justify-between text-[12px] text-gray-600 mb-1">
                  <span>同時出品</span>
                  <span className="tabular-nums font-bold text-gray-800">{liveCount} / {limit}件</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className={`h-full ${liveCount >= limit ? "bg-amber-500" : "bg-[#A98B5C]"}`}
                    style={{ width: `${Math.min(100, Math.round((liveCount / limit) * 100))}%` }}
                  />
                </div>
                {liveCount >= limit ? (
                  <p className="text-[11px] text-amber-700 mt-1.5 font-bold">上限に到達。アップグレードでもっと出品。</p>
                ) : nearLimit ? (
                  <p className="text-[11px] text-amber-600 mt-1.5">上限が近づいています</p>
                ) : null}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {PAYWALL_ENABLED && !isPaid && plan !== "master" && !isAdminUser && (
                <Link href="/pricing"
                  className="inline-flex items-center h-10 px-4 rounded-xl bg-[#2D323B] text-white text-[13px] font-bold active:bg-[#1A1D23]">
                  プランを見る
                </Link>
              )}
              {PAYWALL_ENABLED && isPaid && plan !== "pro" && (
                <Link href="/pricing"
                  className="inline-flex items-center gap-1 h-10 px-4 rounded-xl bg-[#2D323B] text-white text-[13px] font-bold active:bg-[#1A1D23]">
                  アップグレード
                </Link>
              )}
              {PAYWALL_ENABLED && isPaid && (
                <Link href="/faq" className="self-center text-[12px] text-gray-400 underline">ご契約の管理・解約について</Link>
              )}
              {isAdminUser && (
                <Link href="/admin"
                  className="inline-flex items-center h-10 px-4 rounded-xl border border-[#2D323B]/30 text-[#2D323B] text-[13px] font-bold active:bg-[#2D323B]/5">
                  管理画面
                </Link>
              )}
            </div>
          </section>
        )}

        {/* 2段階認証（2FA・無料）＝管理画面の必須条件。全ユーザーに任意で提供 */}
        <section className="bg-white rounded-2xl p-4 border border-[#A98B5C]/25 shadow-sm">
          <MfaSetup />
        </section>

        {/* プッシュ通知（オン/オフ＋受け取る種類を本人が選べる） */}
        <section className="bg-white rounded-2xl p-4 border border-[#A98B5C]/25 shadow-sm">
          <PushSettings />
        </section>

        {/* eBay関連（連携・送料・発送先・返品・発送元・出品の既定値）は別ページに分離。ここからは入口だけ。 */}
        <Link href="/settings/ebay"
          className="block bg-white rounded-2xl p-4 border border-[#A98B5C]/25 shadow-sm active:bg-gray-50">
          <div className="flex items-center gap-2">
            <span className="inline-flex w-7 h-7 rounded-full bg-[#0064D2] items-center justify-center text-white font-black text-[11px] shrink-0">e</span>
            <h2 className="text-sm font-black text-gray-800 flex-1">eBayアカウント設定</h2>
            <span aria-hidden="true" className="text-gray-300 text-base shrink-0">›</span>
          </div>
          <p className="text-[11px] text-gray-500 leading-relaxed mt-1.5">
            <span className="whitespace-nowrap">連携・送料・発送先の国・</span><wbr />
            <span className="whitespace-nowrap">返品・発送元・出品の既定値。</span><wbr />
            <b className="text-gray-700 whitespace-nowrap">出品の準備や設定変更はこちら。</b>
          </p>
        </Link>

        <div className="pt-1 text-center flex items-center justify-center gap-3 flex-wrap">
          <Link href="/faq" className="text-xs text-gray-500 underline hover:text-[#2D323B]">よくある質問</Link>
          <Link href="/legal" className="text-xs text-gray-500 underline hover:text-[#2D323B]">特定商取引法</Link>
          <Link href="/privacy" className="text-xs text-gray-500 underline hover:text-[#2D323B]">プライバシー</Link>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
