import { MetadataRoute } from "next";
import { kvReadOnly } from "./lib/kv";
import { ProfitProduct } from "./lib/profitFilter";

const SITE_URL = "https://www.yushutsu-fukugyo.com";

// 商品は6時間ごとに入れ替わるため、sitemap は1時間ごとに再生成（ISR）して新鮮に保つ。
export const revalidate = 3600;

// sitemap は動的生成（app/sitemap.ts）に一本化。public/sitemap.xml を置くと静的ファイルが
// この経路を覆い隠して古いURL一覧が配信されるため、置かないこと。
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // 固定ページ。コンテンツ資産（ガイド）は必ず載せて発見性を確保する。
  const staticEntries: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/search`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/results`, lastModified: now, changeFrequency: "hourly", priority: 0.8 },
    { url: `${SITE_URL}/guide`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/guide/ebay-seller`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/guide/payoneer-withdraw`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
  ];

  // 掲載中の商品ページ（長尾SEO：「商品名 eBay 相場」等での流入口）。
  // 失効商品は product ページ側で noindex 化されるため、現在の在庫だけを載せる。
  // 認証情報が無い環境（ローカル/creds未注入ビルド）では KV クライアントが長時間リトライして
  // ビルドの60秒制限を超えるため、creds が揃っているときだけ読む（本番Vercelには注入済み）。
  let productEntries: MetadataRoute.Sitemap = [];
  const hasKv =
    !!process.env.KV_REST_API_URL?.trim() &&
    !!(process.env.KV_REST_API_READ_ONLY_TOKEN?.trim() || process.env.KV_REST_API_TOKEN?.trim());
  if (hasKv) {
    try {
      const products = await kvReadOnly.get<ProfitProduct[]>("profitable_products");
      if (Array.isArray(products)) {
        productEntries = products.slice(0, 1000).map((p) => ({
          url: `${SITE_URL}/product/${encodeURIComponent(p.id)}`,
          lastModified: now,
          changeFrequency: "weekly" as const,
          priority: 0.6,
        }));
      }
    } catch {
      // KV 不通時は固定ページのみ返す（sitemap を 500 にしない）。
    }
  }

  return [...staticEntries, ...productEntries];
}
