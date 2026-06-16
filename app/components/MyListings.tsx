"use client";
import { useEffect, useState } from "react";
import { Package, ChevronDown, ChevronUp } from "lucide-react";

interface LiveDeal { id: string; title: string; listedAt: string; purchase: number; imageUrl: string }
interface SoldDeal { id: string; title: string; imageUrl: string; soldAt: string; soldJpy: number; profitJpy: number; purchase: number }

const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");
const signedYen = (n: number) => (n < 0 ? "−" : "+") + "¥" + Math.round(Math.abs(n)).toLocaleString("ja-JP");
const shortDate = (iso: string) => {
  const d = (iso || "").slice(0, 10);
  const m = d.slice(5, 7), day = d.slice(8, 10);
  return m && day ? `${Number(m)}/${Number(day)}` : "";
};

function Thumb({ url }: { url: string }) {
  if (url) return <img src={url} alt="" loading="lazy" className="w-9 h-9 rounded-md object-cover bg-gray-50 border border-gray-100 shrink-0" />;
  return (
    <div className="w-9 h-9 rounded-md bg-gray-50 border border-gray-100 shrink-0 flex items-center justify-center text-gray-300">
      <Package size={16} />
    </div>
  );
}

// 開閉できるセクション（既定は閉じる）。ヘッダーに件数を出す。
function Section({ title, count, open, onToggle, children }: { title: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      <button onClick={onToggle} aria-expanded={open} className="w-full flex items-center justify-between px-4 py-3 active:bg-gray-50">
        <span className="text-[13px] font-black text-gray-800">{title}（{count}件）</span>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

// マイページの「出品中の商品」と「輸出した商品（売れた）」。どちらもクリックで開閉、既定は閉じる。
// 出品をやめた → 成績から外す／実は売れていた → 売れた金額(円)で記録（→輸出した側へ移動）。
export default function MyListings({ onChanged }: { onChanged?: () => void }) {
  const [live, setLive] = useState<LiveDeal[] | null>(null);
  const [sold, setSold] = useState<SoldDeal[] | null>(null);
  const [openLive, setOpenLive] = useState(false);
  const [openSold, setOpenSold] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [soldFor, setSoldFor] = useState<string | null>(null); // 売れた金額を入力中の商品
  const [soldJpy, setSoldJpy] = useState("");

  const load = () =>
    fetch("/api/ebay/deals", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        setLive(j.ok ? j.live : []);
        setSold(j.ok ? j.sold : []);
      })
      .catch(() => {
        setLive([]);
        setSold([]);
      });
  useEffect(() => { load(); }, []);

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
        await load(); // 両リストを取り直す（売れた商品は輸出した側へ移動）
        onChanged?.(); // 親(マイページ)の集計も更新
      }
    } catch {
      /* noop */
    }
    setBusy(null);
  };

  if (live === null || sold === null) return null; // 読み込み中
  const hasLive = live.length > 0;
  const hasSold = sold.length > 0;
  if (!hasLive && !hasSold) return null;

  return (
    <div className="space-y-3">
      {hasLive && (
        <Section title="出品中の商品" count={live.length} open={openLive} onToggle={() => setOpenLive((v) => !v)}>
          <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">出品をやめた・実は売れていた時は、ここで手動で調整できます。</p>
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
                      className="w-20 h-7 px-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-[#BF0000]"
                    />
                    <button
                      disabled={busy === d.id || !(Number(soldJpy) > 0)}
                      onClick={() => act(d.id, "sold", { soldJpy: Number(soldJpy) })}
                      className="h-7 px-2.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold disabled:opacity-40"
                    >
                      記録
                    </button>
                    <button onClick={() => { setSoldFor(null); setSoldJpy(""); }} className="h-7 px-1.5 text-[11px] text-gray-400">
                      取消
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Thumb url={d.imageUrl} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-gray-700 truncate leading-tight">{d.title || "（無題の商品）"}</p>
                      <p className="text-[10px] text-gray-400 leading-tight mt-0.5">
                        {shortDate(d.listedAt) && `${shortDate(d.listedAt)}・`}仕入れ {yen(d.purchase)}
                      </p>
                    </div>
                    <button
                      disabled={busy === d.id}
                      onClick={() => { setSoldFor(d.id); setSoldJpy(""); }}
                      className="h-7 px-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px] font-bold disabled:opacity-40 shrink-0"
                    >
                      売れた
                    </button>
                    <button
                      disabled={busy === d.id}
                      onClick={() => { if (window.confirm("この商品を「出品中」から外しますか？（成績の出品数から除きます）")) act(d.id, "remove"); }}
                      className="h-7 px-2 rounded-lg border border-gray-200 text-gray-500 text-[10px] font-bold disabled:opacity-40 shrink-0"
                    >
                      やめた
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {hasSold && (
        <Section title="輸出した商品" count={sold.length} open={openSold} onToggle={() => setOpenSold((v) => !v)}>
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
                <span className={`text-[12px] font-black tabular-nums shrink-0 ${d.profitJpy < 0 ? "text-[#BF0000]" : "text-emerald-600"}`}>
                  {signedYen(d.profitJpy)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
