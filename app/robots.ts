import { MetadataRoute } from "next";

// クロール予算をコンテンツ（トップ/ガイド/検索結果/商品）に集中させ、
// 認証・設定・APIなどの非コンテンツ/個人領域はインデックスさせない。
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/login", "/register", "/settings", "/favorites", "/sorry"],
    },
    sitemap: "https://www.yushutsu-fukugyo.com/sitemap.xml",
    host: "https://www.yushutsu-fukugyo.com",
  };
}
