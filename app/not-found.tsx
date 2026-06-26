import Link from "next/link";

// 404。存在しない/廃止されたURLでも日本語の案内＋トップ導線を出す。
export default function NotFound() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white border border-[#A98B5C]/25 rounded-2xl p-6 text-center shadow-sm">
        <p className="text-3xl mb-2" aria-hidden="true">🔍</p>
        <h1 className="text-sm font-black text-gray-800 mb-1">ページが見つかりません</h1>
        <p className="text-[12px] text-gray-500 mb-5 leading-relaxed">お探しのページは移動・削除された可能性があります。</p>
        <Link href="/" className="inline-flex items-center justify-center h-11 px-6 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23]">
          トップへ
        </Link>
      </div>
    </div>
  );
}
