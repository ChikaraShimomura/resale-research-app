import type { Metadata } from "next";
import Link from "next/link";
import AuthButton from "../components/AuthButton";
import BottomNav from "../components/BottomNav";
import EbayListingSetup from "../components/EbayListingSetup";
import PushSettings from "../components/PushSettings";
import ListingDefaultsSettings from "../components/ListingDefaultsSettings";
import InstallButton from "../components/InstallButton";
import PortalButton from "../components/PortalButton";
import MfaSetup from "../components/MfaSetup";
import { getPlan } from "../lib/auth/plan";
import { getActorId } from "../lib/auth/actor";
import { listDealsForUser } from "../lib/ebay/stats";
import { PLANS, PAYWALL_ENABLED } from "../lib/plans";

export const metadata: Metadata = {
  title: "設定",
  robots: { index: false },
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await searchParams;
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
      <header className="bg-gradient-to-r from-[#2D323B] to-[#2D323B] shadow-sm"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <Link href="/search" aria-label="検索に戻る"
            className="w-11 h-11 flex items-center justify-center rounded-full bg-white/20 text-white text-xl font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <span className="text-white font-black text-base tracking-tight">設定</span>
          <div className="ml-auto"><AuthButton /></div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-3 space-y-3">
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
                  <p className="text-[11px] text-amber-700 mt-1.5 font-bold">上限に達しています。アップグレードでもっと出品できます。</p>
                ) : nearLimit ? (
                  <p className="text-[11px] text-amber-600 mt-1.5">上限が近づいています。</p>
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
              {PAYWALL_ENABLED && isPaid && <PortalButton />}
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

        {/* 出品の既定値（Best Offer・発送までの日数を毎回選ばなくて済むように） */}
        <section className="bg-white rounded-2xl p-4 border border-[#A98B5C]/25 shadow-sm">
          <ListingDefaultsSettings />
        </section>

        <section className="bg-white rounded-2xl p-4 border border-[#A98B5C]/25 shadow-sm">
          <h2 className="text-sm font-black text-gray-800 mb-1">eBayの設定（準備・いつでも更新）</h2>
          <p className="text-xs text-gray-500 leading-relaxed">
            連携・送料・発送先の国・返品・発送元などをここで設定します。<b className="text-gray-700">完了後も各STEPを開けば、いつでも内容を更新できます</b>（送料や発送先を変えたいときもここから）。eBayのパスワードは渡されません。
          </p>
          <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
            ※ 連携情報はこの端末（ブラウザ）に紐づけて暗号化保存されます。共有端末では使用後にSTEP1の「連携を解除」をしてください。
          </p>
        </section>

        <EbayListingSetup />

        <div className="pt-1 text-center">
          <Link href="/privacy" className="text-xs text-gray-500 underline hover:text-[#2D323B]">プライバシーポリシー</Link>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
