"use client";
import { useEffect, useState } from "react";
import { Package, ChevronDown, ChevronUp, Pencil, RotateCw, Ban, ShoppingCart } from "lucide-react";
import { ProfitProduct } from "../lib/profitFilter";
import { toRakutenAffiliateUrl } from "../lib/utils";
import EbayListingModal from "./EbayListingModal";
import EditListingModal from "./EditListingModal";
import Spinner from "./Spinner";

interface LiveDeal { id: string; title: string; listedAt: string; purchase: number; imageUrl: string; sourceUrl?: string; listingId?: string; stoppedAt?: string; sourceStatus?: "dead" | "soldout"; priceDrift?: { nowJpy: number; pct: number; at: string }; stopFailedCount?: number }
interface SoldDeal { id: string; title: string; imageUrl: string; soldAt: string; soldJpy: number; profitJpy: number; purchase: number }

const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");
const signedYen = (n: number) => (n < 0 ? "−" : "+") + "¥" + Math.round(Math.abs(n)).toLocaleString("ja-JP");
const shortDate = (iso: string) => {
  const d = (iso || "").slice(0, 10);
  const m = d.slice(5, 7), day = d.slice(8, 10);
  return m && day ? `${Number(m)}/${Number(day)}` : "";
};
// 出品停止中の自動削除（停止から24時間）までの残り時間（時間単位・切り上げ）。不正な日時は null。
const hoursToAutoDelete = (stoppedAt?: string) => {
  if (!stoppedAt) return null;
  const ms = 24 * 60 * 60 * 1000 - (Date.now() - Date.parse(stoppedAt));
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil(ms / (60 * 60 * 1000)));
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

function EmptyNote({ text }: { text: string }) {
  return <p className="text-[11px] text-gray-400 py-1.5 leading-relaxed">{text}</p>;
}

// マイページの一覧は「出品中／出品停止中／輸出した（売れた）」の3つだけ。0件でも常に表示する。
// 出品をやめた → 成績から外す／実は売れていた → 売れた金額(円)で記録（→輸出した側へ移動）。
export type ListingSection = "live" | "stopped" | "sold";
// show: 表示するセクションを選べる（出品管理タブ=live+stopped／発送タブ=sold）。既定は全部。
export default function MyListings({ onChanged, show = ["live", "stopped", "sold"] }: { onChanged?: () => void; show?: ListingSection[] }) {
  const [live, setLive] = useState<LiveDeal[] | null>(null);
  const [stopped, setStopped] = useState<LiveDeal[] | null>(null);
  const [sold, setSold] = useState<SoldDeal[] | null>(null);
  const [openLive, setOpenLive] = useState(show.includes("live"));
  const [openStopped, setOpenStopped] = useState(false);
  const [openSold, setOpenSold] = useState(show.includes("sold"));
  const [busy, setBusy] = useState<string | null>(null);
  const [soldFor, setSoldFor] = useState<string | null>(null); // 売れた金額を入力中の商品
  const [soldJpy, setSoldJpy] = useState("");
  const [relistProduct, setRelistProduct] = useState<ProfitProduct | null>(null); // 再出品モーダルで開く商品
  const [relistBusy, setRelistBusy] = useState<string | null>(null); // 再出品の商品データ取得中
  const [editDeal, setEditDeal] = useState<LiveDeal | null>(null); // アプリ内編集（価格・数量）モーダルで開く出品
  const [livenessStale, setLivenessStale] = useState(false); // 売切検知ワーカー(住宅IP)が停止中＝在庫チェックが遅れている

  // 「再出品」：現行カタログ/アーカイブから同じ商品を取り出して、出品モーダルを開き直す（既存の出品フローを再利用）。
  const relist = async (productId: string) => {
    setRelistBusy(productId);
    try {
      const j = await fetch(`/api/ebay/product?id=${encodeURIComponent(productId)}`, { cache: "no-store" }).then((r) => r.json());
      if (j?.ok && j.product) setRelistProduct(j.product as ProfitProduct);
      else window.alert("この商品の情報が見つかりませんでした。時間をおいて、もう一度お試しください。");
    } catch {
      window.alert("出品の準備に失敗しました。通信環境を確認してもう一度お試しください。");
    }
    setRelistBusy(null);
  };

  const load = () =>
    fetch("/api/ebay/deals", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { setLive(j.ok ? j.live : []); setStopped(j.ok ? (j.stopped ?? []) : []); setSold(j.ok ? j.sold : []); })
      .catch(() => { setLive([]); setStopped([]); setSold([]); });
  useEffect(() => { load(); }, []);
  // 売切検知ワーカー(住宅IP)の鮮度を確認。停止中(stale)なら在庫チェックが遅れている＝降格表示する。
  useEffect(() => {
    fetch("/api/ops/liveness", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setLivenessStale(j?.fresh === false))
      .catch(() => {});
  }, []);

  // 「出品停止」：eBayの出品(オファー)を取り下げて終了し、出品停止中一覧へ移す。
  const stopListing = async (productId: string) => {
    if (!window.confirm("この商品のeBay出品を停止しますか？（eBayの出品を終了します。あとで再出品できます）")) return;
    setBusy(productId);
    try {
      const j = await fetch("/api/ebay/list/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      }).then((r) => r.json());
      if (j.ok) {
        if (j.ended === false) window.alert("この商品は現在eBayに出品されていません。");
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
    try {
      const res = await fetch("/api/ebay/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, productId, ...extra }),
      }).then((r) => r.json());
      if (res.ok) {
        setSoldFor(null);
        setSoldJpy("");
        await load(); // 各リストを取り直す（売れた商品は輸出した側へ移動）
        onChanged?.(); // 親(マイページ)の集計も更新
      }
    } catch {
      /* noop */
    }
    setBusy(null);
  };

  if (live === null || stopped === null || sold === null) return null; // 読み込み中

  return (
    <div className="space-y-3">
      {/* 売切検知ワーカー(住宅IP)が停止中＝在庫チェックが遅れている時の降格バナー（出品中がある時だけ） */}
      {livenessStale && show.includes("live") && (live?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
          <p className="text-[11px] font-bold text-amber-700 leading-relaxed">
            ⚠️ 在庫の自動チェックが一時停止中です。仕入れ元（楽天）の売り切れ検知が遅れる場合があります。
            <span className="font-normal text-amber-700/80">出品中の商品は、念のため楽天側の在庫もご確認ください。</span>
          </p>
        </div>
      )}

      {/* 出品中の商品（0件でも表示） */}
      {show.includes("live") && (
      <Section title="出品中の商品" count={live.length} open={openLive} onToggle={() => setOpenLive((v) => !v)}>
        {live.length === 0 ? (
          <EmptyNote text="まだ出品中の商品はありません。商品を選んで「eBayに出品」すると、ここに並びます。" />
        ) : (
          <>
            <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
              📸 自動の写真は最大3枚です。<b className="text-gray-600">実物の写真を足すと売れやすく</b>なります（「編集」から追加）。価格・数量の変更や、やめた・売れたの調整もここから。
            </p>
            <ul className="divide-y divide-gray-100">
              {live.map((d) => (
                <li key={d.id} className="py-1.5">
                  {soldFor === d.id ? (
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
                            <p className={`text-[10px] font-bold leading-tight mt-0.5 ${d.sourceStatus === "dead" ? "text-[#2D323B]" : "text-amber-600"}`}>
                              ⚠️ 楽天で{d.sourceStatus === "dead" ? "リンク切れ（仕入れ不可）" : "売り切れ"}
                            </p>
                          )}
                          {!d.sourceStatus && d.priceDrift && (
                            <p className="text-[10px] font-bold leading-tight mt-0.5 text-amber-600">
                              ⚠️ 仕入れ値が高騰（出品時+{Math.round(d.priceDrift.pct * 100)}%）赤字注意
                            </p>
                          )}
                          {(d.stopFailedCount ?? 0) >= 3 && (
                            <p className="text-[10px] font-bold leading-tight mt-0.5 text-red-600">
                              ⚠️ 自動の出品停止に失敗しています。
                              {d.listingId ? (
                                <a href={`https://www.ebay.com/itm/${d.listingId}`} target="_blank" rel="noopener noreferrer" className="underline">eBayで手動取り下げ</a>
                              ) : (
                                "eBayで手動取り下げ"
                              )}
                              を行ってください（欠品販売の防止）。
                            </p>
                          )}
                        </div>
                      </div>
                      {/* 出品中の操作は2×2に最適化：追加仕入れ／出品停止・売れた／商品の編集。
                          再出品は出品中では不要(=既に出品中)・「やめた」は出品停止＋24h自動削除に集約して整理。 */}
                      <div className="grid grid-cols-2 gap-1.5">
                        {/* 追加仕入れ：楽天の「その商品ページ」へ直行（売れたら仕入れて発送／在庫の買い増し）。
                            sourceUrl はカタログから補完した楽天直リンク。失効/旧dealで無いときだけ商品名検索にフォールバック。 */}
                        <a
                          href={toRakutenAffiliateUrl(d.sourceUrl || `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(d.title || "")}/`)}
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
          <EmptyNote text="出品停止中の商品はありません。「出品停止」を押した商品がここに入ります。" />
        ) : (
          <>
            <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
              「出品停止」したeBay出品です。<b className="text-gray-600">再出品</b>でまたeBayに公開できます。
              <br />⏳ <b className="text-gray-600">停止から24時間で、この一覧から自動的に削除</b>されます（記録も外れます）。残したい場合は早めに再出品してください。
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
                        {hoursToAutoDelete(d.stoppedAt) !== null && (
                          <p className="text-[10px] text-gray-400 leading-tight mt-0.5">⏳ あと約{hoursToAutoDelete(d.stoppedAt)}時間で自動削除</p>
                        )}
                        {d.sourceStatus && (
                          <p className={`text-[10px] font-bold leading-tight mt-0.5 ${d.sourceStatus === "dead" ? "text-[#2D323B]" : "text-amber-600"}`}>
                            ⚠️ 楽天で{d.sourceStatus === "dead" ? "リンク切れ" : "売り切れ"}→自動停止
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap pl-11">
                      <button
                        disabled={relistBusy === d.id}
                        onClick={() => relist(d.id)}
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 text-white text-[10px] font-bold disabled:opacity-40 active:scale-[0.99]"
                      >
                        {relistBusy === d.id ? <><Spinner size={12} /> 準備中…</> : <><RotateCw size={12} /> 再出品</>}
                      </button>
                      <button
                        disabled={busy === d.id}
                        onClick={() => { if (window.confirm("この商品を一覧から削除しますか？（成績からも外れます）")) act(d.id, "remove"); }}
                        className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#A98B5C]/35 text-gray-500 text-[10px] font-bold disabled:opacity-40"
                      >
                        {busy === d.id && <Spinner size={11} />} 削除
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
      )}

      {/* 輸出した商品（売れた・0件でも表示） */}
      {show.includes("sold") && (
      <Section title="輸出した商品" count={sold.length} open={openSold} onToggle={() => setOpenSold((v) => !v)}>
        {sold.length === 0 ? (
          <EmptyNote text="まだ売れた商品はありません。売れると、利益とともにここに記録されます。" />
        ) : (
          <>
            <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">売れた（輸出できた）商品の履歴です（過去2年分）。</p>
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
