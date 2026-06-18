"use client";
import { track } from "../lib/analytics";
import { RAKUTEN_SERVICES, resolveRakutenLink } from "../lib/rakutenServices";

// ホーム用の小さな楽天SPUチップ（2段・横並び）。仕入れ前に楽天サービスを揃えるとポイント還元が跳ね上がる、という後押し。
// リンク/「広告」表記は resolveRakutenLink（env > 楽天アフィリ自動生成 > 公式）。
export default function RakutenPointChips() {
  return (
    <section className="bg-white border border-[#A98B5C]/25 rounded-2xl shadow-sm p-3.5">
      <div className="flex items-baseline justify-between gap-2 mb-2.5">
        <p className="text-[12px] font-black text-gray-800 leading-snug">
          楽天サービスを揃えるほど、仕入れのポイントが<span className="text-[#2D323B]">跳ね上がる</span> 📈
        </p>
        <span className="text-[10px] text-gray-400 shrink-0">広告</span>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {RAKUTEN_SERVICES.map((s) => {
          const { url } = resolveRakutenLink(s);
          return (
            <a
              key={s.key}
              href={url}
              target="_blank"
              rel="sponsored noopener noreferrer"
              onClick={() => track("rakuten_chip_click", { svc: s.key })}
              className="flex flex-col items-center justify-center gap-0.5 rounded-lg border border-[#A98B5C]/25 bg-[#F5F7FA] py-2 px-1 active:bg-gray-100"
            >
              <span className="inline-flex w-4 h-4 bg-[#2D323B] rounded-full items-center justify-center text-white font-black text-[8px] shrink-0">R</span>
              <span className="text-[10px] font-bold text-gray-700 leading-none whitespace-nowrap">{s.short}</span>
              <span className="text-[8px] font-bold text-[#2D323B] leading-none">{s.chipTag}</span>
            </a>
          );
        })}
      </div>
      <p className="text-[10px] text-gray-400 leading-relaxed mt-2">
        ※ まずは楽天カードから。倍率・上限・条件は各公式で変更あり。
      </p>
    </section>
  );
}
