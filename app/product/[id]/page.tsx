import type { Metadata } from "next";
import Link from "next/link";
import { kvReadOnly } from "../../lib/kv";
import { ProfitProduct } from "../../lib/profitFilter";
import ProductCard from "../../components/ProductCard";
import BottomNav from "../../components/BottomNav";

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
    return (
      <div className="min-h-dvh bg-[#F5F7FA] pb-nav flex flex-col">
        <header className="bg-gradient-to-r from-[#BF0000] to-[#BF0000] px-3 py-3"
          style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}>
          <span className="text-white font-black text-base">輸出ラボ</span>
        </header>
        <main className="flex-1 flex flex-col items-center justify-center text-center p-6">
          <p className="text-5xl mb-4">🔍</p>
          <p className="text-gray-600 text-sm font-semibold mb-1">この商品は現在掲載されていません</p>
          <p className="text-gray-400 text-xs mb-5">入れ替わった可能性があります</p>
          <Link href="/search"
            className="inline-flex items-center min-h-[44px] text-sm font-bold text-white bg-[#BF0000] rounded-full px-6 active:bg-[#9E0000]">
            利益商品を見る →
          </Link>
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
