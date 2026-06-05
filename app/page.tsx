import Link from "next/link";
import { Search, TrendingUp, ShoppingBag, Globe } from "lucide-react";
import { GENRES } from "./lib/genres";

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-white">
      <nav className="border-b border-gray-100 px-4 py-4 max-w-6xl mx-auto flex items-center justify-between">
        <span className="font-bold text-xl text-indigo-600">輸出で副業しようよ</span>
        <Link href="/guide" className="text-xs text-gray-500 hover:text-indigo-600 transition-colors">はじめてガイド</Link>
      </nav>

      <section className="max-w-2xl mx-auto px-4 pt-16 pb-12 text-center">
        <span className="inline-block mb-4 text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">
          日本→海外 輸出副業
        </span>
        <h1 className="text-3xl font-bold text-gray-900 mb-4 leading-tight">
          日本にあるのに、<br />
          <span className="text-indigo-600">海外では高値がつく。</span><br />
          その商品、教えます。
        </h1>
        <p className="text-base text-gray-500 mb-8">
          日本で普通に買える商品が、eBayでは何倍もの値段で売れていることがあります。
          仕入れ先のリンクつきで紹介するので、気になった商品はすぐ動けます。
        </p>
        <Link href="/search" className="inline-block px-8 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors">
          今すぐ検索する
        </Link>
      </section>

      {/* ジャンルクイックアクセス */}
      <section className="max-w-2xl mx-auto px-4 pb-12">
        <h2 className="text-lg font-bold text-gray-900 mb-4 text-center">人気ジャンルから探す</h2>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {GENRES.slice(0, 10).map((genre) => (
            <Link
              key={genre.id}
              href={`/results?q=${encodeURIComponent(genre.label)}`}
              className={`flex flex-col items-center gap-1 px-2 py-3 rounded-xl border-2 text-center transition-all hover:shadow-sm ${genre.color}`}
            >
              <span className="text-2xl">{genre.emoji}</span>
              <span className="text-xs font-semibold">{genre.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* 仕組み説明 */}
      <section className="bg-gray-50 py-12">
        <div className="max-w-2xl mx-auto px-4">
          <h2 className="text-xl font-bold text-gray-900 text-center mb-8">こんな感じで使えます</h2>
          <div className="flex flex-col gap-4">
            {[
              { icon: Search, title: "1. ジャンルや商品名で探す", desc: "トレカ・ガンプラ・コスメなどジャンル別に、利益が出やすい商品を一覧表示" },
              { icon: TrendingUp, title: "2. eBayの落札実績を確認", desc: "海外（eBay）での過去の落札価格をもとに、実際に利益が出る商品だけをリストアップします" },
              { icon: ShoppingBag, title: "3. リンクから仕入れて、売るだけ", desc: "仕入れ先のリンクをそのまま掲載。気に入った商品が見つかったらすぐ動けます" },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="bg-white rounded-xl p-5 border border-gray-200 flex gap-4">
                <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center shrink-0">
                  <Icon size={18} className="text-indigo-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm mb-1">{title}</h3>
                  <p className="text-sm text-gray-500">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 利益例 */}
      <section className="max-w-2xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-gray-900 text-center mb-6">利益が出る商品の例</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { name: "ポケモンカードBOX", buy: "¥6,600", point: "10%", ebay: "+¥6,318" },
            { name: "資生堂アネッサ", buy: "¥2,200", point: "20%", ebay: "+¥3,272" },
            { name: "LEGOテクニック", buy: "¥32,000", point: "12%", ebay: "+¥20,540" },
            { name: "Switch有機EL", buy: "¥37,980", point: "8%", ebay: "+¥10,166" },
          ].map((item) => (
            <div key={item.name} className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="font-medium text-gray-900 text-sm mb-2">{item.name}</p>
              <p className="text-xs text-gray-500 mb-3">楽天 {item.buy}（ポイント{item.point}）</p>
              <div className="flex gap-2">
                <span className="flex items-center gap-1 text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded-full border border-blue-100">
                  <Globe size={10} />eBay {item.ebay}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="text-center mt-8">
          <Link href="/search" className="inline-block px-8 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors">
            もっと商品を探す
          </Link>
        </div>
      </section>

    </div>
  );
}
