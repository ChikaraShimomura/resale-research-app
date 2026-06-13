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

// 漢字（zipcloud address1 = "北海道"/"東京都" 等）→ 正式英名。prefcode より確実なので優先。
export const PREF_BY_KANJI: Record<string, string> = {
  "北海道": "Hokkaido", "青森県": "Aomori", "岩手県": "Iwate", "宮城県": "Miyagi", "秋田県": "Akita",
  "山形県": "Yamagata", "福島県": "Fukushima", "茨城県": "Ibaraki", "栃木県": "Tochigi", "群馬県": "Gunma",
  "埼玉県": "Saitama", "千葉県": "Chiba", "東京都": "Tokyo", "神奈川県": "Kanagawa", "新潟県": "Niigata",
  "富山県": "Toyama", "石川県": "Ishikawa", "福井県": "Fukui", "山梨県": "Yamanashi", "長野県": "Nagano",
  "岐阜県": "Gifu", "静岡県": "Shizuoka", "愛知県": "Aichi", "三重県": "Mie", "滋賀県": "Shiga",
  "京都府": "Kyoto", "大阪府": "Osaka", "兵庫県": "Hyogo", "奈良県": "Nara", "和歌山県": "Wakayama",
  "鳥取県": "Tottori", "島根県": "Shimane", "岡山県": "Okayama", "広島県": "Hiroshima", "山口県": "Yamaguchi",
  "徳島県": "Tokushima", "香川県": "Kagawa", "愛媛県": "Ehime", "高知県": "Kochi", "福岡県": "Fukuoka",
  "佐賀県": "Saga", "長崎県": "Nagasaki", "熊本県": "Kumamoto", "大分県": "Oita", "宮崎県": "Miyazaki",
  "鹿児島県": "Kagoshima", "沖縄県": "Okinawa",
};

// 政令指定都市（市＋区）。City名は正式英名、kana は「市」までのカナ（区を除く）。
// 例: 大阪市北区 → "Kita-ku, Osaka"
const DESIGNATED_CITIES: Record<string, { en: string; kana: string }> = {
  "札幌市": { en: "Sapporo", kana: "サッポロシ" },
  "仙台市": { en: "Sendai", kana: "センダイシ" },
  "さいたま市": { en: "Saitama", kana: "サイタマシ" },
  "千葉市": { en: "Chiba", kana: "チバシ" },
  "横浜市": { en: "Yokohama", kana: "ヨコハマシ" },
  "川崎市": { en: "Kawasaki", kana: "カワサキシ" },
  "相模原市": { en: "Sagamihara", kana: "サガミハラシ" },
  "新潟市": { en: "Niigata", kana: "ニイガタシ" },
  "静岡市": { en: "Shizuoka", kana: "シズオカシ" },
  "浜松市": { en: "Hamamatsu", kana: "ハママツシ" },
  "名古屋市": { en: "Nagoya", kana: "ナゴヤシ" },
  "京都市": { en: "Kyoto", kana: "キョウトシ" },
  "大阪市": { en: "Osaka", kana: "オオサカシ" },
  "堺市": { en: "Sakai", kana: "サカイシ" },
  "神戸市": { en: "Kobe", kana: "コウベシ" },
  "岡山市": { en: "Okayama", kana: "オカヤマシ" },
  "広島市": { en: "Hiroshima", kana: "ヒロシマシ" },
  "北九州市": { en: "Kitakyushu", kana: "キタキュウシュウシ" },
  "福岡市": { en: "Fukuoka", kana: "フクオカシ" },
  "熊本市": { en: "Kumamoto", kana: "クマモトシ" },
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
  "ヶ": "ga", "ヵ": "ka", "ヮ": "wa", "ヰ": "i", "ヱ": "e",
};

// 外来音（ヴ系・ファ系・ティ/ディ 等）の2カナ。単独カナより先に判定する。
const COMBO: Record<string, string> = {
  "ヴァ": "va", "ヴィ": "vi", "ヴェ": "ve", "ヴォ": "vo", "ヴュ": "vyu",
  "ファ": "fa", "フィ": "fi", "フェ": "fe", "フォ": "fo", "フュ": "fyu",
  "ティ": "ti", "ディ": "di", "トゥ": "tu", "ドゥ": "du",
  "ウィ": "wi", "ウェ": "we", "ウォ": "wo",
  "ツァ": "tsa", "ツィ": "tsi", "ツェ": "tse", "ツォ": "tso",
  "シェ": "she", "ジェ": "je", "チェ": "che",
  "イェ": "ye", "クァ": "kwa", "グァ": "gwa",
};

// 単独で現れた小書き母音 → 母音（直前モーラの母音を置き換えるのに使う）
const SMALL_VOWEL: Record<string, string> = { "ァ": "a", "ィ": "i", "ゥ": "u", "ェ": "e", "ォ": "o" };

// カタカナ → ローマ字（ヘボン式）。長音ー・中黒は無視、促音ッは次子音を重ねる。
export function katakanaToRomaji(input: string): string {
  // NFKCで半角カナ(zipcloudの kana)→全角カナへ正規化。さらにひらがな→カタカナへ寄せる。
  const s = (input || "")
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const c2 = s[i + 1] ?? "";
    const pair = c + c2;
    // 外来音の2カナ（ヴァ/ファ/ティ 等）
    if (COMBO[pair]) { out += COMBO[pair]; i++; continue; }
    // 拗音（キャ等）
    if (YOON[pair]) { out += YOON[pair]; i++; continue; }
    // 促音ッ：次の子音を重ねる（ch系は t を重ねて tch にする）
    if (c === "ッ") {
      const nr = COMBO[c2 + (s[i + 2] ?? "")] ?? YOON[c2 + (s[i + 2] ?? "")] ?? KANA[c2] ?? "";
      if (nr) out += nr.startsWith("ch") ? "t" : nr[0];
      continue;
    }
    // 単独の小書き母音：直前モーラの母音を置き換える（フ+ァ→fa の取りこぼし対策）
    if (SMALL_VOWEL[c]) {
      if (out && /[aiueo]$/.test(out)) out = out.slice(0, -1) + SMALL_VOWEL[c];
      else out += SMALL_VOWEL[c];
      continue;
    }
    // 長音符・中黒・空白は無視
    if (c === "ー" || c === "・" || c === "　" || c === " ") continue;
    out += KANA[c] ?? "";
  }
  // 長音の簡略化（地名慣用）。「oo」「uu」のみ縮約する。「ou」は形態素境界
  // （例: 丸の内 marunouchi の の+内）を壊しうるため、あえて保持する。
  return out.replace(/oo/g, "o").replace(/uu/g, "u");
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// 末尾の行政区分（区/市/町/村）をハイフン付きの読みに整える。
function withSuffix(romaji: string, lastKanji: string): string {
  const base = cap(romaji);
  if (lastKanji === "区" && /ku$/i.test(base)) return base.slice(0, -2) + "-ku";
  if (lastKanji === "市" && /shi$/i.test(base)) return base.slice(0, -3) + "-shi";
  if (lastKanji === "村") {
    if (/mura$/i.test(base)) return base.slice(0, -4) + "-mura";
    if (/son$/i.test(base)) return base.slice(0, -3) + "-son";
  }
  if (lastKanji === "町") {
    if (/machi$/i.test(base)) return base.slice(0, -5) + "-machi";
    const m = base.match(/(chou|cho)$/i); // 長音保持で「chou」になる場合に対応
    if (m) return base.slice(0, -m[0].length) + "-cho";
  }
  return base;
}

// ひらがな→カタカナへ寄せて NFKC 正規化（カナ同士を厳密に比較するため）
function toKatakana(kana: string): string {
  return (kana || "").normalize("NFKC").replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

// 市区町村のローマ字化。政令市の区・郡を「カナ側」で分解してから romaji 化する
// （ローマ字側で前方一致を取ると長音処理の差で外れることがあるため、カナで厳密一致させる）。
export function romanizeCity(kanji: string, kana: string): string {
  const k = kanji || "";
  const kn = toKatakana(kana);

  // 政令指定都市の区（例: 大阪市北区 → "Kita-ku, Osaka"）
  const sIdx = k.indexOf("市");
  if (sIdx >= 0 && sIdx < k.length - 1 && k.endsWith("区")) {
    const dc = DESIGNATED_CITIES[k.slice(0, sIdx + 1)];
    if (dc) {
      const cityKana = toKatakana(dc.kana);
      const wardKana = kn.startsWith(cityKana) ? kn.slice(cityKana.length) : kn;
      return `${withSuffix(katakanaToRomaji(wardKana), "区")}, ${dc.en}`;
    }
  }

  // 郡（例: 岩手郡葛巻町 → "Kuzumaki-machi"）。カナの「グン」までを落として町/村だけにする。
  // lastIndexOf にして「群馬郡…」のように district 名自体にグンを含む場合も正しく切る。
  if (k.includes("郡") && (k.endsWith("町") || k.endsWith("村"))) {
    const gp = kn.lastIndexOf("グン");
    const restKana = gp >= 0 ? kn.slice(gp + 2) : kn;
    return withSuffix(katakanaToRomaji(restKana), k.slice(-1));
  }

  // 通常（東京23区・市・町・村）
  return withSuffix(katakanaToRomaji(kn), k.slice(-1));
}

// zipcloud の prefcode / 漢字 / kana から英字の住所パーツを返す
export function romanizeAddress(opts: {
  prefKanji?: string;
  prefcode?: string;
  cityKanji?: string;
  cityKana?: string;
  townKana?: string;
}): { stateOrProvince: string; city: string; town: string } {
  const pref =
    PREF_BY_KANJI[(opts.prefKanji ?? "").normalize("NFKC").trim()] ??
    PREF_BY_CODE[String(opts.prefcode ?? "").padStart(2, "0")] ??
    "";
  return {
    stateOrProvince: pref,
    city: romanizeCity(opts.cityKanji ?? "", opts.cityKana ?? ""),
    town: cap(katakanaToRomaji(opts.townKana ?? "")),
  };
}

// 郵便番号を 100-0005 形式へ。7桁でなければ元の値をそのまま返す。
export function formatZip(input: string): string {
  const d = (input || "").replace(/[^0-9]/g, "");
  return d.length === 7 ? `${d.slice(0, 3)}-${d.slice(3)}` : (input || "");
}

// 自由入力の住所行（番地＋建物名など）をローマ字寄りに整える。
// 数字・丁目/番/号・各種ダッシュを整形、カタカナ/ひらがなはヘボン式、英数はそのまま。漢字は残す。
// 例: "1丁目2-3 サニーハイツ101" → "1-2-3 Sanihaitsu101"
export function romanizeFreeAddress(input: string): string {
  let s = (input || "").normalize("NFKC");
  s = s.replace(/丁目|番地|丁|番|号/g, "-");
  s = s.replace(/([0-9])\s*[のノ]\s*(?=[0-9])/g, "$1-");
  s = s.replace(/[ぁ-んァ-ヶー]+/g, (m) => katakanaToRomaji(m));
  s = s
    .replace(/[‐-―−ー]/g, "-")
    .replace(/[\s　]+/g, " ")
    .replace(/\s*-\s*/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^[-\s]+)|([-\s]+$)/g, "")
    .trim();
  return s.replace(/(^|\s)([a-z])/g, (_m, p, c) => p + c.toUpperCase());
}

// 文字列に漢字が含まれるか（自由入力で「ローマ字に直して」と案内する用）
export function hasKanji(s: string): boolean {
  return /[一-龥々]/.test(s || "");
}
