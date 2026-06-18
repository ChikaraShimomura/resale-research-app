// 楽天の画像URLを「文字消去プロキシ(/api/clean-img)」経由のURLに変換する（表示用）。
// 楽天系以外・空はそのまま返す。プロキシ側がキー未設定/失敗時に元画像へフォールバックするので安全。
export function cleanImg(url?: string | null): string {
  if (!url) return url ?? "";
  if (!/(\.|\/\/)(rakuten\.co\.jp|r10s\.jp)/i.test(url)) return url;
  return `/api/clean-img?u=${encodeURIComponent(url)}`;
}
