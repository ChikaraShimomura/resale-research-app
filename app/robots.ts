import { MetadataRoute } from "next";

// クロール予算を公開コンテンツ（トップ/ランキング/ガイド/料金/プレス）に集中させ、
// 認証・設定・API・個人領域はインデックスさせない。
// 2026-06-21: 利益商品（/search・/results・/product/*）はログイン必須化したのでクロール対象外に追加。
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/login", "/register", "/settings", "/sorry", "/mypage", "/studio", "/admin", "/search", "/results", "/product/"],
    },
    sitemap: "https://www.yushutsu-fukugyo.com/sitemap.xml",
    host: "https://www.yushutsu-fukugyo.com",
  };
}
