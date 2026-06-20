import { MetadataRoute } from "next";
import { ARTICLES } from "./guide/articles";

const SITE_URL = "https://www.yushutsu-fukugyo.com";

// 商品は6時間ごとに入れ替わるため、sitemap は1時間ごとに再生成（ISR）して新鮮に保つ。
export const revalidate = 3600;

// sitemap は動的生成（app/sitemap.ts）に一本化。public/sitemap.xml を置くと静的ファイルが
// この経路を覆い隠して古いURL一覧が配信されるため、置かないこと。
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // 固定ページ。コンテンツ資産（ガイド）は必ず載せて発見性を確保する。
  // 2026-06-21: /search・/results・/product/* はログイン必須化したため sitemap から除外（gated URL を載せると
  // クローラが /register に飛ばされ無効になる）。公開の集客面はトップ/ランキング/ガイド/料金/プレス/法務のみ。
  const staticEntries: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/ranking`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/guide`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/guide/payoneer-withdraw`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    // SEO大黒柱記事
    ...ARTICLES.map((a) => ({
      url: `${SITE_URL}/guide/${a.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    { url: `${SITE_URL}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/press`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
  ];

  // 商品ページ（/product/*）は 2026-06-21 にログイン必須化したため sitemap から除外。
  // gated URL はクローラが /register に飛ばされ noindex 同然になるため、載せない。
  // （以前は長尾SEOとして全商品を載せていたが、利益商品の非公開化に伴い撤回。公開フックは /ranking のみ。）
  return staticEntries;
}
