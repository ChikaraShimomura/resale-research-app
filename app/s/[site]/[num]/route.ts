import { NextResponse } from "next/server";

// トレカバンク買取メールの検索ボタン用【短縮リダイレクト】: /s/{site}/{型番("/"→"_")}
// メールはGmailの102KB切り詰めがあるため、1行に4サイト分の長い検索URL(日本語クエリ入り)を直接埋め込めない
// (150行×4本で確実に超過)。→メールには短いこのURLだけを載せ、タップ時にここでトレカバンクの買取表から
// 商品を引き当てて検索クエリを組み立て、各サイトへ302する。クリックは手動タップのみ＝毎回fetchでも軽い。
// site: m=メルカリ / y=Yahoo!フリマ / r=ラクマ / s=スニダン。全サイト「販売中のみ＋価格の安い順」(実ブラウザでparam実測)。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TB_URL = "https://store.torecabank.com/kaitori_list";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const SITES: Record<string, (q: string) => string> = {
  m: (q) => `https://jp.mercari.com/search?keyword=${encodeURIComponent(q)}&status=on_sale&sort=price&order=asc`,
  y: (q) => `https://paypayfleamarket.yahoo.co.jp/search/${encodeURIComponent(q)}?open=1&sort=price&order=asc`,
  r: (q) => `https://fril.jp/s?query=${encodeURIComponent(q)}&transaction=selling&sort=sell_price&order=asc`,
  s: (q) => `https://snkrdunk.com/search?keywords=${encodeURIComponent(q)}&isSaleOnly=true&sort=price_low`,
};

// mailer(scripts/torecabankKaitoriMail.mjs)と同じ抽出ロジック。
const cleanKw = (name: string) => String(name || "").replace(/[()（）\[\]【】]/g, " ").replace(/\s+/g, " ").trim();
const cardName = (name: string) => String(name || "").replace(/^[(（][^)）]*[)）]/, "").split(/[\[［(（:：]/)[0].trim();

type TbProduct = { product_master_name: string; product_master_key2: string; product_type_name: string; category_id?: number | string };

function extractProducts(html: string): TbProduct[] {
  const i = html.indexOf("const allProducts = ");
  if (i < 0) return [];
  const start = html.indexOf("[", i);
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let p = start; p < html.length; p++) {
    const c = html[p];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { end = p; break; } }
  }
  if (end < 0) return [];
  try { return JSON.parse(html.slice(start, end + 1)); } catch { return []; }
}

export async function GET(req: Request, { params }: { params: Promise<{ site: string; num: string }> }) {
  const { site, num } = await params;
  const build = SITES[site];
  if (!build) return new NextResponse("not found", { status: 404 });
  // 型番はメール側で "/"→"_" に置換して埋め込まれる（"339/S-P"のようにハイフンを含む型番があるため"-"は使えない）。
  const key2 = decodeURIComponent(num).replace(/_/g, "/").slice(0, 40);
  let q = `${key2} PSA10`; // 引き当て失敗時のフォールバック（型番+グレードだけでも検索は成立する）
  try {
    const res = await fetch(TB_URL, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: AbortSignal.timeout(10000), cache: "no-store" });
    if (res.ok) {
      const cands = extractProducts(await res.text()).filter((p) => p.product_master_key2 === key2);
      // 同じ型番がポケモン/ヴァイス等の別カテゴリで重複し得る→メール既定のポケモン(category_id=1)を優先。
      const p = cands.find((c) => String(c.category_id) === "1") || cands[0];
      if (p) {
        const card = cardName(p.product_master_name);
        // スニダンは型番でヒットしにくいため商品名ベース（"(PSA10)名前[セット]"→"PSA10 名前 セット"）。他は カード名+型番+グレード。
        q = site === "s" ? cleanKw(p.product_master_name) : `${card ? card + " " : ""}${key2} ${p.product_type_name}`;
      }
    }
  } catch { /* フォールバックqのまま続行 */ }
  return NextResponse.redirect(build(q), 302);
}
