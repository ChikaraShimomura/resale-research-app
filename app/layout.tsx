import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { headers } from "next/headers";
import "./globals.css";
import AddToHome from "./components/AddToHome";
import ConsentBanner from "./components/ConsentBanner";
import JsonLd from "./components/JsonLd";

const GA_ID = "G-MT7YQZ7ZMJ";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://www.yushutsu-fukugyo.com";

// サイト共通の構造化データ（運営者 + サイト + サイト内検索）
const SITE_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "輸出ラボ",
      url: SITE_URL,
      logo: `${SITE_URL}/icon.svg`,
      description: "楽天で仕入れてeBayで売る、輸出転売の利益商品リサーチツール。",
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "輸出ラボ",
      inLanguage: "ja",
      publisher: { "@id": `${SITE_URL}/#organization` },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${SITE_URL}/results?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // ピンチズームは有効のまま（WCAG 1.4.4）。入力フォームのフォーカスズームは
  // globals.css の input{font-size:16px} で防いでいるため maximumScale 制限は不要。
  viewportFit: "cover",    // iPhone ノッチ・ホームバーにコンテンツを広げる
  themeColor: "#BF0000",   // Safariのアドレスバー色 / Android PWAヘッダー色
};

export const metadata: Metadata = {
  title: {
    default: "輸出ラボ｜楽天商品をeBayで高く売る",
    template: "%s | 輸出ラボ",
  },
  description: "楽天で仕入れてeBayで売る！利益率が高い商品を自動でリストアップ。日本の商品を海外に輸出して副収入を得たい方向けの無料リサーチツール。",
  keywords: ["輸出副業", "せどり", "eBay輸出", "楽天仕入れ", "副業", "在宅副業", "フィギュア転売", "海外輸出"],
  metadataBase: new URL(SITE_URL),
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "輸出ラボ",
    title: "輸出ラボ｜楽天商品をeBayで高く売る",
    description: "楽天で仕入れてeBayで売る！利益率が高い商品を自動でリストアップ。",
    locale: "ja_JP",
  },
  twitter: {
    card: "summary_large_image",
    title: "輸出ラボ｜楽天商品をeBayで高く売る",
    description: "楽天で仕入れてeBayで売る！利益率が高い商品を自動でリストアップ。",
  },
  verification: {
    google: "GGgOF1LGPqzP6qIa95QjVH1iaMw0HuFZUMZALrg5Lck",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  appleWebApp: {
    capable: true,
    title: "輸出ラボ",
    statusBarStyle: "default",
  },
  robots: {
    index: true,
    follow: true,
  },
  // canonical はページごとに自己参照で設定する（ここで固定するとレイアウトを継承する全ページが
  // トップURLを canonical 申告してしまい、ガイド等がインデックスから外れる）。
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" nonce={nonce} />
      <Script id="ga4" strategy="afterInteractive" nonce={nonce}>{`
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
        gtag('js', new Date());
        gtag('config', '${GA_ID}');
      `}</Script>
      <body className="min-h-full flex flex-col">
        <JsonLd data={SITE_LD} />
        {children}
        <AddToHome />
        <ConsentBanner />
      </body>
    </html>
  );
}
