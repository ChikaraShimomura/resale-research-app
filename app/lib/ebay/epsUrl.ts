// eBay EPS画像URL(i.ebayimg.com/.../s-l{サイズ}.jpg)のサイズ変種を付け替える純関数。クライアント/サーバー両用(依存なし)。
// EPSは1枚のマスター画像から s-l{N} で各サイズをオンデマンド配信する。既定で小さい変種(s-l500等)が
// 保存/返却されても、s-l1600 にすればフル解像度(マスターのアップ時解像度まで)で鮮明に配信される。非EPSはそのまま。
export function epsSizedUrl(url: string, size: number): string {
  if (!url || !url.includes("i.ebayimg.com")) return url;
  return url.replace(/\/s-l\d+(\.[a-zA-Z0-9]+)/i, `/s-l${size}$1`);
}

// 出品・編集表示はフル解像度(s-l1600)で統一する。
export function epsLargeUrl(url: string): string {
  return epsSizedUrl(url, 1600);
}

// 突合用の基準キー：EPS画像はサイズ変種(s-l{N})だけ違っても同一画像なので、サイズ部分を伏せて比較する。
// 表示側(s-l1600)と実体(s-l500等)の変種差でも一致するようにする。非EPSはそのまま。
export function epsMatchKey(url: string): string {
  if (!url || !url.includes("i.ebayimg.com")) return url;
  return url.replace(/\/s-l\d+(\.[a-zA-Z0-9]+)/i, "/s-lKEY$1");
}
