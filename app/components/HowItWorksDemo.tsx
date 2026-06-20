"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Play, Pause, RotateCcw, ArrowRight } from "lucide-react";

// ホームの「使い方」を文章ではなく“動画風”の自動再生デモで見せる。
// 実際のサイトと同じ画面（商品カード/仕入れ/eBay出品/発送・追跡/マイページ収支）を
// ミニ再現してスマホ枠の中で順送りする。動画ファイルではないのでホスティング不要・
// UI変更にも追従しやすく、スマホ最優先（PWA）。数値はデモ用の一貫した例。

const STEP_MS = 9000; // 1ステップの表示時間（5ステップ＝約45秒）
const TICK = 100;

// デモ用の一貫した数値（売上¥12,000・仕入れ¥5,000・手数料¥1,640・残り¥5,360・pt500・利益¥5,860）
function CardScreen() {
  return (
    <div className="p-3">
      <div className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-3">
        <div className="flex gap-2.5 mb-3">
          <div className="w-[64px] h-[64px] rounded-lg bg-gray-100 border-2 border-[#A98B5C] shrink-0 flex items-center justify-center">
            <span className="text-[8px] text-gray-400">商品画像</span>
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-[8px] font-bold border border-[#2D323B] text-[#2D323B] px-1.5 py-0.5 rounded-full">新品</span>
            <h3 className="text-[11px] text-gray-800 leading-snug mt-1 font-medium">日本限定フィギュア 特別版（海外で人気）</h3>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-[9px] text-gray-400">仕入れ(送料込)</span>
              <span className="text-[13px] font-black text-[#2D323B]">¥7,000</span>
            </div>
          </div>
        </div>
        <div className="bg-[#F8F9FB] rounded-xl p-2.5 border border-[#A98B5C]/25">
          <div className="flex items-baseline justify-between">
            <span className="text-[9px] text-gray-400">eBay最安値<span className="text-gray-300">（想定売値）</span></span>
            <span className="text-[13px] font-bold text-blue-600">¥12,000</span>
          </div>
          <div className="mt-2 pt-2 border-t border-[#A98B5C]/25 flex items-end justify-between">
            <div>
              <p className="text-[8px] text-gray-400 mb-0.5">利益（最安で売れた時）</p>
              <span className="inline-flex items-center text-[10px] font-black px-2 py-0.5 rounded-full text-white bg-orange-500 leading-none">利益率 48%</span>
            </div>
            <div className="text-right">
              <span className="block text-2xl font-black text-[#2D323B] leading-none">¥3,360</span>
              <span className="block text-[10px] font-bold text-[#FF4466] mt-0.5">（ + 700ポイント）</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BuyScreen() {
  return (
    <div className="p-3">
      <div className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-3">
        <p className="text-[10px] text-gray-500 mb-2">この商品を…</p>
        <div className="flex gap-2">
          <div className="flex-1 inline-flex items-center justify-center h-10 bg-gradient-to-r from-blue-600 to-blue-500 text-white text-[11px] font-bold rounded-xl">eBay自動出品</div>
          <div className="flex-1 inline-flex items-center justify-center gap-1 h-10 bg-[#BF0000] text-white text-[11px] font-bold rounded-xl ring-2 ring-yellow-400 ring-offset-1">
            <span className="inline-flex w-3 h-3 bg-white rounded-full items-center justify-center text-[#BF0000] font-black text-[7px] shrink-0">R</span>楽天で仕入れる
          </div>
        </div>
      </div>
      <div className="mt-3 bg-[#FFF7E6] border border-[#A98B5C]/30 rounded-xl p-2.5">
        <p className="text-[10px] font-bold text-[#2D323B]">楽天で買うとポイントが貯まる</p>
        <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">仕入れに使った分にもポイント還元（最大20%）。利益とは別に貯まる“おまけ”です。</p>
        <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-black text-[#FF4466]">＋700ポイント 還元</span>
      </div>
    </div>
  );
}

function ListScreen() {
  return (
    <div className="p-3">
      <div className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-3">
        <div className="inline-flex items-center justify-center h-9 w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white text-[11px] font-bold rounded-xl mb-3">eBay自動出品</div>
        <p className="text-[9px] text-gray-400 mb-1">自動で作られた出品内容</p>
        <div className="bg-[#F8F9FB] rounded-xl border border-[#A98B5C]/25 p-2.5 space-y-2">
          <p className="text-[10px] font-bold text-gray-800 leading-snug">Japan Exclusive Figure Special Edition - New</p>
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-gray-400">価格</span>
            <span className="text-[12px] font-black text-blue-600">$78.00</span>
          </div>
          <div className="flex gap-1 flex-wrap">
            <span className="text-[8px] bg-white border border-gray-200 rounded px-1.5 py-0.5 text-gray-500">写真 自動</span>
            <span className="text-[8px] bg-white border border-gray-200 rounded px-1.5 py-0.5 text-gray-500">英語タイトル 自動</span>
            <span className="text-[8px] bg-white border border-gray-200 rounded px-1.5 py-0.5 text-gray-500">説明文 自動</span>
          </div>
        </div>
        <p className="text-[9px] text-gray-400 mt-2 leading-relaxed">英語が分からなくてOK。タイトル・説明・写真はすべて自動。確認して出すだけ。</p>
      </div>
    </div>
  );
}

function ShipScreen() {
  return (
    <div className="p-3">
      <div className="border border-gray-200 rounded-xl p-3 bg-white space-y-2">
        <p className="text-[11px] font-bold text-gray-800">Japan Exclusive Figure Special...</p>
        <p className="text-[9px] text-gray-500">買い手: john_us ／ アメリカ</p>
        <p className="text-[9px] text-gray-400">やること：発送したら追跡番号を登録</p>
        <div className="flex items-center gap-1.5">
          <div className="flex-1 h-8 px-2 rounded-lg border border-gray-200 text-[10px] text-gray-400 flex items-center">追跡番号</div>
          <div className="h-8 px-1.5 rounded-lg border border-gray-200 text-[9px] text-gray-500 flex items-center bg-white">日本郵便</div>
          <div className="h-8 px-3 rounded-lg bg-[#2D323B] text-white text-[10px] font-bold flex items-center">登録</div>
        </div>
      </div>
      <p className="text-[9px] text-gray-400 mt-2 px-1 leading-relaxed">売れたら国内から国際郵便で発送。追跡番号を登録すると、eBay側にも自動で反映されます。</p>
    </div>
  );
}

function MoneyRow({ color, label, value, bold }: { color: string; label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-sm shrink-0 ${color}`} />
      <span className="text-[9px] text-gray-500 flex-1 min-w-0 truncate">{label}</span>
      <span className={`text-[10px] tabular-nums ${bold ? "font-black text-emerald-600" : "font-bold text-gray-700"}`}>{value}</span>
    </div>
  );
}

function ProfitScreen() {
  return (
    <div className="p-3">
      <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-3 shadow-sm text-center mb-2">
        <p className="text-[9px] text-gray-400">このサイトで稼いだ利益（累計・現金）</p>
        <p className="mt-0.5 text-2xl font-black text-[#2D323B]">¥3,360</p>
        <p className="text-[10px] font-bold text-[#FF4466]">（ + 700ポイント）</p>
        <p className="text-[9px] text-gray-500 mt-0.5">1件 売れました 🎉</p>
      </div>
      <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-3 shadow-sm">
        <p className="text-[11px] font-black text-gray-800 mb-2">お金の流れ</p>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] text-gray-500">売上合計</span>
          <span className="text-[11px] font-black text-[#0064D2]">¥12,000</span>
        </div>
        <div className="flex h-5 w-full rounded-md overflow-hidden bg-gray-100">
          <div style={{ width: "58%" }} className="bg-gray-400" />
          <div style={{ width: "14%" }} className="bg-[#F0A0A0]" />
          <div style={{ width: "28%" }} className="bg-emerald-500" />
        </div>
        <div className="mt-2 space-y-1">
          <MoneyRow color="bg-gray-400" label="仕入れ（楽天で払った額）" value="− ¥7,000" />
          <MoneyRow color="bg-[#F0A0A0]" label="eBay手数料" value="− ¥1,640" />
          <MoneyRow color="bg-emerald-500" label="利益（現金）" value="¥3,360" bold />
          <MoneyRow color="bg-[#FF4466]" label="楽天ポイント（おまけ・別枠）" value="＋ 700ポイント" />
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  { n: "①", title: "利益商品を見つける", caption: "「楽天で安く仕入れて海外で高く売れる」商品を自動で厳選。利益もポイントも計算済み。", Screen: CardScreen },
  { n: "②", title: "楽天でワンタップ仕入れ", caption: "そのまま楽天で購入。仕入れた分にもポイントが還元され、利益とは別に“おまけ”で貯まります。", Screen: BuyScreen },
  { n: "③", title: "eBayへ自動で出品", caption: "英語タイトル・説明文・写真はすべて自動。内容を確認して出すだけ。", Screen: ListScreen },
  { n: "④", title: "売れたら発送・追跡登録", caption: "国内から国際郵便で発送し、追跡番号を登録。eBayにも自動で反映されます。", Screen: ShipScreen },
  { n: "⑤", title: "利益とポイントが残る", caption: "仕入れ・売上・利益がマイページで一目。楽天ポイントはまるごとおまけ。", Screen: ProfitScreen },
];

export default function HowItWorksDemo() {
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [inView, setInView] = useState(true);
  const [shown, setShown] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  // 動きを抑える設定なら自動再生しない（最初のステップを表示し、手動で進めてもらう）。
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setPlaying(false);
    }
  }, []);

  // 画面外では再生を止める（無駄な再描画を避ける）。
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // ステップ切替時に軽くフェードイン。
  useEffect(() => {
    setShown(false);
    const t = setTimeout(() => setShown(true), 30);
    return () => clearTimeout(t);
  }, [step]);

  // 自動送り。
  useEffect(() => {
    if (!playing || !inView) return;
    const id = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + TICK;
        if (next >= STEP_MS) {
          setStep((s) => (s + 1) % STEPS.length);
          return 0;
        }
        return next;
      });
    }, TICK);
    return () => clearInterval(id);
  }, [playing, inView]);

  const goTo = (i: number) => { setStep(i); setElapsed(0); };
  const replay = () => { setStep(0); setElapsed(0); setPlaying(true); };

  const cur = STEPS[step];
  const Screen = cur.Screen;
  const progress = elapsed / STEP_MS;

  return (
    <div ref={rootRef} className="bg-white border-y border-[#A98B5C]/25 shadow-sm">
      <div className="max-w-2xl mx-auto px-4 py-7">
        {/* 見出し */}
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-1 h-5 bg-gradient-to-b from-[#2D323B] to-[#A98B5C] rounded-full" />
          <h2 className="text-sm font-black text-gray-800">使い方を、見て分かる</h2>
        </div>
        <p className="text-[12px] text-gray-500 mb-5 pl-3">見つける → 仕入れ → 出品 → 発送 → 利益。実際の画面で自動再生されます。</p>

        {/* スマホ枠のデモ画面 */}
        <div className="mx-auto w-full max-w-[300px]">
          <div className="rounded-[26px] border-[6px] border-[#2D323B] bg-[#F5F7FA] shadow-xl overflow-hidden">
            {/* アプリ風ヘッダー */}
            <div className="bg-[#2D323B] px-3 py-2 flex items-center gap-1.5">
              <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center shrink-0">
                <span className="text-[#2D323B] font-black text-[11px] leading-none">R</span>
              </div>
              <span className="text-white font-black text-[12px]">輸出ラボ</span>
              <span className="ml-auto text-[9px] text-white/60 font-bold">{cur.n} {cur.title}</span>
            </div>
            {/* スクリーン本体（固定高さ・順送り） */}
            <div className="relative h-[300px] overflow-hidden">
              <div className={`transition-opacity duration-500 ${shown ? "opacity-100" : "opacity-0"}`}>
                <Screen />
              </div>
            </div>
          </div>
        </div>

        {/* 進行バー（ステップごとのセグメント） */}
        <div className="max-w-[300px] mx-auto mt-4 flex items-center gap-1.5">
          {STEPS.map((_, i) => {
            const fill = i < step ? 100 : i > step ? 0 : progress * 100;
            return (
              <button
                key={i}
                onClick={() => goTo(i)}
                aria-label={`ステップ${i + 1}へ`}
                className="h-1.5 flex-1 bg-gray-200 rounded-full overflow-hidden"
              >
                <span className="block h-full bg-[#A98B5C] rounded-full" style={{ width: `${fill}%` }} />
              </button>
            );
          })}
        </div>

        {/* 操作 + キャプション */}
        <div className="max-w-[300px] mx-auto mt-3 flex items-start gap-3">
          <button
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "一時停止" : "再生"}
            className="w-8 h-8 shrink-0 rounded-full bg-[#2D323B] text-white flex items-center justify-center active:scale-95"
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            onClick={replay}
            aria-label="最初から"
            className="w-8 h-8 shrink-0 rounded-full bg-white border border-[#A98B5C]/35 text-[#2D323B] flex items-center justify-center active:scale-95"
          >
            <RotateCcw size={14} />
          </button>
          <p className="text-[11px] text-gray-500 leading-relaxed flex-1 min-w-0">
            <b className="text-gray-800">{cur.n} {cur.title}</b><br />
            {cur.caption}
          </p>
        </div>

        {/* CTA */}
        <div className="text-center mt-6">
          <Link
            href="/search"
            className="inline-flex items-center gap-1.5 bg-yellow-400 hover:bg-yellow-300 active:bg-yellow-500 text-gray-900 font-black px-7 py-3 rounded-xl text-sm transition-all shadow-lg"
          >
            登録して利益商品を見る <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}
