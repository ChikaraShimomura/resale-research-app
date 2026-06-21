import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { canViewCatalog } from "../../lib/auth/plan";
import { kvReadOnly } from "../../lib/kv";
import { ProfitProduct } from "../../lib/profitFilter";
import { applyDisplayProfit } from "../../lib/displayProfit";
import ProductCard from "../../components/ProductCard";
import BottomNav from "../../components/BottomNav";
import { Search, Flame } from "lucide-react";
import JsonLd from "../../components/JsonLd";
import ShippingHelper from "../../components/ShippingHelper";
import { shippingHelp } from "../../lib/shipping";

export const dynamic = "force-dynamic";

// 楽天サムネ(?_ex=128x128 等)を大きいサイズに置換して鮮明化。Xカードの og:image 用。
function hiResImage(url: string): string {
  if (!url) return url;
  return url.replace(/_ex=\d+x\d+/, "_ex=600x600");
}

async function getProduct(id: string): Promise<ProfitProduct | null> {
  try {
    const products = await kvReadOnly.get<ProfitProduct[]>("profitable_products");
    const found = products?.find((p) => p.id === id) ?? null;
    // 配信(/api/products)と同じ「現金純利益（ポイント抜き・着地コスト後）」に揃える＝一覧と詳細で利益が一致。
    return found ? applyDisplayProfit(found) : null;
  } catch {
    return null;
  }
}

// 掲載終了ページの導線用：今アツい（利益率が高い）商品を数件。
async function getHotProducts(excludeId: string, n = 3): Promise<ProfitProduct[]> {
  try {
    const products = await kvReadOnly.get<ProfitProduct[]>("profitable_products");
    if (!products) return [];
    return products
      .filter((p) => p.id !== excludeId)
      .map(applyDisplayProfit)
      .sort((a, b) => b.realProfitRate - a.realProfitRate)
      .slice(0, n);
  } catch {
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) {
    return { title: "商品が見つかりません", robots: { index: false } };
  }
  const title = product.title.slice(0, 60);
  const desc = `楽天¥${product.source.price.toLocaleString()} → eBay最安¥${product.realAvgPrice.toLocaleString()} ／ 利益率${product.realProfitRate}%。日本の商品を海外へ。`;
  const img = hiResImage(product.imageUrl);
  const images = img ? [img] : [];
  return {
    title,
    description: desc,
    alternates: { canonical: `/product/${encodeURIComponent(id)}` },
    openGraph: {
      title,
      description: desc,
      type: "website",
      images: images.map((url) => ({ url })),
    },
    // 画像クリックでサイトへ飛ぶ大きなカード（X / Twitter）
    twitter: {
      card: "summary_large_image",
      title,
      description: desc,
      images,
    },
  };
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // 未購読(free)・未ログインには利益商品を見せない＝/pricing へ誘導（PAYWALL OFF時は素通り）。
  if (!(await canViewCatalog())) redirect("/pricing");

  const { id } = await params;
  const sp = await searchParams;
  const autoListing = sp.list === "1"; // 設定完了→出品画面へ戻ってきたら自動で開く
  const product = await getProduct(id);

  if (!product) {
    const hot = await getHotProducts(id, 3);
    return (
      <div className="min-h-dvh bg-[#F5F7FA] pb-nav flex flex-col">
        <header className="bg-gradient-to-r from-[#2D323B] to-[#2D323B] px-3 py-3"
          style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}>
          <span className="text-white font-black text-base">輸出ラボ</span>
        </header>
        <main className="flex-1 max-w-2xl mx-auto w-full p-4">
          <div className="text-center py-8">
            <Search size={44} className="mx-auto mb-4 text-gray-300" />
            <p className="text-gray-700 text-sm font-bold mb-1">この商品は現在掲載されていません</p>
            <p className="text-gray-400 text-xs mb-5">入れ替わった可能性があります。今アツい商品をチェックしてみて！</p>
            <Link href="/search"
              className="inline-flex items-center min-h-[44px] text-sm font-bold text-white bg-[#2D323B] rounded-full px-6 active:bg-[#1A1D23]">
              利益商品を見る →
            </Link>
          </div>

          {hot.length > 0 && (
            <section className="mt-2">
              <div className="flex items-center gap-1.5 mb-3 text-[#2D323B] font-black text-sm">
                <Flame size={16} />今アツい利益商品
              </div>
              <div className="flex flex-col gap-3">
                {hot.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            </section>
          )}
        </main>
        <BottomNav />
      </div>
    );
  }

  const productLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    ...(product.imageUrl ? { image: [hiResImage(product.imageUrl)] } : {}),
    description: `楽天¥${product.source.price.toLocaleString()} → eBay最安¥${product.realAvgPrice.toLocaleString()} ／ 利益率${product.realProfitRate}%。日本の商品を海外へ。`,
    category: product.category,
    offers: {
      "@type": "Offer",
      price: product.source.price,
      priceCurrency: "JPY",
      availability: "https://schema.org/InStock",
      url: `https://www.yushutsu-fukugyo.com/product/${encodeURIComponent(id)}`,
    },
  };

  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <JsonLd data={productLd} />
      <header className="bg-gradient-to-r from-[#2D323B] to-[#2D323B] shadow-sm"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <Link href="/search" aria-label="検索に戻る"
            className="w-11 h-11 flex items-center justify-center rounded-full bg-white/20 text-white text-xl font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <span className="text-white font-black text-base tracking-tight">輸出ラボ</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-3">
        <ProductCard product={product} autoOpenListing={autoListing} />
        <ShippingHelper help={shippingHelp(product)} />

        {/* 初めて来た人向けの3ステップ。Xリンク等で単品ページに直接来ても流れが分かるように。 */}
        <section className="mt-3 bg-white border border-[#A98B5C]/25 rounded-2xl p-4 shadow-sm">
          <p className="text-[13px] font-black text-gray-800 mb-3">この商品で稼ぐ3ステップ</p>
          <div className="flex items-start justify-between gap-1">
            {[
              { n: "①", t: "楽天で仕入れる", s: "上のボタンから" },
              { n: "②", t: "eBayで出品", s: "写真だけでOK" },
              { n: "③", t: "発送する", s: "国際郵便で" },
            ].map((x, i) => (
              <div key={i} className="flex-1 flex flex-col items-center text-center">
                <div className="w-8 h-8 rounded-full bg-[#2D323B] text-white flex items-center justify-center text-sm font-black mb-1.5">{x.n}</div>
                <p className="text-[12px] font-bold text-gray-700 leading-tight">{x.t}</p>
                <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{x.s}</p>
              </div>
            ))}
          </div>
          <Link href="/guide" className="mt-3 block text-center text-[12px] font-bold text-[#2D323B] underline underline-offset-2">
            画像つきの始め方ガイドを見る →
          </Link>
        </section>

        <Link href="/search"
          className="mt-3 flex items-center justify-center min-h-[44px] text-sm font-bold text-[#2D323B] border border-[#2D323B] rounded-xl active:bg-red-50">
          他の利益商品を見る →
        </Link>
      </main>

      <BottomNav />
    </div>
  );
}
