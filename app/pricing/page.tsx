import Link from "next/link";
import { Check } from "lucide-react";

const plans = [
  {
    name: "無料",
    price: "¥0",
    period: "",
    features: ["1日10件まで検索", "平均落札価格のみ表示", "基本的な利益計算"],
    cta: "無料で始める",
    href: "/search",
    highlight: false,
  },
  {
    name: "Basic",
    price: "¥980",
    period: "/月",
    features: ["1日100件まで検索", "最高・最低・平均価格すべて", "利益計算詳細内訳", "検索履歴（30日）"],
    cta: "Basicを始める",
    href: "#",
    highlight: true,
  },
  {
    name: "Pro",
    price: "¥2,980",
    period: "/月",
    features: ["無制限検索", "全詳細データ", "eBay 90日価格チャート", "為替・送料カスタマイズ", "優先サポート"],
    cta: "Proを始める",
    href: "#",
    highlight: false,
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-dvh bg-gray-50">
      <nav className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="font-bold text-xl text-indigo-600">輸出ラボ</Link>
        <Link href="/search" className="text-sm text-gray-600 hover:text-gray-900">検索する</Link>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">料金プラン</h1>
          <p className="text-gray-500">まずは無料で試して、必要になったらアップグレード</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`bg-white rounded-xl p-6 border ${plan.highlight ? "border-indigo-500 ring-2 ring-indigo-100" : "border-gray-200"}`}
            >
              {plan.highlight && (
                <span className="inline-block text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full mb-3">
                  人気
                </span>
              )}
              <h2 className="text-lg font-bold text-gray-900">{plan.name}</h2>
              <div className="flex items-baseline gap-0.5 my-3">
                <span className="text-3xl font-bold text-gray-900">{plan.price}</span>
                <span className="text-gray-500 text-sm">{plan.period}</span>
              </div>
              <ul className="space-y-2 mb-6">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <Check size={14} className="text-green-500 mt-0.5 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={plan.href}
                className={`block text-center py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  plan.highlight
                    ? "bg-indigo-600 text-white hover:bg-indigo-700"
                    : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-12 bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">単品購入もできます</h3>
          <p className="text-sm text-gray-500">
            特定の商品の詳細データだけ必要な場合、<strong>1商品¥150</strong>で購入できます。
            サブスクリプションなしで使いたい方に最適です。
          </p>
        </div>
      </main>
    </div>
  );
}
