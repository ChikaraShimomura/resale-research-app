// 楽天SPU対象サービスの共有設定（ガイドの「始める前の準備」とホームのチップ両方で使う）。
// 【方針】楽天アフィリエイトから撤退（転売支援サイトへのアフィリリンク掲載は楽天規約で禁止のため）。
// リンクはすべて成果報酬の付かない「公式ページへの直リンク」にする＝情報提供のみ。
export interface RakutenSvc {
  key: string;
  name: string; // 楽天カード
  short: string; // カード（ホームのチップ用）
  tag: string; // ガイドの見出しタグ
  chipTag: string; // ホームチップの短いタグ
  benefit: string; // ガイドの説明文
  primary: boolean; // ガイド: 主要(フル行) or その他(コンパクト)
  official: string;
}

export const RAKUTEN_SERVICES: RakutenSvc[] = [
  {
    key: "card", name: "楽天カード", short: "カード", tag: "まずこれ（土台）", chipTag: "土台",
    benefit: "仕入れの支払いを楽天カードにするだけで楽天市場が+1倍（通常分は上限なし）。準備の土台です。",
    primary: true, official: "https://www.rakuten-card.co.jp/",
  },
  {
    key: "mobile", name: "楽天モバイル", short: "モバイル", tag: "仕入れが増えたら", chipTag: "+4倍",
    benefit: "スマホを楽天モバイルにすると楽天市場が+4倍（月5万円ぶんまで）。月額がかかるので無理のない範囲で。",
    primary: true, official: "https://network.mobile.rakuten.co.jp/",
  },
  {
    key: "bank", name: "楽天銀行", short: "銀行", tag: "ノーコストで+0.3倍", chipTag: "+0.3倍",
    benefit: "楽天カードの引き落とし口座を楽天銀行にするだけで+0.3倍。費用はかかりません。",
    primary: true, official: "https://www.rakuten-bank.co.jp/",
  },
  {
    key: "hikari", name: "楽天ひかり", short: "ひかり", tag: "自宅ネットを寄せるなら", chipTag: "+2倍",
    benefit: "自宅のネット回線を楽天ひかりにすると+2倍。工事・解約金があるので無理のない範囲で。",
    primary: true, official: "https://hikari.rakuten.co.jp/",
  },
  {
    key: "sec", name: "楽天証券", short: "証券", tag: "+1倍", chipTag: "+1倍",
    benefit: "投信・米国株のポイント投資で最大+1倍（各月3万円・資金拘束あり）。※投資は元本割れの可能性があります。",
    primary: false, official: "https://www.rakuten-sec.co.jp/",
  },
  {
    key: "travel", name: "楽天トラベル", short: "トラベル", tag: "+1倍", chipTag: "+1倍",
    benefit: "出張・買い付けの宿泊を楽天トラベルで予約＆利用すると+1倍（5,000円以上）。",
    primary: false, official: "https://travel.rakuten.co.jp/",
  },
  {
    key: "books", name: "楽天ブックス", short: "ブックス", tag: "+0.5倍", chipTag: "+0.5倍",
    benefit: "本（紙）を月1回3,000円以上の注文で+0.5倍。",
    primary: false, official: "https://books.rakuten.co.jp/",
  },
  {
    key: "kobo", name: "楽天Kobo", short: "Kobo", tag: "+0.5倍", chipTag: "+0.5倍",
    benefit: "電子書籍を月1回3,000円以上の注文で+0.5倍（楽天ブックスとは別カウント）。",
    primary: false, official: "https://books.rakuten.co.jp/e-book/",
  },
  {
    key: "rakuma", name: "楽天ラクマ", short: "ラクマ", tag: "+0.5倍", chipTag: "+0.5倍",
    benefit: "不要在庫を国内で売ると+0.5倍（月2,000円以上の販売＆発送通知）。検品落ち品の処分にも。",
    primary: false, official: "https://fril.jp/",
  },
];

// リンクと「広告」表記の要否を解決。楽天アフィリ撤退により、常に公式ページへの直リンク（成果報酬なし＝広告表記不要）。
export function resolveRakutenLink(s: RakutenSvc): { url: string; ad: boolean } {
  return { url: s.official, ad: false };
}
