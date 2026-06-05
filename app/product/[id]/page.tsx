import { mockProducts } from "../../lib/mock-data";
import { formatJpy, getProfitBadgeStyle, cn, toRakutenAffiliateUrl } from "../../lib/utils";
import { Globe, ShoppingBag, ArrowLeft, Package } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

const SITE_STYLES: Record<string, string> = {
  rakuten: "bg-red-50 text-red-600 border-red-100",
  surugaya: "bg-purple-50 text-purple-600 border-purple-100",
  bookoff: "bg-green-50 text-green-600 border-green-100",
};

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = mockProducts.find((p) => p.id === id);
  if (!product) notFound();

  const { source } = product;
  const siteStyle = SITE_STYLES[source.site] ?? "bg-gray-50 text-gray-600 border-gray-200";
  const sourceUrl = source.site === "rakuten" ? toRakutenAffiliateUrl(source.url) : source.url;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-100 px-4 py-4 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg text-indigo-600">輸出で副業しようよ</Link>
        <Link href="/guide" className="text-xs text-gray-500 hover:text-indigo-600 transition-colors">はじめてガイド</Link>
      </nav>

      <main className="max-w-xl mx-auto px-4 py-6">
        <Link href="/results?q=" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-5">
          <ArrowLeft size={14} /> 検索結果に戻る
        </Link>

        {/* 商品基本情報 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <div className="flex gap-4">
            <img src={product.imageUrl} alt={product.title} className="w-24 h-24 rounded-lg object-cover shrink-0" />
            <div>
              <span className="text-xs text-gray-400">{product.category}</span>
              <h1 className="font-bold text-gray-900 mt-1 mb-3 leading-snug">{product.title}</h1>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className={cn("px-2 py-0.5 rounded-full border font-medium", siteStyle)}>
                  {source.siteName} {formatJpy(source.price)}
                </span>
                {source.site === "rakuten" && source.pointRate && (
                  <span className="text-xs text-gray-400 self-center">※ポイント{source.pointRate}%</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* メルカリ・eBay比較 */}
        {product.profits.map((p) => {
          const icon = p.platform === "ebay"
            ? <Globe size={16} className="text-blue-500" />
            : <ShoppingBag size={16} className="text-red-400" />;

          return (
            <div key={p.platform} className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <div className="flex items-center gap-2">
                  {icon}
                  <h2 className="font-semibold text-gray-900">{p.platformName}で出品</h2>
                </div>
                <span className={cn("ml-auto text-sm font-bold px-3 py-0.5 rounded-full border shrink-0", getProfitBadgeStyle(p.profitRate))}>
                  {p.profit >= 0 ? "+" : ""}{formatJpy(p.profit)}（{p.profitRate}%）
                </span>
              </div>

              <p className="text-xs text-gray-400 flex items-center gap-1 mb-4">
                <Package size={12} /> 過去の売れた件数: {p.soldCount}件
              </p>

              <div className="text-xs text-gray-500 space-y-1 mb-4 bg-gray-50 rounded-lg p-3">
                <div className="flex justify-between"><span>平均売値</span><span>{formatJpy(p.avgPrice)}</span></div>
                <div className="flex justify-between text-red-400"><span>− 仕入れ価格</span><span>{formatJpy(source.price)}</span></div>
                <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-1 mt-1">
                  <span>推定利益</span>
                  <span className={p.profit >= 0 ? "text-green-600" : "text-red-500"}>
                    {p.profit >= 0 ? "+" : ""}{formatJpy(p.profit)}
                  </span>
                </div>
              </div>

              <a href={p.affiliateUrl} target="_blank" rel="noopener noreferrer"
                className="block text-center py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                {p.platformName}で相場を確認 ↗
              </a>
            </div>
          );
        })}

        {/* 仕入れボタン */}
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
          className="block text-center py-3.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors">
          {source.siteName}で仕入れる ↗
        </a>
      </main>
    </div>
  );
}
