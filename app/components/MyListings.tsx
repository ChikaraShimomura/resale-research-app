"use client";
import { useEffect, useState } from "react";
import { Package, ChevronDown, ChevronUp, Pencil, RotateCw, Ban, ShoppingCart, Sparkles } from "lucide-react";
import { ProfitProduct } from "../lib/profitFilter";
import { toRakutenProductUrl } from "../lib/utils";
import EbayListingModal from "./EbayListingModal";
import EditListingModal from "./EditListingModal";
import Spinner from "./Spinner";
import { clearListedFlag } from "../lib/ebayListed";

interface LiveDeal { id: string; title: string; listedAt: string; purchase: number; imageUrl: string; sourceUrl?: string; listingId?: string; stoppedAt?: string; archivedAt?: string; sourceStatus?: "dead" | "soldout"; priceDrift?: { nowJpy: number; pct: number; at: string }; stopFailedCount?: number }
interface SoldDeal { id: string; title: string; imageUrl: string; soldAt: string; soldJpy: number; profitJpy: number; purchase: number }

const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");
const signedYen = (n: number) => (n < 0 ? "−" : "+") + "¥" + Math.round(Math.abs(n)).toLocaleString("ja-JP");
const shortDate = (iso: string) => {
  const d = (iso || "").slice(0, 10);
  const m = d.slice(5, 7), day = d.slice(8, 10);
  return m && day ? `${Number(m)}/${Number(day)}` : "";
};
function Thumb({ url }: { url: string }) {
  if (url) return <img src={url} alt="" loading="lazy" className="w-9 h-9 rounded-md object-cover bg-gray-50 border border-[#A98B5C]/25 shrink-0" />;
  return (
    <div className="w-9 h-9 rounded-md bg-gray-50 border border-[#A98B5C]/25 shrink-0 flex items-center justify-center text-gray-300">
      <Package size={16} />
    </div>
  );
}

// 開閉できるセクション（既定は閉じる）。ヘッダーに件数を出す。0件でも常に表示する。
function Section({ title, count, open, onToggle, children }: { title: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#A98B5C]/25 rounded-2xl shadow-sm overflow-hidden">
      <button onClick={onToggle} aria-expanded={open} className="w-full flex items-center justify-between px-4 py-3 active:bg-gray-50">
        <span className="text-[13px] font-black text-gray-800">{title}（{count}件）</span>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

function EmptyNote({ text, children }: { text?: string; children?: React.ReactNode }) {
  return <p className="text-[11px] text-gray-400 py-1.5 leading-relaxed">{children ?? text}</p>;
}

// マイページの一覧は「出品中／出品停止中／輸出した（売れた）」の3つだけ。0件でも常に表示する。
// 出品をやめた → 成績から外す／実は売れていた → 売れた金額(円)で記録（→輸出した側へ移動）。
export type ListingSection = "live" | "stopped" | "sold";
// show: 表示するセクションを選べる（出品管理タブ=live+stopped／発送タブ=sold）。既定は全部。
export default function MyListings({ onChanged, show = ["live", "stopped", "sold"] }: { onChanged?: () => void; show?: ListingSection[] }) {
  const [live, setLive] = useState<LiveDeal[] | null>(null);
  const [stopped, setStopped] = useState<LiveDeal[] | null>(null);
  const [archived, setArchived] = useState<LiveDeal[]>([]); // 過去の出品（停止24h超でアーカイブ＝既定で隠す。再出品で復帰）
  const [sold, setSold] = useState<SoldDeal[] | null>(null);
  const [openLive, setOpenLive] = useState(show.includes("live"));
  const [openStopped, setOpenStopped] = useState(false);
  const [openArchived, setOpenArchived] = useState(false); // 過去の出品（アーカイブ）は既定で折りたたみ
  const [openSold, setOpenSold] = useState(show.includes("sold"));
  const [busy, setBusy] = useState<string | null>(null);
  const [soldFor, setSoldFor] = useState<string | null>(null); // 売れた金額を入力中の商品
  const [soldJpy, setSoldJpy] = useState("");
  const [relistProduct, setRelistProduct] = useState<ProfitProduct | null>(null); // 再出品モーダルで開く商品
  const [relistBusy, setRelistBusy] = useState<string | null>(null); // 再出品の商品データ取得中
  const [editDeal, setEditDeal] = useState<LiveDeal | null>(null); // アプリ内編集（価格・数量）モーダルで開く出品
  const [livenessStale, setLivenessStale] = useState(false); // 売切検知ワーカー(住宅IP)が停止中＝在庫チェックが遅れている
  const [planInfo, setPlanInfo] = useState<{ planName: string; limit: number | null; liveCount: number } | null>(null); // プラン上限ナッジ用
  const [optimizedIds, setOptimizedIds] = useState<Set<string>>(new Set()); // 現テンプレ版で最適化済みの商品ID（ボタンのグレーアウト用）
  const [optBusy, setOptBusy] = useState<string | null>(null); // 最適化中の商品ID
  const [optErr, setOptErr] = useState<Record<string, string>>({}); // 最適化エラー（商品ID→文言）
  const [actErr, setActErr] = useState<Record<string, string>>({}); // 売れた/削除など act() の行内エラー（商品ID→文言）
  const [celebrate, setCelebrate] = useState<{ profitJpy: number } | null>(null); // 「売れた」記録直後のインライン祝福（次ループ導線）

  // 「再出品」：現行カタログ/アーカイブから同じ商品を取り出して、出品モーダルを開き直す（既存の出品フローを再利用）。
  const relist = async (productId: string) => {
    setRelistBusy(productId);
    try {
      const j = await fetch(`/api/ebay/product?id=${encodeURIComponent(productId)}`, { cache: "no-store" }).then((r) => r.json());
      if (j?.ok && j.product) setRelistProduct(j.product as ProfitProduct);
      else window.alert("この商品の情報が見つかりませんでした。時間をおいて再度お試しください。");
    } catch {
      window.alert("出品の準備に失敗しました。通信環境を確認して再度お試しください。");
    }
    setRelistBusy(null);
  };

  const load = () =>
    fetch("/api/ebay/deals", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { setLive(j.ok ? j.live : []); setStopped(j.ok ? (j.stopped ?? []) : []); setArchived(j.ok ? (j.archived ?? []) : []); setSold(j.ok ? j.sold : []); setPlanInfo(j.ok ? (j.planInfo ?? null) : null); })
      .catch(() => { setLive([]); setStopped([]); setArchived([]); setSold([]); });
  useEffect(() => { load(); }, []);
  // 現テンプレ版で「最適化済み」の出品を取得（ボタンのグレーアウト/「最適化済み」表示に使う）。
  useEffect(() => {
    if (!show.includes("live")) return;
    fetch("/api/ebay/list/optimize", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j?.ok && Array.isArray(j.optimized)) setOptimizedIds(new Set<string>(j.optimized)); })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 「最適化」：既存eBay出品のタイトル・説明・Item Specifics を返品最小化テンプレに改訂する（AIゼロ＝課金なし）。
  // 価格・数量・状態は変えない。同テンプレ版で済みなら no-op（サーバーが版で判定）。
  const optimize = async (productId: string) => {
    setOptBusy(productId);
    setOptErr((e) => { const n = { ...e }; delete n[productId]; return n; });
    try {
      const j = await fetch("/api/ebay/list/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      }).then((r) => r.json());
      if (j.ok) {
        setOptimizedIds((s) => new Set(s).add(productId));
      } else {
        setOptErr((e) => ({ ...e, [productId]: j.error || "最適化に失敗しました。時間をおいてお試しください。" }));
      }
    } catch {
      setOptErr((e) => ({ ...e, [productId]: "通信エラーで最適化できませんでした。" }));
    }
    setOptBusy(null);
  };

  // 売切検知ワーカー(住宅IP)の鮮度を確認。停止中(stale)なら在庫チェックが遅れている＝降格表示する。
  useEffect(() => {
    fetch("/api/ops/liveness", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setLivenessStale(j?.fresh === false))
      .catch(() => {});
  }, []);

  // 「出品停止」：eBayの出品(オファー)を取り下げて終了し、出品停止中一覧へ移す。
  const stopListing = async (productId: string) => {
    if (!window.confirm("この商品のeBay出品を停止しますか？（出品を終了。あとで再出品できます）")) return;
    setBusy(productId);
    try {
      const j = await fetch("/api/ebay/list/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      }).then((r) => r.json());
      if (j.ok) {
        if (j.ended === false) window.alert("この商品は現在eBayに出品されていません。");
        clearListedFlag(productId); // 端末の「出品済み」フラグも消す＝カタログのボタン固着を防ぐ
        await load();
        onChanged?.();
      } else {
        window.alert(j.error || "出品停止に失敗しました。");
      }
    } catch {
      window.alert("通信エラーで出品停止できませんでした。");
    }
    setBusy(null);
  };

  const act = async (productId: string, action: "remove" | "sold", extra?: { soldJpy: number }) => {
    setBusy(productId);
    setActErr((e) => { const n = { ...e }; delete n[productId]; return n; }); // 前回の行内エラーを消す
    try {
      const res = await fetch("/api/ebay/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, productId, ...extra }),
      }).then((r) => r.json());
      if (res.ok) {
        // 削除(やめた)＝完全に出品実績から外す。端末の「出品済み」フラグも消して、カタログで再出品できるよう戻す。
        if (action === "remove") clearListedFlag(productId);
        setSoldFor(null);
        setSoldJpy("");
        // 「売れた」成功直後はその場で祝福＋次ループ導線（出品熱→次の利益商品へ）。
        // 正確な純利益は手数料モデルが必要なため、ここでは確実に分かる「売値−仕入れ」の粗利で控えめに祝う。
        if (action === "sold" && extra) {
          const purchase = live?.find((x) => x.id === productId)?.purchase ?? 0;
          setCelebrate({ profitJpy: extra.soldJpy - purchase });
        }
        await load(); // 各リストを取り直す（売れた商品は輸出した側へ移動）
        onChanged?.(); // 親(マイページ)の集計も更新
      } else {
        // 無言(noop)をやめ、行内に赤文字でエラーを出す。
        setActErr((e) => ({ ...e, [productId]: res.error || (action === "sold" ? "記録に失敗しました。時間をおいてお試しください。" : "操作に失敗しました。時間をおいてお試しください。") }));
      }
    } catch {
      setActErr((e) => ({ ...e, [productId]: "通信エラーで操作できませんでした。" }));
    }
    setBusy(null);
  };

  // 読み込み中：真っ白で「壊れた/何も無い」と誤認させない（results/searchと同様にスピナーを出す）。
  if (live === null || stopped === null || sold === null) {
    return (
      <div className="rounded-2xl border border-[#A98B5C]/20 bg-white px-4 py-8 flex items-center justify-center gap-2 text-gray-400 text-[12px]">
        <Spinner size={16} /> 一覧を読み込み中…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 「売れた」記録の直後にその場で祝福＋次の利益商品への導線（出品熱→次ループへ）。
          純利益は手数料込みで別計算のため、ここでは「売値−仕入れ」の粗利を控えめに表示する。 */}
      {celebrate && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3" role="status" aria-live="polite">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-black text-emerald-800 leading-tight">
                🎉 売れたを記録しました！
                {celebrate.profitJpy > 0 && (
                  <span className="ml-1">粗利 {signedYen(celebrate.profitJpy)}</span>
                )}
              </p>
              <p className="text-[11px] text-emerald-700/90 mt-0.5 leading-relaxed">
                <span className="whitespace-nowrap">この調子で次の1品も。</span><wbr />
                <span className="whitespace-nowrap">詳しい利益は</span><wbr />
                <span className="whitespace-nowrap">「輸出した商品」に記録されます。</span>
              </p>
            </div>
            <button
              onClick={() => setCelebrate(null)}
              aria-label="閉じる"
              className="shrink-0 text-emerald-600/70 text-[16px] leading-none h-6 w-6 inline-flex items-center justify-center"
            >
              ×
            </button>
          </div>
          {/* 次ループ導線：最重要ファネル起点へワンタップ。 */}
          <a
            href="/catalog"
            className="mt-2 inline-flex items-center justify-center h-10 px-4 rounded-xl bg-[#2D323B] text-white text-[13px] font-bold active:bg-[#1A1D23]"
          >
            次の利益商品を見る →
          </a>
        </div>
      )}

      {/* 売切検知ワーカー(住宅IP)が停止中＝在庫チェックが遅れている時の降格バナー（出品中がある時だけ） */}
      {livenessStale && show.includes("live") && (live?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
          <p className="text-[11px] font-bold text-amber-700 leading-relaxed">
            <span className="whitespace-nowrap">⚠️ 在庫の自動チェックが</span><wbr />
            <span className="whitespace-nowrap">一時停止中。</span><wbr />
            <span className="whitespace-nowrap">売り切れ検知が遅れる場合あり。</span><wbr />
            <span className="font-normal text-amber-700/80">
              <span className="whitespace-nowrap">出品中は念のため</span><wbr />
              <span className="whitespace-nowrap">仕入れ先の在庫もご確認を。</span>
            </span>
          </p>
        </div>
      )}

      {/* プラン上限ナッジ：同時出品が上限の8割以上で表示。到達なら強め＋アップグレード導線。 */}
      {show.includes("live") && planInfo?.limit != null && planInfo.liveCount / planInfo.limit >= 0.8 && (
        <div className={`rounded-xl border px-4 py-3 ${planInfo.liveCount >= planInfo.limit ? "border-amber-300 bg-amber-50" : "border-[#A98B5C]/30 bg-[#A98B5C]/5"}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] font-bold text-gray-800">
                同時出品 {planInfo.liveCount} / {planInfo.limit}件（{planInfo.planName}）
              </p>
              <p className="text-[11px] text-gray-600 mt-0.5">
                {planInfo.liveCount >= planInfo.limit ? (
                  <>
                    <span className="whitespace-nowrap">上限に到達。</span><wbr />
                    <span className="whitespace-nowrap">もっと出すなら</span><wbr />
                    <span className="whitespace-nowrap">アップグレードを。</span>
                  </>
                ) : (
                  "上限が近づいています。"
                )}
              </p>
            </div>
            <a href="/pricing" className="shrink-0 inline-flex items-center h-9 px-3 rounded-lg bg-[#2D323B] text-white text-[12px] font-bold active:bg-[#1A1D23]">
              アップグレード
            </a>
          </div>
        </div>
      )}

      {/* 出品中の商品（0件でも表示） */}
      {show.includes("live") && (
      <Section title="出品中の商品" count={live.length} open={openLive} onToggle={() => setOpenLive((v) => !v)}>
        {live.length === 0 ? (
          <div className="py-1.5">
            <EmptyNote>
              <span className="whitespace-nowrap">出品中の商品はまだありません。</span><wbr />
              <span className="whitespace-nowrap">商品を選んで「eBayに出品」すると</span><wbr />
              <span className="whitespace-nowrap">ここに並びます。</span>
            </EmptyNote>
            {/* 行き止まりにしない：初出品=最重要ファネル起点へワンタップで戻す。 */}
            <a href="/catalog" className="mt-2 inline-flex items-center justify-center h-10 px-4 rounded-xl bg-[#2D323B] text-white text-[13px] font-bold active:bg-[#1A1D23]">
              利益商品を見る →
            </a>
          </div>
        ) : (
          <>
            <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
              <span className="whitespace-nowrap">📸 自動の写真は最大3枚。</span><wbr />
              <b className="text-gray-600"><span className="whitespace-nowrap">実物の写真を足すと</span><wbr /><span className="whitespace-nowrap">売れやすい</span></b>
              <span className="whitespace-nowrap">（「編集」から追加）。</span><wbr />
              <span className="whitespace-nowrap">価格・数量や、</span><wbr />
              <span className="whitespace-nowrap">やめた・売れたの調整も</span><wbr />
              <span className="whitespace-nowrap">ここから。</span>
            </p>
            <ul className="divide-y divide-gray-100">
              {live.map((d) => (
                <li key={d.id} className="py-1.5">
                  {soldFor === d.id ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] text-gray-600 truncate max-w-[45%]">{d.title || "（無題）"}</span>
                        <span className="text-[11px] text-gray-500">売れた金額</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={soldJpy}
                          onChange={(e) => setSoldJpy(e.target.value)}
                          placeholder="円"
                          className="w-20 h-7 px-2 rounded-lg border border-[#A98B5C]/35 text-[12px] focus:outline-none focus:border-[#2D323B]"
                        />
                        <button
                          disabled={busy === d.id || !(Number(soldJpy) > 0)}
                          onClick={() => act(d.id, "sold", { soldJpy: Number(soldJpy) })}
                          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold disabled:opacity-40"
                        >
                          {busy === d.id && <Spinner size={11} />} 記録
                        </button>
                        <button onClick={() => { setSoldFor(null); setSoldJpy(""); }} className="h-7 px-1.5 text-[11px] text-gray-400">
                          取消
                        </button>
                      </div>
                      {/* 記録失敗時は無言にせず行内に赤文字で理由を出す。 */}
                      {actErr[d.id] && <p className="text-[10px] text-red-600 leading-tight pl-0.5">{actErr[d.id]}</p>}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Thumb url={d.imageUrl} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] text-gray-700 truncate leading-tight">{d.title || "（無題の商品）"}</p>
                          <p className="text-[10px] text-gray-400 leading-tight mt-0.5">
                            {shortDate(d.listedAt) && `${shortDate(d.listedAt)}・`}仕入れ {yen(d.purchase)}
                          </p>
                          {d.sourceStatus && (
                            <p className="text-[10px] font-bold leading-tight mt-0.5 text-red-600">
                              <span className="whitespace-nowrap">⚠️ 仕入れ先で{d.sourceStatus === "dead" ? "リンク切れ" : "売り切れ"}</span><wbr />
                              <span className="whitespace-nowrap">（仕入れできません）。</span><wbr />
                              <span className="whitespace-nowrap">出品を停止しましょう。</span>
                            </p>
                          )}
                          {!d.sourceStatus && d.priceDrift && (
                            <p className="text-[10px] font-bold leading-tight mt-0.5 text-amber-600">
                              <span className="whitespace-nowrap">⚠️ 仕入れ値が高騰</span><wbr />
                              <span className="whitespace-nowrap">（出品時+{Math.round(d.priceDrift.pct * 100)}%）</span><wbr />
                              <span className="whitespace-nowrap">赤字注意</span>
                            </p>
                          )}
                          {(d.stopFailedCount ?? 0) >= 3 && (
                            <p className="text-[10px] font-bold leading-tight mt-0.5 text-red-600">
                              <span className="whitespace-nowrap">⚠️ 自動の出品停止に失敗。</span><wbr />
                              <span className="whitespace-nowrap">欠品販売を防ぐため</span><wbr />
                              <span className="whitespace-nowrap">
                                {d.listingId ? (
                                  <a href={`https://www.ebay.com/itm/${d.listingId}`} target="_blank" rel="noopener noreferrer" className="underline">eBayで手動取り下げ</a>
                                ) : (
                                  "eBayで手動取り下げ"
                                )}
                                を。
                              </span>
                            </p>
                          )}
                        </div>
                      </div>
                      {/* 仕入れ先が消えた（リンク切れ/売り切れ）出品は「次の一手＝出品停止」を主CTA(赤)に強調し、
                          追加仕入れは控えめにする（押しても仕入れできないため）。それ以外は従来どおりの2×2。 */}
                      {d.sourceStatus ? (
                        <div className="space-y-1.5">
                          {/* 主CTA：出品停止（赤・全幅）。欠品販売を防ぐ次の一手を最優先に。 */}
                          <button
                            disabled={busy === d.id}
                            onClick={() => stopListing(d.id)}
                            className="w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-lg bg-red-600 text-white text-[12px] font-bold disabled:opacity-40 active:bg-red-700"
                          >
                            {busy === d.id ? <Spinner size={13} /> : <Ban size={14} className="shrink-0" />} <span className="whitespace-nowrap">この出品を停止する</span>
                          </button>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              disabled={busy === d.id}
                              onClick={() => { setSoldFor(d.id); setSoldJpy(""); }}
                              className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] font-bold disabled:opacity-40 active:bg-emerald-100"
                            >
                              ✓ 売れた
                            </button>
                            <button
                              onClick={() => setEditDeal(d)}
                              className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-[11px] font-bold active:bg-blue-100"
                            >
                              <Pencil size={13} /> 商品の編集
                            </button>
                          </div>
                          {/* 追加仕入れは控えめ（仕入れできない状態なので弱める）。在庫が戻った場合の確認用に残す。 */}
                          <a
                            href={toRakutenProductUrl(d.sourceUrl || `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(d.title || "")}/`)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full inline-flex items-center justify-center gap-1.5 h-8 rounded-lg border border-[#A98B5C]/35 text-gray-500 text-[10px] font-bold active:bg-gray-50"
                          >
                            <ShoppingCart size={12} className="shrink-0" /> <span className="whitespace-nowrap">仕入れ先を確認（在庫が戻ったら）</span>
                          </a>
                        </div>
                      ) : (
                      /* 出品中の操作は2×2に最適化：追加仕入れ／出品停止・売れた／商品の編集。
                         再出品は出品中では不要(=既に出品中)・「やめた」は出品停止に集約して整理（停止品は記録を残したまま後で「過去の出品」へ）。 */
                      <div className="grid grid-cols-2 gap-1.5">
                        {/* 追加仕入れ：楽天の「その商品ページ」へ直行（売れたら仕入れて発送／在庫の買い増し）。
                            sourceUrl はカタログから補完した楽天直リンク。失効/旧dealで無いときだけ商品名検索にフォールバック。 */}
                        <a
                          href={toRakutenProductUrl(d.sourceUrl || `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(d.title || "")}/`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-[#BF0000] text-white text-[11px] font-bold active:bg-[#9E0000]"
                        >
                          <ShoppingCart size={13} /> 追加仕入れ
                        </a>
                        <button
                          disabled={busy === d.id}
                          onClick={() => stopListing(d.id)}
                          className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-[#2D323B]/30 text-[#2D323B] text-[11px] font-bold disabled:opacity-40 active:bg-red-50"
                        >
                          {busy === d.id ? <Spinner size={12} /> : <Ban size={13} />} 出品停止
                        </button>
                        <button
                          disabled={busy === d.id}
                          onClick={() => { setSoldFor(d.id); setSoldJpy(""); }}
                          className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] font-bold disabled:opacity-40 active:bg-emerald-100"
                        >
                          ✓ 売れた
                        </button>
                        <button
                          onClick={() => setEditDeal(d)}
                          className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-[11px] font-bold active:bg-blue-100"
                        >
                          <Pencil size={13} /> 商品の編集
                        </button>
                      </div>
                      )}
                      {/* 最適化：タイトル・説明・Item Specifics を「返品されにくい」テンプレに自動で整える（無料・何度押しても課金なし）。 */}
                      {optimizedIds.has(d.id) ? (
                        <button
                          disabled
                          className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-[#A98B5C]/30 bg-gray-50 text-gray-400 text-[11px] font-bold cursor-default"
                        >
                          <Sparkles size={13} /> 最適化済み
                        </button>
                      ) : (
                        <button
                          disabled={optBusy === d.id}
                          onClick={() => optimize(d.id)}
                          className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-[#A98B5C]/40 bg-[#A98B5C]/10 text-[#7A6336] text-[11px] font-bold disabled:opacity-40 active:bg-[#A98B5C]/20"
                        >
                          {optBusy === d.id ? <><Spinner size={12} /> 最適化中…</> : <><Sparkles size={13} /> 最適化（返品されにくく）</>}
                        </button>
                      )}
                      {optErr[d.id] && <p className="text-[10px] text-red-600 leading-tight">{optErr[d.id]}</p>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
      )}

      {/* 出品停止中の商品（0件でも表示） */}
      {show.includes("stopped") && (
      <Section title="出品停止中の商品" count={stopped.length} open={openStopped} onToggle={() => setOpenStopped((v) => !v)}>
        {stopped.length === 0 ? (
          <EmptyNote>
            <span className="whitespace-nowrap">出品停止中の商品はありません。</span><wbr />
            <span className="whitespace-nowrap">「出品停止」した商品が</span><wbr />
            <span className="whitespace-nowrap">ここに入ります。</span>
          </EmptyNote>
        ) : (
          <>
            <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
              <span className="whitespace-nowrap">「出品停止」したeBay出品。</span><wbr />
              <span className="whitespace-nowrap"><b className="text-gray-600">再出品</b>でまた</span><wbr />
              <span className="whitespace-nowrap">eBayに公開できます。</span><wbr />
              <span className="whitespace-nowrap">停止のまま少し経つと</span><wbr />
              <span className="whitespace-nowrap">「過去の出品」へ静かに移動します</span><wbr />
              <span className="whitespace-nowrap">（<b className="text-gray-600">記録は残ります</b>・</span><wbr />
              <span className="whitespace-nowrap">いつでも再出品OK）。</span>
            </p>
            <ul className="divide-y divide-gray-100">
              {stopped.map((d) => (
                <li key={d.id} className="py-1.5">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Thumb url={d.imageUrl} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-gray-700 truncate leading-tight">{d.title || "（無題の商品）"}</p>
                        <p className="text-[10px] text-gray-400 leading-tight mt-0.5">
                          {shortDate(d.stoppedAt || "") && `${shortDate(d.stoppedAt || "")} 停止・`}仕入れ {yen(d.purchase)}
                        </p>
                        {d.sourceStatus && (
                          <p className={`text-[10px] font-bold leading-tight mt-0.5 ${d.sourceStatus === "dead" ? "text-[#2D323B]" : "text-amber-600"}`}>
                            <span className="whitespace-nowrap">⚠️ 仕入れ先で{d.sourceStatus === "dead" ? "リンク切れ" : "売り切れ"}</span><wbr /><span className="whitespace-nowrap">→自動停止</span>
                          </p>
                        )}
                      </div>
                    </div>
                    {/* 主CTA＝再出品（全幅・44px）。停止中の次の一手は「またeBayに出す」なので最優先に。
                        削除は記録ごと消える破壊的操作なので、控えめなテキストリンクへ降格。 */}
                    <div className="space-y-1.5">
                      <button
                        disabled={relistBusy === d.id}
                        onClick={() => relist(d.id)}
                        className="w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 text-white text-[12px] font-bold disabled:opacity-40 active:scale-[0.99]"
                      >
                        {relistBusy === d.id ? <><Spinner size={13} /> 準備中…</> : <><RotateCw size={14} /> もう一度出品する</>}
                      </button>
                      <div className="flex justify-end">
                        <button
                          disabled={busy === d.id}
                          onClick={() => { if (window.confirm("この商品を完全に削除しますか？（記録・成績からも外れます。元に戻せません）")) act(d.id, "remove"); }}
                          className="inline-flex items-center gap-1 h-8 px-2 text-[10px] text-gray-400 font-bold disabled:opacity-40 active:text-gray-600"
                        >
                          {busy === d.id && <Spinner size={11} />} 記録ごと削除
                        </button>
                      </div>
                    </div>
                    {/* 削除失敗時は無言にせず行内に赤文字で理由を出す。 */}
                    {actErr[d.id] && <p className="text-[10px] text-red-600 leading-tight">{actErr[d.id]}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
      )}

      {/* 過去の出品（アーカイブ）：停止のまま24時間を過ぎて既定の停止中一覧から外した分。
          レコード・成績は保持＝いつでも「再出品」で復帰できる。クリーンに保つため、ある時だけ・既定は折りたたみで表示。 */}
      {show.includes("stopped") && archived.length > 0 && (
      <Section title="過去の出品" count={archived.length} open={openArchived} onToggle={() => setOpenArchived((v) => !v)}>
        <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
          <span className="whitespace-nowrap">少し前に停止した出品を</span><wbr />
          <span className="whitespace-nowrap">ここに保管しています</span><wbr />
          <span className="whitespace-nowrap">（記録は残ったまま）。</span><wbr />
          <span className="whitespace-nowrap"><b className="text-gray-600">再出品</b>でまた</span><wbr />
          <span className="whitespace-nowrap">eBayに公開できます。</span>
        </p>
        <ul className="divide-y divide-gray-100">
          {archived.map((d) => (
            <li key={d.id} className="py-1.5">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Thumb url={d.imageUrl} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-gray-700 truncate leading-tight">{d.title || "（無題の商品）"}</p>
                    <p className="text-[10px] text-gray-400 leading-tight mt-0.5">
                      {shortDate(d.archivedAt || d.stoppedAt || "") && `${shortDate(d.archivedAt || d.stoppedAt || "")} 保管・`}仕入れ {yen(d.purchase)}
                    </p>
                    {d.sourceStatus && (
                      <p className={`text-[10px] font-bold leading-tight mt-0.5 ${d.sourceStatus === "dead" ? "text-[#2D323B]" : "text-amber-600"}`}>
                        <span className="whitespace-nowrap">⚠️ 仕入れ先で{d.sourceStatus === "dead" ? "リンク切れ" : "売り切れ"}</span><wbr /><span className="whitespace-nowrap">→自動停止</span>
                      </p>
                    )}
                  </div>
                </div>
                <button
                  disabled={relistBusy === d.id}
                  onClick={() => relist(d.id)}
                  className="w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 text-white text-[12px] font-bold disabled:opacity-40 active:scale-[0.99]"
                >
                  {relistBusy === d.id ? <><Spinner size={13} /> 準備中…</> : <><RotateCw size={14} /> もう一度出品する</>}
                </button>
                <div className="flex justify-end">
                  <button
                    disabled={busy === d.id}
                    onClick={() => { if (window.confirm("この商品を完全に削除しますか？（記録・成績からも外れます。元に戻せません）")) act(d.id, "remove"); }}
                    className="inline-flex items-center gap-1 h-8 px-2 text-[10px] text-gray-400 font-bold disabled:opacity-40 active:text-gray-600"
                  >
                    {busy === d.id && <Spinner size={11} />} 記録ごと削除
                  </button>
                </div>
              </div>
              {actErr[d.id] && <p className="text-[10px] text-red-600 leading-tight">{actErr[d.id]}</p>}
            </li>
          ))}
        </ul>
      </Section>
      )}

      {/* 輸出した商品（売れた・0件でも表示） */}
      {show.includes("sold") && (
      <Section title="輸出した商品" count={sold.length} open={openSold} onToggle={() => setOpenSold((v) => !v)}>
        {sold.length === 0 ? (
          <EmptyNote>
            <span className="whitespace-nowrap">売れた商品はまだありません。</span><wbr />
            <span className="whitespace-nowrap">売れると利益とともに</span><wbr />
            <span className="whitespace-nowrap">ここに記録されます。</span>
          </EmptyNote>
        ) : (
          <>
            <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
              <span className="whitespace-nowrap">売れた（輸出できた）商品の履歴</span><wbr />
              <span className="whitespace-nowrap">（過去2年分）。</span>
            </p>
            <ul className="divide-y divide-gray-100">
              {sold.map((d) => (
                <li key={d.id} className="py-1.5 flex items-center gap-2">
                  <Thumb url={d.imageUrl} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-gray-700 truncate leading-tight">{d.title || "（無題の商品）"}</p>
                    <p className="text-[10px] text-gray-400 leading-tight mt-0.5">
                      {shortDate(d.soldAt) && `${shortDate(d.soldAt)} 輸出・`}売値 {yen(d.soldJpy)}
                    </p>
                  </div>
                  <span className={`text-[12px] font-black tabular-nums shrink-0 ${d.profitJpy < 0 ? "text-[#2D323B]" : "text-emerald-600"}`}>
                    {signedYen(d.profitJpy)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
      )}

      {/* 再出品：既存の出品モーダルをそのまま再利用（価格・説明・写真を作り直す）。 */}
      {relistProduct && (
        <EbayListingModal
          product={relistProduct}
          onClose={() => { setRelistProduct(null); load(); onChanged?.(); }}
          onListed={() => { load(); onChanged?.(); }}
        />
      )}

      {/* アプリ内編集（価格・数量・実物写真）：eBay.comを開かずに直す＝出品の管理が外れる原因を作らない。 */}
      {editDeal && (
        <EditListingModal
          productId={editDeal.id}
          title={editDeal.title}
          onClose={() => setEditDeal(null)}
          onSaved={() => { load(); onChanged?.(); }}
        />
      )}
    </div>
  );
}
