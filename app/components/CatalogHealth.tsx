"use client";
import { useEffect, useState, useCallback } from "react";
import Spinner from "./Spinner";

// カタログ健康診断：配信ゲートが何件落としているかを表示。件数が急に減った時に原因を即特定するための「見える化」。
interface Health {
  at: string;
  catalogTotal: number;
  soldVerified: number;
  displayed: number;
  drops: { watermark: number; soldFull: number; gallery: number; noImage: number; notVerified: number; profitThin: number; over800: number; deadSource: number };
  lastUpdated: string | null;
  refreshFunnel: { noRakuten?: number; noMatch?: number; matched?: number; noKeyword?: number; error?: number } | null;
}

const DROP_LABEL: Record<keyof Health["drops"], string> = {
  watermark: "透かし入り画像",
  soldFull: "満了(出品者5人+)",
  gallery: "参考画像 未取得",
  noImage: "画像なし",
  notVerified: "落札未確認",
  profitThin: "現金利益<1%(論外)",
  over800: "$800超",
  deadSource: "楽天 売切/削除",
};

export default function CatalogHealth() {
  const [h, setH] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const j = await fetch("/api/admin/catalog-health", { cache: "no-store" }).then((r) => r.json());
      if (j?.ok) setH(j.health);
      else setErr("取得できませんでした。");
    } catch { setErr("通信エラーで取得できませんでした。"); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-black text-gray-800">カタログ健康診断</h2>
        <button onClick={load} disabled={loading} className="text-[12px] font-bold text-[#2D323B] underline underline-offset-2 disabled:opacity-50">
          {loading ? "確認中…" : "再確認"}
        </button>
      </div>
      <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
        配信の各ゲートが何件落としているか。<b>掲載数が急に減ったら</b>、どのゲートが原因かここで分かります。
      </p>

      {loading && !h ? (
        <div className="flex items-center gap-2 py-4 text-gray-400 text-[12px]"><Spinner size={14} /> 集計中…</div>
      ) : err ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[12px] px-3 py-2.5">{err}</div>
      ) : h ? (
        <div className="space-y-3">
          {/* サマリ */}
          <div className="flex items-stretch gap-2">
            <div className="flex-1 rounded-xl bg-[#F8F9FB] border border-[#A98B5C]/25 p-2.5 text-center">
              <p className="text-[10px] text-gray-400">カタログ総数</p>
              <p className="text-xl font-black text-gray-700">{h.catalogTotal}</p>
            </div>
            <div className="flex-1 rounded-xl bg-[#F8F9FB] border border-[#A98B5C]/25 p-2.5 text-center">
              <p className="text-[10px] text-gray-400">落札確認済</p>
              <p className="text-xl font-black text-gray-700">{h.soldVerified}</p>
            </div>
            <div className="flex-1 rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 text-center">
              <p className="text-[10px] text-emerald-600">掲載中</p>
              <p className="text-xl font-black text-emerald-700">{h.displayed}</p>
            </div>
          </div>

          {/* ゲート別ドロップ */}
          <div>
            <p className="text-[11px] font-bold text-gray-600 mb-1">除外の内訳（多い順）</p>
            <div className="space-y-1">
              {Object.entries(h.drops)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-[12px]">
                    <span className={v > 0 ? "text-gray-700" : "text-gray-300"}>{DROP_LABEL[k as keyof Health["drops"]]}</span>
                    <span className={`font-bold tabular-nums ${v > 0 ? "text-[#BF0000]" : "text-gray-300"}`}>−{v}</span>
                  </div>
                ))}
            </div>
          </div>

          {/* 取得側(refresh)のファネル＝楽天0件率 */}
          {h.refreshFunnel && (h.refreshFunnel.noRakuten != null) && (() => {
            const f = h.refreshFunnel!;
            const tot = (f.noKeyword ?? 0) + (f.noRakuten ?? 0) + (f.noMatch ?? 0) + (f.error ?? 0) + (f.matched ?? 0);
            const pct = tot ? Math.round(((f.noRakuten ?? 0) / tot) * 100) : 0;
            return (
              <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-[11px] text-gray-500 leading-relaxed">
                取得側(直近refresh)：楽天0件率 <b className="text-gray-700">{pct}%</b>（{f.noRakuten}/{tot}）・成立 {f.matched}。
                これが高い＝仕入れ先を増やすほど件数が伸びる余地。
              </div>
            );
          })()}

          <p className="text-[10px] text-gray-400">最終取得: {h.lastUpdated ? new Date(h.lastUpdated).toLocaleString("ja-JP") : "—"} / 診断: {new Date(h.at).toLocaleTimeString("ja-JP")}</p>
        </div>
      ) : null}
    </div>
  );
}
