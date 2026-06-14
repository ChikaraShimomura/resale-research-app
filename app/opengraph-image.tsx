import { ImageResponse } from "next/og";

// サイト共通の OGP/Twitter カード画像（X・LINE・各SNSでリンク共有時に出る大きな画像）。
// これが無いと summary_large_image 指定でも画像が出ず、自動投稿の見栄え＝流入が落ちる。
// 商品ページは generateMetadata 側の og:image（楽天サムネ）で個別に上書きされる。

export const alt = "輸出ラボ｜楽天で仕入れてeBayで売る 利益商品リサーチ";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CRIMSON = "#BF0000";

// 日本語グリフは ImageResponse 既定フォントに無く豆腐(□)になるため、使う文字だけを
// Google Fonts から動的サブセット取得する。古いUAで truetype を返させ satori で使える形に。
// 取得失敗時は null を返し、ラテン文字のみ既定フォントで描画（ビルドは落とさない）。
async function loadJpFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const url = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@800&text=${encodeURIComponent(text)}`;
    const css = await (
      await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 5.1; rv:7.0.1)" },
      })
    ).text();
    const src = css.match(/src:\s*url\(([^)]+)\)/)?.[1];
    if (!src) return null;
    return await (await fetch(src)).arrayBuffer();
  } catch {
    return null;
  }
}

export default async function OpengraphImage() {
  const brand = "輸出ラボ";
  const lead = "楽天で仕入れて、eBayで売る。";
  const sub = "利益が出る商品を、毎日自動でリサーチ。";
  const badge = "無料・登録不要";
  const font = await loadJpFont(brand + lead + sub + badge + "楽天eBay");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "72px 80px",
          background: `linear-gradient(135deg, ${CRIMSON} 0%, #9E0000 100%)`,
          color: "#ffffff",
          fontFamily: font ? "Noto Sans JP" : "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 40,
            fontWeight: 800,
            letterSpacing: 2,
            color: "rgba(255,255,255,0.92)",
          }}
        >
          楽天 → eBay 輸出リサーチ
        </div>

        <div style={{ display: "flex", fontSize: 150, fontWeight: 800, lineHeight: 1.05, marginTop: 8 }}>
          {brand}
        </div>

        <div style={{ display: "flex", fontSize: 52, fontWeight: 800, marginTop: 18 }}>{lead}</div>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 800, marginTop: 10, color: "rgba(255,255,255,0.92)" }}>
          {sub}
        </div>

        <div style={{ display: "flex", alignItems: "center", marginTop: 40 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "#ffffff",
              color: CRIMSON,
              fontSize: 36,
              fontWeight: 800,
              padding: "12px 28px",
              borderRadius: 999,
            }}
          >
            {badge}
          </div>
          <div style={{ display: "flex", fontSize: 32, fontWeight: 800, marginLeft: 28, color: "rgba(255,255,255,0.85)" }}>
            yushutsu-fukugyo.com
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: font ? [{ name: "Noto Sans JP", data: font, weight: 800, style: "normal" }] : [],
    }
  );
}
