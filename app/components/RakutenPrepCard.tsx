"use client";
import { track } from "../lib/analytics";
import { ExternalLink } from "lucide-react";
import { RAKUTEN_SERVICES, resolveRakutenLink, type RakutenSvc } from "../lib/rakutenServices";

// 「始める前の準備：仕入れのポイントを上げる」導線。楽天経済圏(SPU)を整えると同じ仕入れでも還元(=利益)が上がる。
// リンク/「広告」表記は resolveRakutenLink が解決(env > 楽天アフィリ自動生成 > 公式)。
// コピーは景表法/金融・通信・金商法の規制に配慮し、断定/誇大(実質無料・最安・必ず得・利回り断定)を避け、
// 倍率は上限・変更ありの注記とセットで、詳細は公式に誘導する。

function Row({ s, compact }: { s: RakutenSvc; compact?: boolean }) {
  const { url, ad } = resolveRakutenLink(s);
  return (
    <a
      href={url}
      target="_blank"
      rel="sponsored noopener noreferrer"
      onClick={() => track("rakuten_prep_click", { svc: s.key })}
      className={`block rounded-xl border border-[#A98B5C]/25 bg-[#F5F7FA] active:bg-gray-100 ${compact ? "px-3 py-2.5" : "px-3.5 py-3"}`}
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex w-5 h-5 bg-[#BF0000] rounded-full items-center justify-center text-white font-black text-[10px] shrink-0">R</span>
        <span className={`font-black text-gray-800 ${compact ? "text-[12px]" : "text-[13px]"}`}>{s.name}</span>
        <span className="text-[10px] font-bold text-[#BF0000] bg-[#BF0000]/10 rounded-full px-2 py-0.5 shrink-0">{s.tag}</span>
        {ad && <span className="text-[10px] text-gray-400 ml-1">広告</span>}
        <ExternalLink size={13} className="text-gray-400 ml-auto shrink-0" />
      </div>
      <p className={`text-gray-500 leading-relaxed mt-1 ${compact ? "text-[10px]" : "text-[11px]"}`}>{s.benefit}</p>
    </a>
  );
}

export default function RakutenPrepCard() {
  const primary = RAKUTEN_SERVICES.filter((s) => s.primary);
  const secondary = RAKUTEN_SERVICES.filter((s) => !s.primary);
  return (
    <section className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-4">
      <h3 className="text-[15px] font-black text-gray-800">仕入れのポイントを上げる準備</h3>
      <p className="text-[12px] text-gray-500 leading-relaxed mt-1 mb-3">
        仕入れ前に整えると<b>同じ仕入れでも還元（＝利益）が増えます</b>。各サービスに月の上限あり。<b>まずは楽天カードだけ</b>でOK、あとは無理なく。
      </p>

      <div className="space-y-2.5">
        {primary.map((s) => (
          <Row key={s.key} s={s} />
        ))}
      </div>

      <p className="text-[11px] font-bold text-gray-500 mt-4 mb-2">その他のSPU対象（無理のない範囲で）</p>
      <div className="space-y-2">
        {secondary.map((s) => (
          <Row key={s.key} s={s} compact />
        ))}
      </div>

      <p className="text-[10px] text-gray-400 leading-relaxed mt-3">
        ※ ポイント倍率・特典・年会費・キャンペーンは変更の場合あり。各サービスに月間の獲得上限があり、超過分は加算されません。条件・最新情報は各公式サイトで確認を。
      </p>
    </section>
  );
}
