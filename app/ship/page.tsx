import type { Metadata } from "next";
import Link from "next/link";
import { Truck, Wallet } from "lucide-react";
import AuthButton from "../components/AuthButton";
import BottomNav from "../components/BottomNav";
import MyListings from "../components/MyListings";

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

        {/* 売れた（輸出した）一覧 */}
        <MyListings show={["sold"]} />
      </main>

      <BottomNav />
    </div>
  );
}
