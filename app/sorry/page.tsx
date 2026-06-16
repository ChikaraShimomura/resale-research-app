import { Wrench } from "lucide-react";

export const metadata = {
  title: "メンテナンス中 | 輸出ラボ",
  robots: { index: false, follow: false },
};

// メンテナンス／障害時のお詫びページ。middleware が MAINTENANCE_MODE=1 のとき全ページをここに切替える。
export default function SorryPage() {
  return (
    <main className="min-h-dvh bg-[#F5F7FA] flex flex-col items-center justify-center px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#BF0000] to-[#9E0000] flex items-center justify-center shadow-lg mb-5">
        <Wrench className="text-white" size={30} aria-hidden="true" />
      </div>

      <h1 className="text-xl font-black text-gray-800 mb-2">ただいまメンテナンス中です</h1>

      <p className="text-sm text-gray-500 leading-relaxed max-w-xs">
        これは一時的なメンテナンスです。ご不便をおかけします。
        <br />
        少し経ってから、もう一度お試しください。
      </p>

      <a
        href="/"
        className="mt-7 inline-flex items-center justify-center h-11 px-7 bg-[#BF0000] text-white font-bold text-sm rounded-xl active:bg-[#9E0000]"
      >
        再読み込みする
      </a>

      <p className="mt-8 text-xs text-gray-400">輸出ラボ</p>
    </main>
  );
}
