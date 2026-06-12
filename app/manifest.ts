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
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
