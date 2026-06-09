import Link from "next/link";
import { GENRES } from "./lib/genres";

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-white">

      {/* ヘッダー */}
      <header className="bg-[#BF0000] px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-white font-black text-lg tracking-tight">輸出で副業しようよ</span>
            <span className="text-[10px] font-bold bg-white/20 text-white px-1.5 py-0.5 rounded">Powered by 楽天</span>
          </div>
          <Link href="/guide" className="text-white/80 text-xs hover:text-white">はじめてガイド</Link>
        </div>
      </header>

      {/* ポイント強調バナー */}
      <div className="bg-gradient-to-r from-[#BF0000] to-[#E83820] text-white">
        <div className="max-w-2xl mx-auto px-4 py-6 text-center">
          <p className="text-xs font-bold bg-white/20 inline-block px-3 py-1 rounded-full mb-3">
            🎯 楽天ポイント × eBay転売
          </p>
          <h1 className="text-2xl font-black mb-2 leading-tight">
            楽天で買って<br />
            <span className="text-yellow-300">ポイントを稼ぎながら</span><br />
            eBayで売る
          </h1>
          <p className="text-white/80 text-sm mb-4">
            仕入れ価格＋ポイント還元で利益を最大化。<br />日本にしかない商品を海外で高く売る。
          </p>
          <Link href="/search"
            className="inline-block bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-black px-8 py-3 rounded-full text-sm transition-colors shadow-lg">
            利益商品を見る →
          </Link>
        </div>
      </div>

      {/* ポイント仕組み説明 */}
      <div className="bg-[#FFF5F5] border-b border-red-100">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3 overflow-x-auto pb-1">
            {[
              { step: "①", text: "楽天で仕入れ", sub: "ポイント最大20%還元", color: "bg-[#BF0000]" },
              { step: "→", text: "", sub: "", color: "" },
              { step: "②", text: "eBayで出品", sub: "海外需要で高値売却", color: "bg-blue-600" },
              { step: "→", text: "", sub: "", color: "" },
              { step: "③", text: "利益＋ポイント", sub: "二重取りで稼ぐ", color: "bg-emerald-600" },
            ].map((item, i) =>
              item.text ? (
                <div key={i} className="flex flex-col items-center shrink-0">
                  <div className={`w-8 h-8 ${item.color} text-white rounded-full flex items-center justify-center text-xs font-black`}>
                    {item.step}
                  </div>
                  <p className="text-[11px] font-bold text-gray-700 mt-1 text-center whitespace-nowrap">{item.text}</p>
                  <p className="text-[10px] text-gray-400 text-center whitespace-nowrap">{item.sub}</p>
                </div>
              ) : (
                <span key={i} className="text-gray-300 text-lg shrink-0">›</span>
              )
            )}
          </div>
        </div>
      </div>

      {/* ジャンルクイックアクセス */}
      <section className="max-w-2xl mx-auto px-4 py-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-5 bg-[#BF0000] rounded-full" />
          <h2 className="text-sm font-black text-gray-800">カテゴリから探す</h2>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
          {GENRES.slice(0, 8).map((genre) => (
            <Link
              key={genre.id}
              href={`/results?q=${encodeURIComponent(genre.label)}`}
              className="flex flex-col items-center gap-1 px-1 py-3 rounded-xl bg-gray-50 border border-gray-100 text-center hover:border-red-200 hover:bg-red-50 transition-all active:scale-95"
            >
              <span className="text-2xl">{genre.emoji}</span>
              <span className="text-[10px] font-bold text-gray-600">{genre.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* 利益例カード */}
      <section className="max-w-2xl mx-auto px-4 pb-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-5 bg-[#BF0000] rounded-full" />
          <h2 className="text-sm font-black text-gray-800">こんな利益が出ています</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { name: "ポケモンカードBOX", buy: "¥6,600", point: "660pt（10%）", sell: "¥13,500", profit: "+¥4,092", rate: "62%" },
            { name: "LEGOテクニック", buy: "¥32,000", point: "3,840pt（12%）", sell: "¥56,000", profit: "+¥17,340", rate: "54%" },
            { name: "シャネル香水 50ml", buy: "¥18,000", point: "1,800pt（10%）", sell: "¥28,000", profit: "+¥6,145", rate: "34%" },
            { name: "ガンプラ MG 1/100", buy: "¥4,950", point: "495pt（10%）", sell: "¥9,500", profit: "+¥2,838", rate: "57%" },
          ].map((item) => (
            <div key={item.name} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
              <p className="font-bold text-gray-800 text-sm mb-2">{item.name}</p>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-400">楽天仕入れ</span>
                <span className="font-semibold text-gray-700">{item.buy}</span>
              </div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-400">楽天ポイント</span>
                <span className="font-bold text-orange-500">+{item.point}</span>
              </div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-gray-400">eBay落札</span>
                <span className="font-semibold text-blue-600">{item.sell}</span>
              </div>
              <div className="flex items-center justify-between bg-emerald-50 rounded-lg px-2.5 py-1.5">
                <span className="text-xs font-bold text-emerald-700">利益（手数料後）</span>
                <div className="text-right">
                  <span className="text-sm font-black text-emerald-600">{item.profit}</span>
                  <span className="text-xs text-emerald-500 ml-1">+{item.rate}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="text-center mt-5">
          <Link href="/search"
            className="inline-block bg-[#BF0000] hover:bg-[#A00000] text-white font-black px-8 py-3 rounded-full text-sm transition-colors shadow-md">
            すべての利益商品を見る →
          </Link>
        </div>
      </section>

      {/* フッター */}
      <footer className="bg-gray-50 border-t border-gray-200 px-4 py-6 text-center">
        <p className="text-xs text-gray-400">
          ※ 利益はeBay平均落札価格・楽天ポイント・eBay手数料(13.25%)・国際送料(¥2,500)をもとに計算しています。<br />
          実際の利益は状態・競合・為替等により異なります。
        </p>
      </footer>
    </div>
  );
}
