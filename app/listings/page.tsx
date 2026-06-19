import type { Metadata } from "next";
import AuthButton from "../components/AuthButton";
import BottomNav from "../components/BottomNav";
import MyListings from "../components/MyListings";

export const metadata: Metadata = {
  title: "出品管理",
  robots: { index: false }, // 個人の出品一覧は検索除外
};

// 「出品管理」タブ：eBayに出した商品の管理（出品中／出品停止中）。価格・数量の編集、再出品、出品停止。
// 売れた一覧と発送の導線は「発送」タブへ分けてある。
export default function ListingsPage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header
        className="bg-gradient-to-r from-[#2D323B] to-[#2D323B] shadow-sm"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <span className="text-white font-black text-base tracking-tight">出品管理</span>
          <div className="ml-auto"><AuthButton /></div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-3">
        <p className="text-[12px] text-gray-500 mb-3 leading-relaxed">
          eBayに出した商品の管理です。価格・数量の<b className="text-gray-700">編集</b>、<b className="text-gray-700">再出品</b>、
          <b className="text-gray-700">出品停止</b>ができます。売れた商品の発送・受け取りは「発送」タブへ。
        </p>
        <MyListings show={["live", "stopped"]} />
      </main>

      <BottomNav />
    </div>
  );
}
