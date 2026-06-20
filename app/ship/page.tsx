import type { Metadata } from "next";
import Link from "next/link";
import { Truck, Wallet } from "lucide-react";
import AuthButton from "../components/AuthButton";
import BottomNav from "../components/BottomNav";
import MyListings from "../components/MyListings";
import ShipOrders from "../components/ShipOrders";

export const metadata: Metadata = {
  title: "発送",
  robots: { index: false }, // 個人の取引一覧は検索除外
};

// 「発送」タブ：売れたあとにやること（仕入れ→発送→受け取り）を一か所に。売れた（輸出した）一覧もここ。
export default function ShipPage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header
        className="bg-gradient-to-r from-[#2D323B] to-[#2D323B] shadow-sm"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <span className="text-white font-black text-base tracking-tight">発送</span>
          <div className="ml-auto"><AuthButton /></div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-3 space-y-3">
        {/* 売れたあとの流れ（無在庫の3ステップ） */}
        <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-4 shadow-sm">
          <p className="text-[13px] font-black text-gray-800 mb-2">売れたあとの流れ</p>
          <ol className="text-[12px] text-gray-600 space-y-2 list-decimal pl-4 leading-relaxed">
            <li>楽天で同じ商品を<b className="text-gray-800">仕入れる</b>（「出品管理」の各商品の「仕入れ」ボタンから）</li>
            <li>届いたら梱包して、<b className="text-gray-800">郵便局／国際郵便マイページ</b>から海外発送（追跡あり）</li>
            <li>追跡番号をeBayに登録 → 売上は<b className="text-gray-800">Payoneer</b>で受け取り</li>
          </ol>
        </div>

        {/* 発送する注文（追跡番号の入力→eBay書き戻し） */}
        <ShipOrders />

        {/* 発送・受け取りのガイド導線 */}
        <div className="grid grid-cols-2 gap-2">
          <Link
            href="/guide#step-4"
            className="flex items-center justify-center gap-1.5 h-11 rounded-xl bg-white border border-[#A98B5C]/25 shadow-sm text-[12px] font-bold text-gray-700 active:bg-gray-50"
          >
            <Truck size={15} className="text-gray-500" /> 発送のしかた
          </Link>
          <Link
            href="/guide/payoneer-withdraw"
            className="flex items-center justify-center gap-1.5 h-11 rounded-xl bg-white border border-[#A98B5C]/25 shadow-sm text-[12px] font-bold text-gray-700 active:bg-gray-50"
          >
            <Wallet size={15} className="text-gray-500" /> 売上の受け取り方
          </Link>
        </div>

        {/* $100超を米国へ送るとき：関税前払い(DDP)の手順 */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <p className="text-[13px] font-black text-amber-800 mb-1.5">🛃 $100超を米国へ送るとき（関税の前払い）</p>
          <p className="text-[11px] text-amber-800/90 leading-relaxed mb-2">
            2025年に米国の少額免税が撤廃され、<b>商品代$100超の米国宛は、差出人が関税を前払い（DDP）してからでないと郵便局で出せません</b>。手順：
          </p>
          <ol className="text-[11px] text-amber-800/90 space-y-1 list-decimal pl-4 leading-relaxed">
            <li>Zonos（CBP認証業者）で関税を前払い → <b>13桁のDeclaration ID</b>を取得</li>
            <li>宛名ラベルに<b>「DDP」表記＋Declaration ID</b>を記載</li>
            <li><b>指定された郵便局</b>から差し出す（$100超は全局では出せません）</li>
          </ol>
          <p className="text-[10px] text-amber-700/80 mt-2 leading-relaxed">
            ※ $100以下は前払い不要・全局でOK。$800超は郵便のDDP処理対象外（個別相談）。制度は変わるので、発送前に郵便局の窓口で最新を確認してください。
          </p>
        </div>

        {/* 売れた（輸出した）一覧 */}
        <MyListings show={["sold"]} />
      </main>

      <BottomNav />
    </div>
  );
}
