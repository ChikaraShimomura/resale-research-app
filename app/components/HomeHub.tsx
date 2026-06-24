"use client";
// ログイン時のホーム＝パーソナルハブ。集客LPの代わりに「自分の状況」と「続きの一手」を出す。
// 件数は既存APIをクライアントでfetch（サーバーで重い往復を増やさない）。失敗時は控えめに0/未取得で描画。
//  - /api/ebay/deals  : 出品中(live)件数＋プラン情報(planInfo)
//  - /api/ebay/status : eBay連携済みか(connected)
//  - /api/ebay/orders : 注文一覧→「発送待ち」件数を算出（未発送・未キャンセル・欠品未対応）
import Link from "next/link";
import { useEffect, useState } from "react";
import { Tag, Package, Truck, ArrowRight, Plug, Sparkles, TrendingUp } from "lucide-react";

type Deal = { productId?: string };
type PlanInfo = {
  plan?: string;
  planName?: string;
  limit?: number | null;
  liveCount?: number;
};
type Order = {
  trackingNumber?: string;
  fulfillmentStatus?: string;
  cancelled?: boolean;
  shortageHandledAt?: string;
};

// 発送待ち＝未発送(追跡番号なし＆FULFILLEDでない)・未キャンセル・欠品未対応の注文。
function isAwaitingShipment(o: Order): boolean {
  if (o.cancelled || o.shortageHandledAt) return false;
  if (o.trackingNumber || o.fulfillmentStatus === "FULFILLED") return false;
  return true;
}

export default function HomeHub() {
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [shipCount, setShipCount] = useState<number | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
  const [soldCount, setSoldCount] = useState(0); // 売却記録(deals.sold)。出品済みだが未売却=育成が必要、の判定に使う
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      // 3本を並列取得。どれが失敗しても他はそのまま使う（ハブは壊さない）。
      const [dealsR, statusR, ordersR] = await Promise.allSettled([
        fetch("/api/ebay/deals", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/ebay/status", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/ebay/orders", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (!alive) return;
      if (dealsR.status === "fulfilled" && dealsR.value?.ok) {
        const live: Deal[] = Array.isArray(dealsR.value.live) ? dealsR.value.live : [];
        setLiveCount(live.length);
        setSoldCount(Array.isArray(dealsR.value.sold) ? dealsR.value.sold.length : 0);
        if (dealsR.value.planInfo) setPlanInfo(dealsR.value.planInfo as PlanInfo);
      } else {
        setLiveCount(0);
      }
      if (statusR.status === "fulfilled") setConnected(Boolean(statusR.value?.connected));
      if (ordersR.status === "fulfilled") {
        const orders: Order[] = Array.isArray(ordersR.value?.orders) ? ordersR.value.orders : [];
        setShipCount(orders.filter(isAwaitingShipment).length);
      } else {
        setShipCount(0);
      }
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 未購読(free)＝出品上限0。閲覧はできても出品はできない＝まず /pricing。
  const isFree = planInfo?.plan === "free";
  const live = liveCount ?? 0;

  // 「続きの一手」＝今いちばん進めるべき1アクションを1つだけ提示。
  //  free            → プランを見る（出品にはプランが必要）
  //  未連携           → eBayを連携（出品の前提）
  //  出品ゼロ         → 利益商品を探す
  //  発送待ちあり     → 発送する
  //  それ以外         → 利益商品を探す（次の仕入れ）
  let next: { href: string; label: string; sub: string; Icon: typeof ArrowRight; tone: "gold" | "ebay" } = {
    href: "/search",
    label: "利益商品を探す",
    sub: "次に出品する商品を見つけましょう",
    Icon: Tag,
    tone: "gold",
  };
  if (isFree) {
    next = { href: "/pricing", label: "プランを見て出品をはじめる", sub: "出品にはプランが必要です（30日無料）", Icon: Sparkles, tone: "gold" };
  } else if (connected === false) {
    next = { href: "/settings/ebay", label: "eBayを連携する", sub: "出品の前に、まず連携を済ませましょう", Icon: Plug, tone: "ebay" };
  } else if (live === 0) {
    next = { href: "/search", label: "利益商品を探す", sub: "最初の1品を出品してみましょう", Icon: Tag, tone: "gold" };
  } else if ((shipCount ?? 0) > 0) {
    next = { href: "/ship", label: "発送する", sub: `${shipCount}件の発送待ちがあります`, Icon: Truck, tone: "ebay" };
  } else if (soldCount === 0) {
    // 出品済みだがまだ1件も売れていない＝新規アカウントの壁。育成(評価づくり)へ促す。
    next = { href: "/grow", label: "アカウントを育てる", sub: "最初の評価を安全に積んで“売れる土台”を作りましょう", Icon: TrendingUp, tone: "gold" };
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-5 pb-8 space-y-5">
      {/* 状況サマリー：出品中・発送待ち */}
      <section aria-label="現在の状況">
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/listings"
            className="bg-white border border-[#A98B5C]/25 rounded-2xl p-4 shadow-sm active:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-1.5 text-gray-500 mb-1.5">
              <Package size={15} strokeWidth={1.9} className="text-[#2D323B]" />
              <span className="text-[11px] font-bold">出品中</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black text-[#2D323B] tabular-nums" aria-hidden={!loaded}>
                {loaded ? live : "—"}
              </span>
              <span className="text-[12px] text-gray-400 font-bold">件</span>
            </div>
            {planInfo?.limit != null && (
              <p className="text-[10px] text-gray-400 mt-0.5 tabular-nums">上限 {planInfo.limit}件</p>
            )}
          </Link>

          <Link
            href="/ship"
            className="bg-white border border-[#A98B5C]/25 rounded-2xl p-4 shadow-sm active:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-1.5 text-gray-500 mb-1.5">
              <Truck size={15} strokeWidth={1.9} className="text-[#2D323B]" />
              <span className="text-[11px] font-bold">発送待ち</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black text-[#2D323B] tabular-nums" aria-hidden={!loaded}>
                {loaded ? (shipCount ?? 0) : "—"}
              </span>
              <span className="text-[12px] text-gray-400 font-bold">件</span>
            </div>
            {loaded && (shipCount ?? 0) > 0 && (
              <p className="text-[10px] text-[#BF0000] mt-0.5 font-bold">発送をお願いします</p>
            )}
          </Link>
        </div>
      </section>

      {/* 続きの一手（いちばん進めるべき1アクション） */}
      <section aria-label="続きの一手">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-5 bg-gradient-to-b from-[#2D323B] to-[#A98B5C] rounded-full" />
          <h2 className="text-sm font-black text-gray-800">続きの一手</h2>
        </div>
        <Link
          href={next.href}
          className={`flex items-center gap-3 rounded-2xl p-4 shadow-md active:scale-[0.99] transition-transform ${
            next.tone === "ebay" ? "bg-[#0064D2]" : "bg-[#2D323B]"
          } text-white`}
        >
          <span
            className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center ${
              next.tone === "ebay" ? "bg-white/15" : "bg-[#A98B5C]/25"
            }`}
          >
            <next.Icon size={20} strokeWidth={1.9} className="text-white" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-black leading-tight">{next.label}</span>
            <span className="block text-[12px] text-white/75 leading-snug mt-0.5">{next.sub}</span>
          </span>
          <ArrowRight size={18} className="shrink-0 text-white/80" aria-hidden="true" />
        </Link>
      </section>

      {/* 主要タブへの移動は下部ナビ(BottomNav)が担う＝重複するショートカット枠は置かない。
          ホーム=「これから(状況＋続きの一手)」／マイページ=「これまで(成績・お金・設定)」で役割分離。 */}

      {/* 補助導線：アカウント育成／ランキング／ガイド（下部ナビに無い学習/集客/育成の入口） */}
      <section className="text-center pt-1 space-y-3">
        <Link href="/grow" className="inline-flex items-center justify-center gap-1.5 text-[13px] font-bold text-[#2D323B] underline underline-offset-2">
          📈 アカウントを育てる（売れる土台づくり）→
        </Link>
        <div>
          <Link href="/ranking" className="text-[13px] font-bold text-[#2D323B] underline underline-offset-2">
            🔥 いま稼げる利益商品ランキングを見る →
          </Link>
        </div>
        <div>
          <Link href="/guide" className="text-[12px] font-bold text-gray-500 underline underline-offset-2">
            使い方ガイドを見る →
          </Link>
        </div>
      </section>
    </div>
  );
}
