"use client";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

// セラー登録で離脱しないための「迷わない手順ガイド」。STEP2の中に折りたたみで表示。
export default function EbaySellerGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 border border-gray-100 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left bg-[#F5F7FA] active:bg-gray-100"
      >
        <span className="text-[13px] font-bold text-gray-800 flex-1">登録のやり方をくわしく見る（10〜15分）</span>
        <ChevronDown size={16} className={open ? "text-gray-400 rotate-180" : "text-gray-400"} />
      </button>

      {open && (
        <div className="px-3.5 py-3 text-[12px] leading-relaxed text-gray-600 space-y-3">
          <div>
            <p className="font-bold text-gray-800 mb-1">先に用意するもの</p>
            <ul className="space-y-1">
              <li>スマホ（SMSの認証コードを受け取ります）</li>
              <li>本人確認書類（マイナンバーカード・運転免許証・パスポートのどれか1つ）</li>
              <li>自分名義の銀行口座（売上の受け取り用。ネット銀行でOK）</li>
            </ul>
          </div>

          <div>
            <p className="font-bold text-gray-800 mb-1">手順</p>
            <ol className="space-y-1.5 list-decimal list-inside">
              <li>eBayにログイン（アカウントが無ければ先に作成）</li>
              <li>「Sell（出品する）」に進むと、セラー登録の案内が出ます</li>
              <li>名前・住所（ローマ字）・電話番号を入力 → 届いたSMSの数字コードで認証</li>
              <li>売上の受け取り設定：日本はPayoneer経由。案内に沿ってPayoneer（個人）を作成し、連絡先・銀行口座を登録 → 申請完了</li>
              <li>本人確認：登録のあとPayoneerから「書類を提出して」メールが届くので、案内どおり身分証を提出（Payoneerアプリのカメラが便利）。0〜3日で承認</li>
              <li>完了！ このアプリに戻って「登録完了」を押すと、そのまま出品できます</li>
            </ol>
          </div>

          <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            <p className="font-bold text-amber-800 mb-1">つまずきポイント（先に知っておくと安心）</p>
            <ul className="space-y-1 text-amber-800">
              <li>名前と住所はローマ字で。eBay・Payoneer・銀行で同じ名義にそろえる（バラバラだと振込が止まります）</li>
              <li>個人なら「個人（Individual）」を選ぶ（開業届があれば法人/ビジネス）</li>
              <li>承認に数時間〜数日かかることがあります（すぐ反映されなくても大丈夫）</li>
              <li>最初は月10品ほどの出品上限から。売れて実績が付くと自動で増えます</li>
            </ul>
          </div>

          <p className="text-[11px] text-gray-400">
            所要 10〜15分（承認待ちは別）。一度やれば、あとはずっと出品できます。
          </p>
        </div>
      )}
    </div>
  );
}
