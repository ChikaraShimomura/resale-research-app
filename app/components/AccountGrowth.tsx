"use client";
// eBayアカウント育成ページの本体。新規アカウントは「出した＝売れる」ではなく、評価・実績を積んで
// 出品制限の解放／検索可視性／買い手の信用 を育てる必要がある（前提の一次情報は会話ログ参照）。
// Phase1：eBayのフィードバック/出品制限はAPIで綺麗に取れないため、自分の記録(stats.soldCount)を
//   育成ステージの近似に使い、①現在地＋次の一手 ②ローリスクのスターター品 ③育成のコツ を出す。
import Link from "next/link";
import { useEffect, useState } from "react";
import { Plug, Search, Star, Truck, Store, Coins, ShieldCheck, RefreshCw } from "lucide-react";
import ProductCard from "./ProductCard";
import { fetchProducts } from "../lib/products";
import { ProfitProduct } from "../lib/profitFilter";

export default function AccountGrowth() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [soldCount, setSoldCount] = useState(0);
  const [feedbackScore, setFeedbackScore] = useState<number | null>(null); // eBayの本物の評価数(取れた時だけ)
  const [positivePct, setPositivePct] = useState<number | null>(null);
  const [products, setProducts] = useState<ProfitProduct[]>([]);
  const [masked, setMasked] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [statusR, statsR, fbR, prodR] = await Promise.allSettled([
        fetch("/api/ebay/status", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/ebay/stats", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/ebay/feedback", { cache: "no-store" }).then((r) => r.json()), // 承認不要(Trading GetUser)。失敗時はnull
        fetchProducts(),
      ]);
      if (!alive) return;
      if (statusR.status === "fulfilled") setConnected(Boolean(statusR.value?.connected));
      if (statsR.status === "fulfilled" && statsR.value?.ok) setSoldCount(statsR.value.stats?.soldCount ?? 0);
      if (fbR.status === "fulfilled" && fbR.value?.ok) {
        setFeedbackScore(typeof fbR.value.score === "number" ? fbR.value.score : null);
        setPositivePct(typeof fbR.value.positivePct === "number" ? fbR.value.positivePct : null);
      }
      if (prodR.status === "fulfilled") {
        setProducts(Array.isArray(prodR.value.products) ? prodR.value.products : []);
        setMasked(!!prodR.value.masked);
      }
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 評価の根拠：eBayの本物の評価数が取れればそれを、取れなければ自分の販売記録(soldCount)を近似に使う。
  const evidence = feedbackScore != null ? feedbackScore : soldCount;
  const metricLabel = feedbackScore != null ? "eBay評価" : "販売記録";
  // 育成ステージ。0=未連携 / 1=評価0 / 2=1〜9 / 3=10以上(卒業)。
  const stage = connected === false ? 0 : evidence === 0 ? 1 : evidence < 10 ? 2 : 3;
  const stageInfo = [
    { label: "まず連携", desc: "出品の前に、eBayと連携を済ませましょう。", cta: { href: "/settings/ebay", text: "eBayを連携する", Icon: Plug, ebay: true } },
    { label: "最初の評価をとる", desc: "安い・低リスクの商品から出品し、最初の数件の評価を積みましょう。これが出品制限の解放と信用の土台です。", cta: { href: "/search", text: "スターター品を出品する", Icon: Search, ebay: false } },
    { label: "評価を伸ばす", desc: `${metricLabel} ${evidence} 件。この調子で評価を貯め、30日ごとに増枠リクエストを。販売率50〜70％・好評価を保てば枠が自動で増えます。`, cta: { href: "/search", text: "次の商品を出品する", Icon: Search, ebay: false } },
    { label: "卒業：伸ばす段階へ", desc: `${metricLabel} ${evidence} 件。土台はできました。高単価や、ストア名・ニッチでのブランディングで“複利”を効かせる段階です。`, cta: { href: "/search", text: "高単価にも挑戦する", Icon: Store, ebay: false } },
  ][stage];

  // スターター品＝利益が出る中で「いちばん安い＝1件あたりの失敗リスクが小さい」順。在庫切れ/赤字は配信側で除外済み。
  // 価格昇順で上位を取る＝閾値で0件にならない（カタログが空でなければ必ず出る）。
  const starters = [...products]
    .filter((p) => (p.realAvgPrice || 0) > 0) // free(masked)は価格0なので自動的に除外→下のプランCTAへ
    .sort((a, b) => (a.realAvgPrice || 0) - (b.realAvgPrice || 0))
    .slice(0, 12);

  const tips = [
    { Icon: Coins, t: "安い品で評価を早く貯める", d: "買い手は新規セラーでも“安い物”は買いやすい。安い・軽い品で最初の評価を一気に積むのが最短。" },
    { Icon: Truck, t: "即発送・在庫確実だけ", d: "⚠️ 売れてから楽天が売切→キャンセルは、育ち始めの新規アカに致命的（増枠が止まる）。最初は確実に送れる品だけ。" },
    { Icon: RefreshCw, t: "30日ごとに増枠リクエスト", d: "販売率50〜70％・好評価95〜100％・追跡付き定時発送を保てば、eBayが月次で出品枠を自動で増やします。" },
    { Icon: ShieldCheck, t: "不良率ゼロを守る", d: "追跡付き発送＋30日返品（既定）で、キャンセル・遅延・未着クレームを出さない。指標が命。" },
    { Icon: Store, t: "ブランディングは“後”で", d: "評価が貯まってからストア名・ニッチ・Aboutで複利を効かせる。土台（評価・実績）が先、看板は後。" },
  ];

  return (
    <div className="space-y-4">
      {/* 現在地＋次の一手 */}
      <section className="bg-gradient-to-br from-[#2D323B] to-[#1A1D23] rounded-2xl p-5 text-white shadow-sm">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Star size={14} className="text-[#D8C089]" />
          <span className="text-[11px] font-bold text-white/70">アカウント育成 ステージ {Math.min(stage + 1, 4)} / 4</span>
        </div>
        <p className="text-lg font-black leading-tight">{loaded ? stageInfo.label : "読み込み中…"}</p>
        {feedbackScore != null && (
          <p className="text-[11px] text-white/60 mt-1"><span className="whitespace-nowrap">eBay評価 {feedbackScore}件</span>{positivePct != null ? <>・<span className="whitespace-nowrap">好評価 {positivePct}%</span></> : ""}</p>
        )}
        <p className="text-[12px] text-white/80 leading-relaxed mt-1.5">{stageInfo.desc}</p>
        {/* ステージバー */}
        <div className="mt-3 flex gap-1">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= stage ? "bg-[#A98B5C]" : "bg-white/15"}`} />
          ))}
        </div>
        <Link
          href={stageInfo.cta.href}
          className={`mt-4 inline-flex items-center justify-center gap-1.5 h-11 px-5 rounded-xl text-[13px] font-black ${
            stageInfo.cta.ebay ? "bg-[#0064D2] text-white active:bg-[#0053AE]" : "bg-white text-[#2D323B] active:opacity-90"
          }`}
        >
          <stageInfo.cta.Icon size={16} /> {stageInfo.cta.text}
        </Link>
      </section>

      {/* 育成モードの商品（ローリスクのスターター品） */}
      <section>
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-1 h-5 bg-gradient-to-b from-[#2D323B] to-[#A98B5C] rounded-full" />
          <h2 className="text-sm font-black text-gray-800">育成モード：まず出すならコレ</h2>
        </div>
        <p className="text-[11px] text-gray-500 leading-relaxed mb-3">
          利益が出る中でも<b className="text-gray-700">価格が低い＝1件あたりの失敗リスクが小さい</b>順。最初の評価づくりに向いた品です（在庫切れは自動で除外）。
        </p>
        {masked ? (
          <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-5 text-center shadow-sm">
            <p className="text-[13px] font-black text-gray-800 mb-1">育成モードの商品はプランで表示</p>
            <p className="text-[11px] text-gray-500 leading-relaxed mb-3">スターター品（安い・低リスク）を選んで出品できます。ライトは30日無料。</p>
            <Link href="/pricing?from=grow" className="inline-flex items-center justify-center h-10 px-5 rounded-xl bg-[#2D323B] text-white text-[12px] font-black active:bg-[#1A1D23]">
              🔒 プランで全部見る
            </Link>
          </div>
        ) : !loaded ? (
          <div className="rounded-2xl border border-[#A98B5C]/20 bg-white px-4 py-8 text-center text-gray-400 text-[12px]">読み込み中…</div>
        ) : starters.length === 0 ? (
          <p className="text-[12px] text-gray-400 py-2">いま在庫のあるスターター品が見つかりませんでした。時間をおいて再度お試しください。</p>
        ) : (
          <div className="space-y-3">
            {starters.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>

      {/* 育成のコツ */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-5 bg-gradient-to-b from-[#2D323B] to-[#A98B5C] rounded-full" />
          <h2 className="text-sm font-black text-gray-800">アカウントを育てる5つのコツ</h2>
        </div>
        <ul className="space-y-2.5">
          {tips.map(({ Icon, t, d }, i) => (
            <li key={i} className="flex items-start gap-3 bg-white border border-[#A98B5C]/25 rounded-2xl p-3.5 shadow-sm">
              <span className="shrink-0 w-9 h-9 rounded-full bg-[#A98B5C]/10 ring-1 ring-[#A98B5C]/30 flex items-center justify-center">
                <Icon size={17} strokeWidth={1.8} className="text-[#2D323B]" />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-black text-gray-800">{t}</p>
                <p className="text-[12px] text-gray-500 leading-relaxed mt-0.5">{d}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 text-center">
          <Link href="/guide" className="text-[12px] font-bold text-gray-500 underline underline-offset-2">
            出品・発送の使い方ガイドも見る →
          </Link>
        </div>
      </section>
    </div>
  );
}
