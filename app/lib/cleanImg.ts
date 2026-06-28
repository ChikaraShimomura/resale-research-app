// レガシー(rakuten.co.jp/r10s.jp)の画像URLを「文字消去プロキシ(/api/clean-img)」経由のURLに変換する（表示用）。
// 対象ホスト以外・空はそのまま返す。プロキシ側がキー未設定/失敗時に元画像へフォールバックするので安全。
// CLEAN_IMG_VER: clean-img は immutable で1年キャッシュするため、文字消去ロジックを変えたら必ず +1 する。
// URLが変わってキャッシュミス→新ロジックで再処理される（過去の“消しすぎ”画像を更新するため）。
// v2 = 縁(外周)の文字だけ消す方式に変更（中央の商品の刻印を保護）。
// v3 = 縁帯を14%→7%に狭めた（IMAGE_TEXT_EDGE_FRAC=0.07）。G-SHOCK等の枠いっぱい商品のブランド/表示文字を保護。
const CLEAN_IMG_VER = 3;
export function cleanImg(url?: string | null): string {
  if (!url) return url ?? "";
  if (!/(\.|\/\/)(rakuten\.co\.jp|r10s\.jp)/i.test(url)) return url;
  return `/api/clean-img?u=${encodeURIComponent(url)}&v=${CLEAN_IMG_VER}`;
}
