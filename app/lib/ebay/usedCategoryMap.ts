// 中古カタログのジャンル → eBay US リーフカテゴリID のフォールバック表。
// カテゴリ判定(getCategorySuggestion)はジャンルヒントで寄せても外すことがある
// （例：ドリームキャストが Video Games に誤分類され Item Specifics が「Game Name」「Platform: 3DO」に化ける）。
// 候補が categoryId を返せなかった時に、ジャンルから既知のリーフへ確実に着地させる安全網。
//
// ⚠️ ここのIDは eBay US の代表的なリーフ。eBayの分類変更で陳腐化し得るため、誤判定が出たら要検証。
// ⚠️ フォールバックは「ジャンル内のほぼ全品が同じリーフに収まる」ジャンルだけにする。
//   オーディオ(アンプ/レシーバ/スピーカーで別リーフ)・楽器(弦/管/鍵盤で別リーフ)・カメラ(デジタル/フィルム/レンズで別リーフ)は
//   サブタイプ違いで誤着地し得るので固定IDは置かない＝ジャンルヒント＋eBay候補に委ねる（フェイルオープン）。
const USED_CATEGORY_BY_GENRE: Record<string, string> = {
  // 腕時計 → Watches > Wristwatches（腕時計はほぼ全品ここで安全）
  腕時計: "31387",
  // ゲーム機 → Video Games & Consoles > Video Game Consoles（コンソールは全品ここ＝Video Games誤分類の根治）
  ゲーム機: "139971",
};

// ジャンル(cat)に対応する eBay US リーフカテゴリID を返す。未対応ジャンルは undefined（フェイルオープン）。
export function getUsedCategoryId(cat: string | undefined): string | undefined {
  if (!cat) return undefined;
  return USED_CATEGORY_BY_GENRE[cat];
}
