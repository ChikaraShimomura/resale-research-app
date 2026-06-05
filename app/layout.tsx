import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

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

export const metadata: Metadata = {
  title: {
    default: "輸出で副業しようよ｜楽天商品をeBay・メルカリで利益を出す",
    template: "%s | 輸出で副業しようよ",
  },
  description: "楽天で仕入れてeBayやメルカリで売る！利益率が高い商品を自動でリストアップ。日本の商品を海外に輸出して副収入を得たい方向けの無料リサーチツール。",
  keywords: ["輸出副業", "せどり", "eBay輸出", "メルカリ転売", "楽天仕入れ", "副業", "在宅副業", "フィギュア転売"],
  metadataBase: new URL(SITE_URL),
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "輸出で副業しようよ",
    title: "輸出で副業しようよ｜楽天商品をeBay・メルカリで利益を出す",
    description: "楽天で仕入れてeBayやメルカリで売る！利益率が高い商品を自動でリストアップ。",
    locale: "ja_JP",
  },
  twitter: {
    card: "summary_large_image",
    title: "輸出で副業しようよ｜楽天商品をeBay・メルカリで利益を出す",
    description: "楽天で仕入れてeBayやメルカリで売る！利益率が高い商品を自動でリストアップ。",
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: SITE_URL,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="ga4" strategy="afterInteractive">{`
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', '${GA_ID}');
      `}</Script>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
