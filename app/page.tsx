import Link from "next/link";
import { Target } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA]">

      {/* ヘッダー */}
      <header className="bg-gradient-to-r from-[#BF0000] to-[#BF0000] px-3 py-2.5 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-sm">
              <span className="text-[#BF0000] font-black text-sm leading-none">R</span>
            </div>
            <span className="text-white font-black text-base tracking-tight">輸出ラボ</span>
          </div>
          <Link href="/guide"
            className="inline-flex items-center min-h-[44px] text-white/90 text-sm border border-white/40 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-sm active:bg-white/20">
            ガイド
          </Link>
        </div>
      </header>

      {/* ヒーロー */}
      <div className="bg-gradient-to-br from-[#BF0000] via-[#BF0000] to-[#9E0000] text-white">
        <div className="max-w-2xl mx-auto px-4 py-8 text-center">
          <p className="text-xs font-bold bg-white/20 inline-flex items-center gap-1.5 px-3 py-1 rounded-full mb-3 backdrop-blur-sm">
            <Target size={13} /> 楽天ポイント × eBay転売
          </p>
          <h1 className="text-2xl font-black mb-2 leading-tight">
            楽天で買って<br />
            <span className="text-yellow-300">ポイントを稼ぎながら</span><br />
            eBayで売る
          </h1>
          <p className="text-white/80 text-sm mb-6">
            仕入れ価格＋ポイント還元で利益を最大化。<br />日本にしかない商品を海外で高く売る。
          </p>
          <Link href="/search"
            className="inline-block bg-yellow-400 hover:bg-yellow-300 active:bg-yellow-500 text-gray-900 font-black px-8 py-3 rounded-full text-sm transition-all shadow-lg">
            利益商品を見る →
          </Link>
        </div>
      </div>

      {/* 仕組み説明 */}
      <div className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-center gap-3">
            {[
              { step: "①", text: "楽天で仕入れ", sub: "ポイント最大20%還元", color: "bg-gradient-to-br from-[#BF0000] to-[#BF0000]" },
              { arrow: true },
              { step: "②", text: "eBayで出品", sub: "海外需要で高値売却", color: "bg-gradient-to-br from-blue-600 to-blue-500" },
              { arrow: true },
              { step: "③", text: "利益＋ポイント", sub: "二重取りで稼ぐ", color: "bg-gradient-to-br from-emerald-600 to-emerald-500" },
            ].map((item, i) =>
              "arrow" in item ? (
                <span key={i} aria-hidden="true" className="text-gray-300 text-xl shrink-0">›</span>
              ) : (
                <div key={i} className="flex flex-col items-center shrink-0">
                  <div aria-hidden="true" className={`w-9 h-9 ${item.color} text-white rounded-full flex items-center justify-center text-sm font-black shadow-sm`}>
                    {item.step}
                  </div>
                  <p className="text-xs font-bold text-gray-700 mt-1 text-center whitespace-nowrap">{item.text}</p>
                  <p className="text-[11px] text-gray-500 text-center whitespace-nowrap">{item.sub}</p>
                </div>
              )
            )}
          </div>
        </div>
      </div>


      {/* 利益計算の説明 */}
      <section className="max-w-2xl mx-auto px-4 pb-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-5 bg-gradient-to-b from-[#BF0000] to-[#FF4466] rounded-full" />
          <h2 className="text-sm font-black text-gray-800">利益の計算方法</h2>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          <div className="flex justify-end mb-1.5">
            <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">例</span>
          </div>
          <div className="bg-[#F5F7FA] rounded-xl p-3 text-xs text-gray-600 space-y-1.5 font-mono mb-3">
            <div className="flex justify-between"><span>eBay平均落札価格</span><span className="text-blue-600">+ ¥XX,XXX</span></div>
            <div className="flex justify-between"><span>楽天仕入れ価格</span><span className="text-[#BF0000]">- ¥XX,XXX</span></div>
            <div className="flex justify-between"><span>楽天ポイント還元</span><span className="text-[#FF4466]">+ XXXpt</span></div>
            <div className="flex justify-between"><span>eBay手数料（13.25%+¥47）</span><span className="text-[#BF0000]">- ¥XXX</span></div>
            <div className="flex justify-between"><span>国際送料</span><span className="text-emerald-600 font-bold">購入者負担</span></div>
            <div className="flex justify-between font-black text-emerald-600 pt-1.5 border-t border-gray-200 text-sm">
              <span>利益</span><span>= ¥X,XXX + XXXpt</span>
            </div>
          </div>
          <p className="text-[11px] text-gray-500 text-center">全商品の利益計算にはこの計算式を使用しています</p>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-2xl mx-auto px-4 pb-8 text-center">
        <Link href="/search"
          className="inline-block bg-gradient-to-r from-[#BF0000] to-[#BF0000] hover:from-[#9E0000] hover:to-[#BF0000] text-white font-black px-8 py-3 text-sm transition-all shadow-md rounded-full">
          すべての利益商品を見る →
        </Link>
        <p className="mt-3 text-sm text-gray-500">現在 195件以上の利益商品を掲載中 · 2時間ごと更新</p>
      </section>

      {/* フッター */}
      <footer className="bg-white border-t border-gray-100 px-4 py-6 text-center">
        <p className="text-xs text-gray-500">
          ※ 利益はeBay平均落札価格・楽天ポイント・eBay手数料(13.25%)をもとに計算しています（国際送料は購入者負担のため利益に含めません）。<br />
          実際の利益は状態・競合・為替等により異なります。
        </p>
      </footer>
    </div>
  );
}
