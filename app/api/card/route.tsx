import { ImageResponse } from "next/og";

// 相場データカード画像。商品の 仕入れ→eBay相場・想定利益率を PNG で返す。
// 既定=1080x1080(X自動投稿用・ネイティブ直アップ)。?v=1 で 1080x1920 の縦型(Shorts/TikTok/Reels の動画素材)。
// 生成失敗時、呼び出し側は画像なしで続行する想定(best-effort)。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRIMSON = "#2D323B";

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
  const vertical = sp.get("v") === "1";
  const title = (sp.get("t") || (vertical ? "今日の利益商品" : "今日の相場")).slice(0, 24);
  const name = (sp.get("n") || "").slice(0, 56);
  const raku = sp.get("r");
  const ebay = sp.get("e");
  const rate = (sp.get("p") || "").slice(0, 5);
  // mode=used＝中古モデル用カード(仕入れ値・仕入れ元名は出さない／想定売値=eBay落札中央値・状態ランク・想定純利益率のみ)。
  // 既定(modeなし)・縦型(v=1)は従来の仕入れ→eBay表示のまま＝studioの動画素材を壊さない。
  const mode = sp.get("mode");
  const cond = (sp.get("c") || "").slice(0, 24);

  const glyphs =
    title + name + cond +
    "輸出ラボ仕入れeBay想定利益率約円相場は現行の最安中央値ベースの目安です" +
    "今日の利益商品日本でこれが海外だと無料で登録して他の商品もプロフィールのリンクから見れますやってみた" +
    "状態純売落札海外で想定中古※：" +
    "yushutsufukugyocom" + (raku ?? "") + (ebay ?? "") + rate + "0123456789,%→¥〜";
  const font = await loadJpFont(glyphs);
  const ff = font ? "Noto Sans JP" : "sans-serif";
  const fonts = font ? [{ name: "Noto Sans JP", data: font, weight: 700 as const, style: "normal" as const }] : [];

  if (vertical) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#ffffff", fontFamily: ff }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: CRIMSON, color: "#ffffff", padding: "56px", fontSize: 66, fontWeight: 700 }}>
            {title}
          </div>

          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, padding: "80px 72px", justifyContent: "center" }}>
            {name ? (
              <div style={{ display: "flex", fontSize: 44, color: "#444444", lineHeight: 1.35, marginBottom: 64 }}>{name}</div>
            ) : null}

            <div style={{ display: "flex", alignItems: "center", fontSize: 52, color: "#777777", marginBottom: 8 }}>日本で</div>
            <div style={{ display: "flex", alignItems: "baseline", fontSize: 96, fontWeight: 700, color: "#111111", marginBottom: 56 }}>
              ¥{yen(raku)}
            </div>

            <div style={{ display: "flex", alignItems: "center", fontSize: 52, color: CRIMSON, marginBottom: 8 }}>海外だと</div>
            <div style={{ display: "flex", alignItems: "baseline", fontSize: 132, fontWeight: 700, color: "#111111", marginBottom: 64 }}>
              約¥{yen(ebay)}
            </div>

            <div style={{ display: "flex", alignItems: "center", background: "#FFF0F4", borderRadius: 32, padding: "40px 48px" }}>
              <span style={{ display: "flex", fontSize: 52, color: "#444444", marginRight: 28 }}>想定利益率</span>
              <span style={{ display: "flex", fontSize: 150, fontWeight: 700, color: CRIMSON }}>{rate || "—"}%</span>
            </div>

            <div style={{ display: "flex", fontSize: 30, color: "#999999", marginTop: 56 }}>
              ※ 相場は現行の最安〜中央値ベースの想定・目安です
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", background: CRIMSON, color: "#ffffff", padding: "56px 72px" }}>
            <div style={{ display: "flex", fontSize: 48, fontWeight: 700, marginBottom: 12 }}>登録して他の利益商品も見れます</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 40 }}>
              <span style={{ display: "flex", fontWeight: 700 }}>輸出ラボ</span>
              <span style={{ display: "flex", opacity: 0.9 }}>yushutsu-fukugyo.com</span>
            </div>
          </div>
        </div>
      ),
      { width: 1080, height: 1920, fonts }
    );
  }

  // 中古モデル用カード（横1080x1080・X自動投稿）。仕入れ値/仕入れ元名は出さず、想定売値(eBay落札中央値)・状態・想定純利益率のみ。
  if (mode === "used") {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#ffffff", fontFamily: ff }}>
          <div style={{ display: "flex", alignItems: "center", background: CRIMSON, color: "#ffffff", padding: "38px 56px", fontSize: 56, fontWeight: 700 }}>
            {title}
          </div>

          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, padding: "52px 56px", justifyContent: "center" }}>
            <div style={{ display: "flex", fontSize: 38, color: "#444444", lineHeight: 1.3, marginBottom: cond ? 16 : 40 }}>{name}</div>
            {cond ? (
              <div style={{ display: "flex", alignItems: "center", fontSize: 34, color: "#777777", marginBottom: 40 }}>状態：{cond}</div>
            ) : null}

            <div style={{ display: "flex", alignItems: "center", fontSize: 46, color: "#777777", marginBottom: 6 }}>海外(eBay)で想定</div>
            <div style={{ display: "flex", alignItems: "baseline", fontSize: 104, fontWeight: 700, color: "#111111", marginBottom: 44 }}>
              約¥{yen(ebay)}
            </div>

            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ display: "flex", fontSize: 40, color: "#444444", marginRight: 24 }}>想定純利益率</span>
              <span style={{ display: "flex", fontSize: 104, fontWeight: 700, color: CRIMSON }}>{rate || "—"}%</span>
            </div>

            <div style={{ display: "flex", fontSize: 26, color: "#999999", marginTop: 40 }}>
              ※ 想定売値はeBayの落札中央値ベースの目安です
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "30px 56px", borderTop: "2px solid #eeeeee", fontSize: 32, color: "#888888" }}>
            <span style={{ display: "flex", fontWeight: 700, color: CRIMSON }}>輸出ラボ</span>
            <span style={{ display: "flex" }}>yushutsu-fukugyo.com</span>
          </div>
        </div>
      ),
      { width: 1080, height: 1080, fonts }
    );
  }

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#ffffff", fontFamily: ff }}>
        <div style={{ display: "flex", alignItems: "center", background: CRIMSON, color: "#ffffff", padding: "38px 56px", fontSize: 56, fontWeight: 700 }}>
          {title}
        </div>

        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, padding: "52px 56px", justifyContent: "center" }}>
          <div style={{ display: "flex", fontSize: 38, color: "#444444", lineHeight: 1.3, marginBottom: 40 }}>{name}</div>

          <div style={{ display: "flex", alignItems: "center", fontSize: 62, fontWeight: 700, color: "#111111" }}>
            <span style={{ display: "flex", color: "#777777", fontSize: 38, marginRight: 16 }}>仕入れ</span>
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
    { width: 1080, height: 1080, fonts }
  );
}
