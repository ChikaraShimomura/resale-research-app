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
        className="bg-gradient-to-r from-[#2D323B] to-[#2D323B] shadow-sm sticky top-0 z-20"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <span className="text-white font-black text-base tracking-tight">発送</span>
          <div className="ml-auto"><AuthButton /></div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-3 space-y-3">
        {/* 発送と受け取りの手順（中立な手順表現） */}
        <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-4 shadow-sm">
          <p className="text-[13px] font-black text-gray-800 mb-2">発送と受け取りの手順</p>
          <ol className="text-[12px] text-gray-600 space-y-2 list-decimal pl-4 leading-relaxed">
            <li>
              <span className="whitespace-nowrap">梱包して</span><wbr />
              <b className="text-gray-800 whitespace-nowrap">郵便局／国際郵便マイページ</b><wbr />
              <span className="whitespace-nowrap">から海外発送（追跡あり）</span>
            </li>
            <li>
              <span className="whitespace-nowrap">追跡番号を</span>
              <b className="text-gray-800 whitespace-nowrap">eBayに登録</b><wbr />
              <span className="whitespace-nowrap">（未登録は売上保留・</span><wbr />
              <span className="whitespace-nowrap">未着クレームの原因）</span>
            </li>
            <li>
              <span className="whitespace-nowrap">売上を</span>
              <b className="text-gray-800 whitespace-nowrap">Payoneer</b>
              <span className="whitespace-nowrap">で受け取り →</span><wbr />
              <span className="whitespace-nowrap">日本の銀行へ出金</span>
            </li>
          </ol>
          {/* 新規セラーの売上保留は正常挙動である旨を明示し、受け取り方ガイドへ誘導 */}
          <p className="text-[11px] text-gray-500 mt-3 pt-3 border-t border-gray-100 leading-relaxed">
            <span className="whitespace-nowrap">新規セラーは</span><wbr />
            <b className="text-gray-700 whitespace-nowrap">配達確認まで売上が保留</b><wbr />
            <span className="whitespace-nowrap">されます（正常な仕様）。</span><wbr />
            <span className="whitespace-nowrap">詳しくは</span>
            <Link href="/guide/payoneer-withdraw" className="text-[#2D323B] font-bold underline underline-offset-2 whitespace-nowrap">
              売上の受け取り方
            </Link>
            <span className="whitespace-nowrap">をご覧ください。</span>
          </p>
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

        {/* $100超を米国へ送るとき：関税前払い(DDP)の手順。全員に常時出すと冗長なので折りたたみに格納（内容は保持） */}
        <details className="group bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
          <summary className="flex items-center justify-between gap-3 cursor-pointer list-none px-4 py-3 min-h-11 active:bg-amber-100/60">
            <span className="text-[13px] font-black text-amber-800"><span className="whitespace-nowrap">🛃 $100超の米国宛は</span><span className="whitespace-nowrap">関税前払い（DDP）</span></span>
            <span className="text-amber-700 text-[11px] font-bold shrink-0 flex items-center gap-1">
              詳しく見る
              <span className="transition-transform group-open:rotate-180">⌄</span>
            </span>
          </summary>
          <div className="px-4 pb-4">
            <p className="text-[11px] text-amber-800/90 leading-relaxed mb-2">
              <span className="whitespace-nowrap">米国の少額免税が撤廃</span><wbr />
              <span className="whitespace-nowrap">（2025年）。</span><wbr />
              <b className="whitespace-nowrap">商品代$100超の米国宛は、</b><wbr />
              <b className="whitespace-nowrap">関税を前払い（DDP）</b><wbr />
              <b className="whitespace-nowrap">しないと郵便局で出せません</b><wbr />
              <span className="whitespace-nowrap">。手順：</span>
            </p>
            <ol className="text-[11px] text-amber-800/90 space-y-1 list-decimal pl-4 leading-relaxed">
              <li>
                <span className="whitespace-nowrap">Zonosで関税を前払い →</span><wbr />
                <b className="whitespace-nowrap">13桁のDeclaration ID</b>
                <span className="whitespace-nowrap">を取得</span>
              </li>
              <li>
                <span className="whitespace-nowrap">宛名ラベルに</span><wbr />
                <b className="whitespace-nowrap">「DDP」＋Declaration ID</b>
                <span className="whitespace-nowrap">を記載</span>
              </li>
              <li>
                <b className="whitespace-nowrap">指定の郵便局</b>
                <span className="whitespace-nowrap">から差し出す（全局では不可）</span>
              </li>
            </ol>
            <p className="text-[10px] text-amber-700/80 mt-2 leading-relaxed">
              <span className="whitespace-nowrap">※ $100以下は前払い不要・全局OK。</span><wbr />
              <span className="whitespace-nowrap">$800超はDDP対象外（要相談）。</span><wbr />
              <span className="whitespace-nowrap">制度は変わるので発送前に窓口で確認を。</span>
            </p>
          </div>
        </details>

        {/* 売れた（輸出した）一覧 */}
        <MyListings show={["sold"]} />
      </main>

      <BottomNav />
    </div>
  );
}
