import type { Metadata } from "next";
import Link from "next/link";
import { kvReadOnly } from "../../lib/kv";
import { ProfitProduct } from "../../lib/profitFilter";
import ProductCard from "../../components/ProductCard";
import BottomNav from "../../components/BottomNav";
import { isSold } from "../../lib/sold";
import { Search, Flame } from "lucide-react";

export const dynamic = "force-dynamic";

// 楽天サムネ(?_ex=128x128 等)を大きいサイズに置換して鮮明化。Xカードの og:image 用。
function hiResImage(url: string): string {
  if (!url) return url;
  return url.replace(/_ex=\d+x\d+/, "_ex=600x600");
}

async function getProduct(id: string): Promise<ProfitProduct | null> {
  try {
    const products = await kvReadOnly.get<ProfitProduct[]>("profitable_products");
    return products?.find((p) => p.id === id) ?? null;
  } catch {
    return null;
  }
}

// 掲載終了ページの導線用：今アツい（利益率が高い／SOLD以外）商品を数件。
async function getHotProducts(excludeId: string, n = 3): Promise<ProfitProduct[]> {
  try {
    const products = await kvReadOnly.get<ProfitProduct[]>("profitable_products");
    if (!products) return [];
    return products
      .filter((p) => p.id !== excludeId && !isSold(p))
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
  const desc = `楽天¥${product.source.price.toLocaleString()} → eBay平均¥${product.realAvgPrice.toLocaleString()} ／ 利益率${product.realProfitRate}%。日本の商品を海外へ。`;
  const img = hiResImage(product.imageUrl);
  const images = img ? [img] : [];
  return {
    title,
    description: desc,
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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getProduct(id);

  if (!product) {
    const hot = await getHotProducts(id, 3);
    return (
      <div className="min-h-dvh bg-[#F5F7FA] pb-nav flex flex-col">
        <header className="bg-gradient-to-r from-[#BF0000] to-[#BF0000] px-3 py-3"
          style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}>
          <span className="text-white font-black text-base">輸出ラボ</span>
        </header>
        <main className="flex-1 max-w-2xl mx-auto w-full p-4">
          <div className="text-center py-8">
            <Search size={44} className="mx-auto mb-4 text-gray-300" />
            <p className="text-gray-700 text-sm font-bold mb-1">この商品は現在掲載されていません</p>
            <p className="text-gray-400 text-xs mb-5">入れ替わった可能性があります。今アツい商品をチェックしてみて！</p>
            <Link href="/search"
              className="inline-flex items-center min-h-[44px] text-sm font-bold text-white bg-[#BF0000] rounded-full px-6 active:bg-[#9E0000]">
              利益商品を見る →
            </Link>
          </div>

          {hot.length > 0 && (
            <section className="mt-2">
              <div className="flex items-center gap-1.5 mb-3 text-[#BF0000] font-black text-sm">
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

  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header className="bg-gradient-to-r from-[#BF0000] to-[#BF0000] shadow-sm"
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
        <ProductCard product={product} />
        <Link href="/search"
          className="mt-3 flex items-center justify-center min-h-[44px] text-sm font-bold text-[#BF0000] border border-[#BF0000] rounded-xl active:bg-red-50">
          他の利益商品を見る →
        </Link>
      </main>

      <BottomNav />
    </div>
  );
}
