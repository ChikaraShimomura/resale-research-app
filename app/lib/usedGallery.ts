// 仕入れ元(ハードオフ)の商品詳細ページから全画像(ギャラリー)を取得する。
// ハードオフは Akamai 無し＝Vercel(DC-IP)からも素の fetch で取れる（eBay/2nd STは住宅IP必須なので不可）。
// 一次ソースは詳細ページの JSON-LD schema.org Product の "image":[...]（本体商品の全画像が大きいサイズで並ぶ）。失敗時は空配列。
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// imageFlux(ハードオフ画像CDN)のサイズ指定を出品向けに大きく(1280・白背景余白)書き換える。検索サムネ(w=231)も原寸級へ。
export function upscaleImageflux(url: string): string {
  if (!url || !/imageflux\.jp/i.test(url)) return url;
  // URL構造は /c!/{サイズ等パラメータ}/{shopId}/{file}。パラメータ区間まるごとを1280指定に差し替える
  // （/c! の直後の "/" まで含めて置換しないと、旧パラメータが残って二重指定の壊れたURLになる）。
  return url.replace(/\/c!\/[^/]*\//, "/c!/w=1280,h=1280,a=0,u=1,q=85/");
}

// 仕入れ元(ハードオフ)の在庫状況。詳細ページの schema.org availability で判定。
// "in-stock"=在庫あり / "sold-out"=売切/掲載終了 / "unknown"=判定不能(2nd ST等はAkamaiでVercelから取得不可)。
export async function fetchSourceAvailability(productUrl: string): Promise<"in-stock" | "sold-out" | "unknown"> {
  if (!productUrl || !/netmall\.hardoff\.co\.jp\/product\//.test(productUrl)) return "unknown";
  try {
    const res = await fetch(productUrl, { headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8" }, signal: AbortSignal.timeout(7000) });
    if (!res.ok) return "unknown";
    const html = await res.text();
    const m = html.match(/"availability"\s*:\s*"([^"]+)"/);
    if (!m) return "unknown";
    if (/SoldOut|OutOfStock|Discontinued/i.test(m[1])) return "sold-out";
    if (/InStock|InStoreOnly|PreOrder|LimitedAvailability/i.test(m[1])) return "in-stock";
    return "unknown";
  } catch {
    return "unknown";
  }
}

// ハードオフ商品URL(.../product/{id}/)→ 詳細ページの全画像URL(最大12枚・1280px)。非ハードオフURLや失敗は []。
export async function fetchHardoffGallery(productUrl: string): Promise<string[]> {
  if (!productUrl || !/netmall\.hardoff\.co\.jp\/product\//.test(productUrl)) return [];
  try {
    const res = await fetch(productUrl, {
      headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    // JSON-LD の "image":[ ... ] を抜く（本体商品の全画像。関連商品は別ブロックなので混ざらない）。
    const m = html.match(/"image"\s*:\s*\[([^\]]*)\]/);
    if (!m) return [];
    const urls = (m[1].match(/https:\/\/[^"]+imageflux[^"]+\.(?:jpe?g|png|webp)/gi) || []).map(upscaleImageflux);
    return [...new Set(urls)].slice(0, 12);
  } catch {
    return [];
  }
}
