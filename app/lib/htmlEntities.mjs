// HTMLエンティティを実文字へ復号する汎用ユーティリティ（&#34;→" / &amp;→& など）。
// eBayのHTML属性(alt="...")から抜いたタイトルは &#34; 等が生のまま残るため、表示・出品前にここで正規化する。
// .ts(prepare API)からも .mjs(ワーカー/refresh)からも使えるよう素のJS(.mjs)で置く。

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeHtmlEntities(s) {
  if (typeof s !== "string" || s.indexOf("&") === -1) return s ?? "";
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, ent) => {
    // 数値参照（10進 &#34; / 16進 &#x22;）
    if (ent[0] === "#") {
      const hex = ent[1] === "x" || ent[1] === "X";
      const code = parseInt(hex ? ent.slice(2) : ent.slice(1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    // 名前付き参照（既知のみ。未知はそのまま残す＝壊さない）
    const k = ent.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED, k) ? NAMED[k] : m;
  });
}
