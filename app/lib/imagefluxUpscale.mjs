// ハードオフ画像CDN(imageFlux)の小サムネURL(検索は w=231 等)を、出品/表示向けの原寸級(1280px・白背景余白)に書き換える。
// ★SSOT：app(usedGallery.ts が re-export し全出品/表示経路が使う)とビルド用スクリプト(scripts/used/*)の両方がこの1本を使う。
//   .mjs なので TS からも import 可（landedCostCore.mjs と同じ共有パターン）。変更はここ1箇所で全経路に効く。
// imageFlux は動的CDN＝URLの /c!/{パラメータ}/ 区間を差し替えると、その実寸をその場で返す＝本物の高解像度(拡大ボケでない)。
// imageFlux 以外(楽天 rakuten.co.jp / r10s.jp・media.hardoff 等)は素通り＝レガシー画像を壊さない。
export function upscaleImageflux(url) {
  if (!url || !/imageflux\.jp/i.test(url)) return url;
  // URL構造は /c!/{サイズ等パラメータ}/{shopId}/{file}。パラメータ区間まるごと(/c! 直後の "/" まで)を1280指定へ差し替える
  // （残すと旧パラメータと二重指定になり壊れたURLになる）。冪等：w=1280 のURLを再度通しても w=1280 のまま。
  return url.replace(/\/c!\/[^/]*\//, "/c!/w=1280,h=1280,a=0,u=1,q=85/");
}

// 表示専用のサムネ版：カタログの小さいカード(64px等)に1280px原寸を配ると無駄に重い（1枚~140KB×数百）。
// imageFluxは動的CDNなので、同じ /c!/ パラメータ差し替えで小サイズ版をその場生成させる＝転送量を大幅削減。
// ★出品/prepare で使う本物の原寸(upscaleImageflux)には一切触れない。ここは「表示のsrcだけ」を縮める用途。
// size は表示ボックスの2〜3倍(retina)を目安に呼び出し側で指定。upscaleImageflux 済みURLを通しても冪等に上書きされる。
export function imagefluxThumb(url, size = 192) {
  if (!url || !/imageflux\.jp/i.test(url)) return url;
  const s = Math.max(48, Math.min(512, Math.round(Number(size) || 192)));
  return url.replace(/\/c!\/[^/]*\//, `/c!/w=${s},h=${s},a=0,u=1,q=80/`);
}
