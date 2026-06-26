import { MetadataRoute } from "next";

const SITE_URL = "https://www.yushutsu-fukugyo.com";

export const revalidate = 3600;

// sitemap は動的生成（app/sitemap.ts）に一本化。public/sitemap.xml を置くと静的ファイルが覆い隠すため置かない。
//
// ⚠️ 2026-06-27（リリース監査・ユーザー判断「完全会員制を維持」）：
//   middleware は login/register/reset/auth・法務(privacy/terms/legal/faq)・PWA資産・OG画像・sorry 以外を
//   すべて /register へ307する（会員以外は何も見えない）。sitemap に gated URL を載せるとクローラが /register
//   に飛ばされ noindex 同然＝無効。そこで sitemap は「未ログインでも200で見える＝インデックス可能な公開ページ」
//   だけに限定する（法務ページ）。集客面を公開に戻す場合はここに公開パスを足し、middleware の isPublicPath と揃える。
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  return [
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/legal`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/faq`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
  ];
}
