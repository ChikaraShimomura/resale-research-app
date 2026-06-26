import { MetadataRoute } from "next";

// 2026-06-27（リリース監査・ユーザー判断「完全会員制を維持」）：
//   会員以外は何も見えない（middleware が公開パス以外を /register へ307）ため、クロール可能なのは
//   未ログインで200を返すページ（法務＋認証の入口）だけ。それ以外は Disallow: / で一括ブロックし、
//   公開ページだけ Allow で例外許可する＝gated URL の無駄なクロール/307インデックスを避ける。
//   集客面を公開に戻す場合は Allow を増やし、middleware の isPublicPath と sitemap.ts を揃える。
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/register", "/login", "/privacy", "/terms", "/legal", "/faq"],
      disallow: "/",
    },
    sitemap: "https://www.yushutsu-fukugyo.com/sitemap.xml",
    host: "https://www.yushutsu-fukugyo.com",
  };
}
