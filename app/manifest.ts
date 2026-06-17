import type { MetadataRoute } from "next";

// PWA マニフェスト。/manifest.webmanifest として配信され、Next が自動で <link rel="manifest"> を出力。
// 「ホーム画面に追加」でアプリのように起動できるようにする（Xアプリ内ブラウザ対策の受け皿）。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "輸出ラボ｜楽天×eBay 輸出リサーチ",
    short_name: "輸出ラボ",
    description: "楽天で仕入れてeBayで売る。利益が出る商品を自動でリサーチ。",
    start_url: "/search",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#BF0000",
    lang: "ja",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // maskable は全面塗り(角丸なし)版。OSが好きな形に切り抜いても欠けない。
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
