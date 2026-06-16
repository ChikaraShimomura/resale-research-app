"use client";
import { track } from "../lib/analytics";
import { ExternalLink } from "lucide-react";

// 「始める前の準備：仕入れのポイントを上げる」導線。楽天経済圏(SPU)を整えると同じ仕入れでも還元(=利益)が上がる。
// 各サービスのアフィリエイトURLは env(NEXT_PUBLIC_RAKUTEN_*_AFF_URL)で設定。未設定なら公式ページにフォールバック(=今でも動く)。
// 楽天モバイルは後でA8のリンクに差し替え可能(NEXT_PUBLIC_RAKUTEN_MOBILE_AFF_URL に入れるだけ)。
// NEXT_PUBLIC_* はビルド時に埋め込み(公開値)。コピーは景表法/金融・通信・金商法の規制に配慮し、
// 断定/誇大(実質無料・最安・必ず得・利回り断定)を避け、倍率は上限・変更ありの注記とセットで、詳細は公式に誘導する。
interface Svc {
  key: string;
  name: string;
  tag: string;
  benefit: string;
  url: string;
  ad: boolean; // アフィリURLが設定済み＝「広告」表記を出す(ステマ規制/ASP規約対応)
}

// 仕入れ還元への効きが大きい順。カード=土台、モバイル/ひかり=条件付き、その他=無理のない範囲で。
const PRIMARY: Svc[] = [
  {
    key: "card",
    name: "楽天カード",
    tag: "まずこれ（土台）",
    benefit: "仕入れの支払いを楽天カードにするだけで楽天市場が+1倍（通常分は上限なし）。準備の土台です。",
    url: process.env.NEXT_PUBLIC_RAKUTEN_CARD_AFF_URL || "https://www.rakuten-card.co.jp/",
    ad: !!process.env.NEXT_PUBLIC_RAKUTEN_CARD_AFF_URL,
  },
  {
    key: "mobile",
    name: "楽天モバイル",
    tag: "仕入れが増えたら",
    benefit: "スマホを楽天モバイルにすると楽天市場が+4倍（月5万円ぶんまで）。月額がかかるので無理のない範囲で。",
    url: process.env.NEXT_PUBLIC_RAKUTEN_MOBILE_AFF_URL || "https://network.mobile.rakuten.co.jp/",
    ad: !!process.env.NEXT_PUBLIC_RAKUTEN_MOBILE_AFF_URL,
  },
  {
    key: "bank",
    name: "楽天銀行",
    tag: "ノーコストで+0.3倍",
    benefit: "楽天カードの引き落とし口座を楽天銀行にするだけで+0.3倍。費用はかかりません。",
    url: process.env.NEXT_PUBLIC_RAKUTEN_BANK_AFF_URL || "https://www.rakuten-bank.co.jp/",
    ad: !!process.env.NEXT_PUBLIC_RAKUTEN_BANK_AFF_URL,
  },
  {
    key: "hikari",
    name: "楽天ひかり",
    tag: "自宅ネットを寄せるなら",
    benefit: "自宅のネット回線を楽天ひかりにすると+2倍。工事・解約金があるので無理のない範囲で。",
    url: process.env.NEXT_PUBLIC_RAKUTEN_HIKARI_AFF_URL || "https://hikari.rakuten.co.jp/",
    ad: !!process.env.NEXT_PUBLIC_RAKUTEN_HIKARI_AFF_URL,
  },
];

// その他のSPU対象（効きは小さめ・条件付き。無理に契約しない前提でコンパクトに）。
const SECONDARY: Svc[] = [
  {
    key: "sec",
    name: "楽天証券",
    tag: "+1倍",
    benefit: "投信・米国株のポイント投資で最大+1倍（各月3万円・資金拘束あり）。※投資は元本割れの可能性があります。",
    url: process.env.NEXT_PUBLIC_RAKUTEN_SEC_AFF_URL || "https://www.rakuten-sec.co.jp/",
    ad: !!process.env.NEXT_PUBLIC_RAKUTEN_SEC_AFF_URL,
  },
  {
    key: "travel",
    name: "楽天トラベル",
    tag: "+1倍",
    benefit: "出張・買い付けの宿泊を楽天トラベルで予約＆利用すると+1倍（5,000円以上）。",
    url: process.env.NEXT_PUBLIC_RAKUTEN_TRAVEL_AFF_URL || "https://travel.rakuten.co.jp/",
    ad: !!process.env.NEXT_PUBLIC_RAKUTEN_TRAVEL_AFF_URL,
  },
  {
    key: "books",
    name: "楽天ブックス",
    tag: "+0.5倍",
    benefit: "本（紙）を月1回3,000円以上の注文で+0.5倍。",
    url: process.env.NEXT_PUBLIC_RAKUTEN_BOOKS_AFF_URL || "https://books.rakuten.co.jp/",
    ad: !!process.env.NEXT_PUBLIC_RAKUTEN_BOOKS_AFF_URL,
  },
  {
    key: "kobo",
    name: "楽天Kobo",
    tag: "+0.5倍",
    benefit: "電子書籍を月1回3,000円以上の注文で+0.5倍（楽天ブックスとは別カウント）。",
    url: process.env.NEXT_PUBLIC_RAKUTEN_KOBO_AFF_URL || "https://books.rakuten.co.jp/e-book/",
    ad: !!process.env.NEXT_PUBLIC_RAKUTEN_KOBO_AFF_URL,
  },
  {
    key: "rakuma",
    name: "楽天ラクマ",
    tag: "+0.5倍",
    benefit: "不要在庫を国内で売ると+0.5倍（月2,000円以上の販売＆発送通知）。検品落ち品の処分にも。",
    url: process.env.NEXT_PUBLIC_RAKUTEN_RAKUMA_AFF_URL || "https://fril.jp/",
    ad: !!process.env.NEXT_PUBLIC_RAKUTEN_RAKUMA_AFF_URL,
  },
];

function Row({ s, compact }: { s: Svc; compact?: boolean }) {
  return (
    <a
      href={s.url}
      target="_blank"
      rel="sponsored noopener noreferrer"
      onClick={() => track("rakuten_prep_click", { svc: s.key })}
      className={`block rounded-xl border border-gray-100 bg-[#F5F7FA] active:bg-gray-100 ${compact ? "px-3 py-2.5" : "px-3.5 py-3"}`}
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex w-5 h-5 bg-[#BF0000] rounded-full items-center justify-center text-white font-black text-[10px] shrink-0">R</span>
        <span className={`font-black text-gray-800 ${compact ? "text-[12px]" : "text-[13px]"}`}>{s.name}</span>
        <span className="text-[10px] font-bold text-[#BF0000] bg-[#BF0000]/10 rounded-full px-2 py-0.5 shrink-0">{s.tag}</span>
        {s.ad && <span className="text-[10px] text-gray-400 ml-1">広告</span>}
        <ExternalLink size={13} className="text-gray-400 ml-auto shrink-0" />
      </div>
      <p className={`text-gray-500 leading-relaxed mt-1 ${compact ? "text-[10px]" : "text-[11px]"}`}>{s.benefit}</p>
    </a>
  );
}

export default function RakutenPrepCard() {
  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <h3 className="text-[15px] font-black text-gray-800">仕入れのポイントを上げる準備</h3>
      <p className="text-[12px] text-gray-500 leading-relaxed mt-1 mb-3">
        楽天市場で仕入れる前に整えると、<b>同じ仕入れでも還元（＝利益）が増えます</b>。各サービスに月の上限があるので、<b>まずは楽天カードだけ</b>でOK。あとは無理のない範囲で。
      </p>

      <div className="space-y-2.5">
        {PRIMARY.map((s) => (
          <Row key={s.key} s={s} />
        ))}
      </div>

      <p className="text-[11px] font-bold text-gray-500 mt-4 mb-2">その他のSPU対象（無理のない範囲で）</p>
      <div className="space-y-2">
        {SECONDARY.map((s) => (
          <Row key={s.key} s={s} compact />
        ))}
      </div>

      <p className="text-[10px] text-gray-400 leading-relaxed mt-3">
        ※ ポイント倍率・特典・年会費・キャンペーンは変更されることがあります。各サービスには月間の獲得上限があり、上限を超える分は加算されません。条件・最新情報は各公式サイトでご確認ください。
      </p>
    </section>
  );
}
