"use client";
import { useEffect, useState, useCallback } from "react";
import Spinner from "./Spinner";

// 中古カタログ健康診断：配信ゲート(/catalog)が何件落としているかを表示。掲載数が急減した時に原因を即特定する「見える化」。
interface Health {
  at: string;
  total: number;
  confirmed: number;
  displayed: number;
  junk: number;
  drops: { notConfirmed: number; profitThin: number; prohibited: number };
  byGenre: Record<string, number>;
}

const DROP_LABEL: Record<keyof Health["drops"], string> = {
  notConfirmed: "型番一致せず(相場目安のみ)",
  profitThin: "利益率5%未満",
  prohibited: "発送不可(危険物)",
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

  const genres = h ? Object.entries(h.byGenre).sort((a, b) => b[1] - a[1]) : [];

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-black text-gray-800">中古カタログ健康診断</h2>
        <button onClick={load} disabled={loading} className="text-[12px] font-bold text-[#2D323B] underline underline-offset-2 disabled:opacity-50">
          {loading ? "確認中…" : "再確認"}
        </button>
      </div>
      <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
        中古カタログ(<code className="bg-gray-100 px-1 rounded">used_catalog</code>)の配信ゲートが何件落としているか。<b>掲載数が急減したら</b>原因をここで特定。
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
              <p className="text-xl font-black text-gray-700">{h.total}</p>
            </div>
            <div className="flex-1 rounded-xl bg-[#F8F9FB] border border-[#A98B5C]/25 p-2.5 text-center">
              <p className="text-[10px] text-gray-400">型番一致</p>
              <p className="text-xl font-black text-gray-700">{h.confirmed}</p>
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

          {/* 掲載分のジャンル内訳 */}
          {genres.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-gray-600 mb-1">掲載のジャンル内訳</p>
              <div className="flex flex-wrap gap-1.5">
                {genres.map(([g, n]) => (
                  <span key={g} className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#2D323B]/[0.06] text-[#2D323B] border border-[#A98B5C]/25">
                    {g}<span className="text-gray-400">{n}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-gray-400">ジャンク {h.junk}件（掲載対象）／ 診断: {new Date(h.at).toLocaleTimeString("ja-JP")}</p>
        </div>
      ) : null}
    </div>
  );
}
