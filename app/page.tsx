import Link from "next/link";
import { GENRES } from "./lib/genres";

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-white">

      {/* ヘッダー */}
      <header className="bg-[#BF0000] px-3 py-2.5">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
              <span className="text-[#BF0000] font-black text-sm leading-none">R</span>
            </div>
            <span className="text-white font-black text-base tracking-tight">輸出ラボ</span>
          </div>
          <Link href="/guide" className="text-white/80 text-xs border border-white/30 px-2 py-0.5 rounded">ガイド</Link>
        </div>
      </header>

      {/* ヒーロー */}
      <div className="bg-gradient-to-b from-[#BF0000] to-[#D42020] text-white">
        <div className="max-w-2xl mx-auto px-4 py-8 text-center">
          <p className="text-xs font-bold bg-white/20 inline-block px-3 py-1 rounded-full mb-3">
            🎯 楽天ポイント × eBay転売
          </p>
          <h1 className="text-2xl font-black mb-2 leading-tight">
            楽天で買って<br />
            <span className="text-yellow-300">ポイントを稼ぎながら</span><br />
            eBayで売る
          </h1>
          <p className="text-white/80 text-sm mb-5">
            仕入れ価格＋ポイント還元で利益を最大化。<br />日本にしかない商品を海外で高く売る。
          </p>
          <Link href="/search"
            className="inline-block bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-black px-8 py-3 rounded-full text-sm transition-colors shadow-lg">
            利益商品を見る →
          </Link>
        </div>
      </div>

      {/* 仕組み説明 */}
      <div className="bg-[#FFF5F5] border-b border-red-100">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-center gap-3">
            {[
              { step: "①", text: "楽天で仕入れ", sub: "ポイント最大20%還元", color: "bg-[#BF0000]" },
              { arrow: true },
              { step: "②", text: "eBayで出品", sub: "海外需要で高値売却", color: "bg-blue-600" },
              { arrow: true },
              { step: "③", text: "利益＋ポイント", sub: "二重取りで稼ぐ", color: "bg-emerald-600" },
            ].map((item, i) =>
              "arrow" in item ? (
                <span key={i} className="text-gray-300 text-xl shrink-0">›</span>
              ) : (
                <div key={i} className="flex flex-col items-center shrink-0">
                  <div className={`w-9 h-9 ${item.color} text-white rounded-full flex items-center justify-center text-sm font-black`}>
                    {item.step}
                  </div>
                  <p className="text-[11px] font-bold text-gray-700 mt-1 text-center whitespace-nowrap">{item.text}</p>
                  <p className="text-[10px] text-gray-400 text-center whitespace-nowrap">{item.sub}</p>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* カテゴリ */}
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

      {/* 利益計算の説明 */}
      <section className="max-w-2xl mx-auto px-4 pb-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-5 bg-[#BF0000] rounded-full" />
          <h2 className="text-sm font-black text-gray-800">利益の計算方法</h2>
        </div>
        <div className="bg-white border border-gray-200 rounded p-4">
          <div className="bg-gray-50 rounded p-3 text-xs text-gray-600 space-y-1.5 font-mono mb-3">
            <div className="flex justify-between"><span>eBay平均落札価格</span><span className="text-blue-600">+ ¥XX,XXX</span></div>
            <div className="flex justify-between"><span>楽天仕入れ価格</span><span className="text-[#BF0000]">- ¥XX,XXX</span></div>
            <div className="flex justify-between"><span>楽天ポイント還元</span><span className="text-[#FF6600]">+ XXXpt</span></div>
            <div className="flex justify-between"><span>eBay手数料（13.25%+¥47）</span><span className="text-[#BF0000]">- ¥XXX</span></div>
            <div className="flex justify-between"><span>国際送料（目安）</span><span className="text-[#BF0000]">- ¥2,500</span></div>
            <div className="flex justify-between font-black text-emerald-600 pt-1.5 border-t border-gray-200 text-sm">
              <span>利益</span><span>= ¥X,XXX + XXXpt</span>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 text-center">全商品の利益計算にはこの計算式を使用しています</p>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-2xl mx-auto px-4 pb-8 text-center">
        <Link href="/search"
          className="inline-block bg-[#BF0000] hover:bg-[#A00000] text-white font-black px-8 py-3 text-sm transition-colors shadow-md">
          すべての利益商品を見る →
        </Link>
        <p className="mt-3 text-xs text-gray-400">現在 195件以上の利益商品を掲載中 · 2時間ごと更新</p>
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
