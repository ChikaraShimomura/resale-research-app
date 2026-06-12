// 日本の住所 → eBay用ローマ字変換ユーティリティ。
// 都道府県はコード(01-47)→正式英名。市区町村・町名はカタカナ→ヘボン式ローマ字。

export const PREF_BY_CODE: Record<string, string> = {
  "01": "Hokkaido", "02": "Aomori", "03": "Iwate", "04": "Miyagi", "05": "Akita",
  "06": "Yamagata", "07": "Fukushima", "08": "Ibaraki", "09": "Tochigi", "10": "Gunma",
  "11": "Saitama", "12": "Chiba", "13": "Tokyo", "14": "Kanagawa", "15": "Niigata",
  "16": "Toyama", "17": "Ishikawa", "18": "Fukui", "19": "Yamanashi", "20": "Nagano",
  "21": "Gifu", "22": "Shizuoka", "23": "Aichi", "24": "Mie", "25": "Shiga",
  "26": "Kyoto", "27": "Osaka", "28": "Hyogo", "29": "Nara", "30": "Wakayama",
  "31": "Tottori", "32": "Shimane", "33": "Okayama", "34": "Hiroshima", "35": "Yamaguchi",
  "36": "Tokushima", "37": "Kagawa", "38": "Ehime", "39": "Kochi", "40": "Fukuoka",
  "41": "Saga", "42": "Nagasaki", "43": "Kumamoto", "44": "Oita", "45": "Miyazaki",
  "46": "Kagoshima", "47": "Okinawa",
};

// 拗音（キャ等）の直接マップ
const YOON: Record<string, string> = {
  "キャ": "kya", "キュ": "kyu", "キョ": "kyo",
  "シャ": "sha", "シュ": "shu", "ショ": "sho",
  "チャ": "cha", "チュ": "chu", "チョ": "cho",
  "ニャ": "nya", "ニュ": "nyu", "ニョ": "nyo",
  "ヒャ": "hya", "ヒュ": "hyu", "ヒョ": "hyo",
  "ミャ": "mya", "ミュ": "myu", "ミョ": "myo",
  "リャ": "rya", "リュ": "ryu", "リョ": "ryo",
  "ギャ": "gya", "ギュ": "gyu", "ギョ": "gyo",
  "ジャ": "ja", "ジュ": "ju", "ジョ": "jo",
  "ビャ": "bya", "ビュ": "byu", "ビョ": "byo",
  "ピャ": "pya", "ピュ": "pyu", "ピョ": "pyo",
};

const KANA: Record<string, string> = {
  "ア": "a", "イ": "i", "ウ": "u", "エ": "e", "オ": "o",
  "カ": "ka", "キ": "ki", "ク": "ku", "ケ": "ke", "コ": "ko",
  "ガ": "ga", "ギ": "gi", "グ": "gu", "ゲ": "ge", "ゴ": "go",
  "サ": "sa", "シ": "shi", "ス": "su", "セ": "se", "ソ": "so",
  "ザ": "za", "ジ": "ji", "ズ": "zu", "ゼ": "ze", "ゾ": "zo",
  "タ": "ta", "チ": "chi", "ツ": "tsu", "テ": "te", "ト": "to",
  "ダ": "da", "ヂ": "ji", "ヅ": "zu", "デ": "de", "ド": "do",
  "ナ": "na", "ニ": "ni", "ヌ": "nu", "ネ": "ne", "ノ": "no",
  "ハ": "ha", "ヒ": "hi", "フ": "fu", "ヘ": "he", "ホ": "ho",
  "バ": "ba", "ビ": "bi", "ブ": "bu", "ベ": "be", "ボ": "bo",
  "パ": "pa", "ピ": "pi", "プ": "pu", "ペ": "pe", "ポ": "po",
  "マ": "ma", "ミ": "mi", "ム": "mu", "メ": "me", "モ": "mo",
  "ヤ": "ya", "ユ": "yu", "ヨ": "yo",
  "ラ": "ra", "リ": "ri", "ル": "ru", "レ": "re", "ロ": "ro",
  "ワ": "wa", "ヲ": "o", "ン": "n", "ヴ": "vu",
};

// カタカナ → ローマ字（ヘボン式）。長音ー・中黒は無視、促音ッは次子音を重ねる。
export function katakanaToRomaji(input: string): string {
  // NFKCで半角カナ(zipcloudの kana)→全角カナへ正規化。さらにひらがな→カタカナへ寄せる。
  const s = (input || "")
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const pair = c + (s[i + 1] ?? "");
    if (YOON[pair]) {
      out += YOON[pair];
      i++;
      continue;
    }
    if (c === "ッ") {
      const nr = KANA[s[i + 1]] ?? YOON[s[i + 1] + (s[i + 2] ?? "")] ?? "";
      if (nr) out += nr[0];
      continue;
    }
    if (c === "ー" || c === "・" || c === "　" || c === " ") continue;
    out += KANA[c] ?? "";
  }
  return out;
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// 市区町村のローマ字化。末尾の行政区分（区/市/町/村）をハイフン付きの読みに整える。
// 漢字(kanji)で末尾種別を判定し、ローマ字(kana由来)の語尾を置換する。
export function romanizeCity(kanji: string, kana: string): string {
  const base = cap(katakanaToRomaji(kana));
  const last = (kanji || "").slice(-1);
  if (last === "区" && /ku$/i.test(base)) return base.slice(0, -2) + "-ku";
  if (last === "市" && /shi$/i.test(base)) return base.slice(0, -3) + "-shi";
  if (last === "村" && /mura$/i.test(base)) return base.slice(0, -4) + "-mura";
  if (last === "町") {
    if (/machi$/i.test(base)) return base.slice(0, -5) + "-machi";
    if (/cho$/i.test(base)) return base.slice(0, -3) + "-cho";
  }
  return base;
}

// zipcloud の prefcode / 漢字 / kana から英字の住所パーツを返す
export function romanizeAddress(opts: {
  prefcode?: string;
  cityKanji?: string;
  cityKana?: string;
  townKana?: string;
}): { stateOrProvince: string; city: string; town: string } {
  return {
    stateOrProvince: PREF_BY_CODE[opts.prefcode ?? ""] ?? "",
    city: romanizeCity(opts.cityKanji ?? "", opts.cityKana ?? ""),
    town: cap(katakanaToRomaji(opts.townKana ?? "")),
  };
}
