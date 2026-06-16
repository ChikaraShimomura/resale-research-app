import { ImageResponse } from "next/og";

// X自動投稿の「相場データカード」画像（保存される情報型）。商品の 楽天→eBay相場・想定利益率を
// 1080x1080 のカードPNGで返す。bot がこれをネイティブ直アップして投稿する（外部リンク回避＋ブックマーク狙い）。
// 生成に失敗した場合 bot 側は画像なしで投稿を続行する（best-effort）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRIMSON = "#BF0000";

// 日本語グリフは ImageResponse 既定フォントに無く豆腐(□)になるため、使う文字だけを動的サブセット取得。
async function loadJpFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const url = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700&text=${encodeURIComponent(text)}`;
    const css = await (
      await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 5.1; rv:7.0.1)" } })
    ).text();
    const src = css.match(/src:\s*url\(([^)]+)\)/)?.[1];
    if (!src) return null;
    return await (await fetch(src)).arrayBuffer();
  } catch {
    return null;
  }
}

// ロケールデータに依存しない3桁区切り。
function yen(v: string | null): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const title = (sp.get("t") || "今日の相場").slice(0, 24);
  const name = (sp.get("n") || "").slice(0, 56);
  const raku = sp.get("r");
  const ebay = sp.get("e");
  const rate = (sp.get("p") || "").slice(0, 5);

  const glyphs =
    title + name +
    "輸出ラボ楽天eBay想定利益率約円相場は現行の最安中央値ベースの目安です" +
    "yushutsufukugyocom" + (raku ?? "") + (ebay ?? "") + rate + "0123456789,%→¥〜";
  const font = await loadJpFont(glyphs);
  const ff = font ? "Noto Sans JP" : "sans-serif";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#ffffff", fontFamily: ff }}>
        <div style={{ display: "flex", alignItems: "center", background: CRIMSON, color: "#ffffff", padding: "38px 56px", fontSize: 56, fontWeight: 700 }}>
          {title}
        </div>

        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, padding: "52px 56px", justifyContent: "center" }}>
          <div style={{ display: "flex", fontSize: 38, color: "#444444", lineHeight: 1.3, marginBottom: 40 }}>{name}</div>

          <div style={{ display: "flex", alignItems: "center", fontSize: 62, fontWeight: 700, color: "#111111" }}>
            <span style={{ display: "flex", color: "#777777", fontSize: 38, marginRight: 16 }}>楽天</span>
            ¥{yen(raku)}
            <span style={{ display: "flex", color: CRIMSON, margin: "0 22px", fontSize: 70 }}>→</span>
            <span style={{ display: "flex", color: "#777777", fontSize: 38, marginRight: 16 }}>eBay</span>
            約¥{yen(ebay)}
          </div>

          <div style={{ display: "flex", alignItems: "center", marginTop: 48 }}>
            <span style={{ display: "flex", fontSize: 40, color: "#444444", marginRight: 24 }}>想定利益率</span>
            <span style={{ display: "flex", fontSize: 104, fontWeight: 700, color: CRIMSON }}>{rate || "—"}%</span>
          </div>

          <div style={{ display: "flex", fontSize: 26, color: "#999999", marginTop: 44 }}>
            ※ 相場は現行の最安〜中央値ベースの想定・目安です
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "30px 56px", borderTop: "2px solid #eeeeee", fontSize: 32, color: "#888888" }}>
          <span style={{ display: "flex", fontWeight: 700, color: CRIMSON }}>輸出ラボ</span>
          <span style={{ display: "flex" }}>yushutsu-fukugyo.com</span>
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1080,
      fonts: font ? [{ name: "Noto Sans JP", data: font, weight: 700 as const, style: "normal" as const }] : [],
    }
  );
}
