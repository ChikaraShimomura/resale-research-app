"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ProfitProduct } from "../lib/profitFilter";
import { formatJpy } from "../lib/utils";
import { track } from "../lib/analytics";
import EbaySellerGuide from "./EbaySellerGuide";
import { X, BadgeCheck, AlertTriangle, ExternalLink, Settings } from "lucide-react";

interface RequiredAspect { name: string; values: string[]; free: boolean; value: string }
interface ShippingChoice { fulfillmentPolicyId: string; name: string; costUsd: string }
interface PrepareData {
  product: { id: string; jaTitle: string; imageUrl: string; rakutenPrice: number; ebayAvgJpy: number };
  title: string;
  description: string;
  priceUsd: string;
  condition: string;
  category: { categoryId?: string; categoryName?: string; categoryTreeId: string } | null;
  requiredAspects: RequiredAspect[];
  shipping: ShippingChoice[];
}

// 送料ポリシー名を日本語ラベルに
function shippingLabel(name: string): string {
  if (/small/i.test(name)) return "小さい荷物";
  if (/medium/i.test(name)) return "中くらいの荷物";
  if (/large/i.test(name)) return "大きい荷物";
  return name;
}
interface PublishResult {
  ok: boolean;
  listingId?: string;
  error?: string;
  steps?: { step: string; ok: boolean; error?: string }[];
  needsSellerRegistration?: boolean;
}

type Phase = "loading" | "setup" | "form" | "publishing" | "done" | "draftsaved" | "error";

export default function EbayListingModal({
  product,
  onClose,
  onListed,
}: {
  product: ProfitProduct;
  onClose: () => void;
  onListed?: () => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<PrepareData | null>(null);
  const [title, setTitle] = useState(product.coreKeyword || product.title);
  const [description, setDescription] = useState("");
  const [priceUsd, setPriceUsd] = useState("");
  const [condition, setCondition] = useState("NEW");
  const [shippingId, setShippingId] = useState("");
  const [aspects, setAspects] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PublishResult | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const rd = await fetch("/api/ebay/listing-readiness", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({}));
      if (!alive) return;
      if (!rd.connected || !rd.ready) {
        setPhase("setup");
        return;
      }
      const p: PrepareData & { ok?: boolean; error?: string } = await fetch("/api/ebay/list/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      })
        .then((r) => r.json())
        .catch(() => ({ ok: false }));
      if (!alive) return;
      if (!p.ok) {
        setMsg(p.error || "出品準備に失敗しました。");
        setPhase("error");
        return;
      }
      setData(p);
      setTitle(p.title);
      setDescription(p.description);
      setPriceUsd(p.priceUsd);
      setCondition(p.condition);
      setShippingId(p.shipping?.[0]?.fulfillmentPolicyId ?? "");
      const a: Record<string, string> = {};
      p.requiredAspects.forEach((x) => (a[x.name] = x.value));
      setAspects(a);
      setPhase("form");
    })();
    return () => {
      alive = false;
    };
  }, [product.id]);

  // 背景のスクロールを止める（モーダル表示中）
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const publish = async () => {
    setPhase("publishing");
    setMsg("");
    const res: PublishResult = await fetch("/api/ebay/list/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: product.id,
        title,
        description,
        priceUsd,
        condition,
        categoryId: data?.category?.categoryId,
        aspects,
        fulfillmentPolicyId: shippingId,
      }),
    })
      .then((r) => r.json())
      .catch(() => ({ ok: false, error: "通信に失敗しました。" }));
    setResult(res);
    if (res.ok) {
      track("ebay_list_published", { product_id: product.id });
      setPhase("done");
      onListed?.();
    } else if (res.needsSellerRegistration) {
      setPhase("draftsaved");
    } else {
      setMsg(res.error || "出品に失敗しました。");
      setPhase("error");
    }
  };

  const canPublish = !!data?.category?.categoryId && Number(priceUsd) > 0;

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="eBay出品"
      className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[92dvh] overflow-y-auto"
      >
        {/* ヘッダー */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-black text-gray-800 flex items-center gap-1.5">
            <span className="inline-flex w-5 h-5 bg-[#0064D2] rounded-full items-center justify-center text-white font-black text-[10px]">e</span>
            eBayに出品
          </h2>
          <button onClick={onClose} aria-label="閉じる" className="text-gray-400 active:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-4">
          {phase === "loading" && (
            <div className="py-10 text-center text-sm text-gray-400">出品情報を準備中...</div>
          )}

          {phase === "setup" && (
            <div className="py-6 text-center">
              <AlertTriangle size={36} className="mx-auto mb-3 text-amber-400" />
              <p className="text-sm font-bold text-gray-800 mb-1">出品の準備が未完了です</p>
              <p className="text-xs text-gray-500 mb-5 leading-relaxed">
                eBayのセラー登録・連携・ポリシー・発送元のいずれかが未完了です。<br />設定画面で順番に進めてください。
              </p>
              <button
                onClick={() => router.push(`/settings?list=${encodeURIComponent(product.id)}`)}
                className="inline-flex items-center gap-1.5 h-11 px-6 bg-[#BF0000] text-white font-bold text-sm rounded-xl active:bg-[#9E0000]"
              >
                <Settings size={16} /> 設定へ進む
              </button>
            </div>
          )}

          {phase === "form" && data && (
            <div className="space-y-3.5">
              {/* 在庫を持っているかの確認 */}
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 leading-relaxed">
                先に楽天で<b>仕入れて</b>から出品してね（無在庫はトラブルのもと）。
              </p>

              {/* 商品画像（楽天） */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">商品画像（楽天の画像を使用）</label>
                <div className="flex items-center gap-3">
                  {data.product.imageUrl ? (
                    <img src={data.product.imageUrl} alt="" className="w-20 h-20 object-cover rounded-xl border border-gray-100" />
                  ) : (
                    <div className="w-20 h-20 rounded-xl bg-gray-100" />
                  )}
                  <p className="text-[10px] text-gray-400 leading-relaxed flex-1">
                    この画像でeBayに出品します。<br />権利が気になる商品は、後でeBay側で自分の写真に差し替えると安心です。
                  </p>
                </div>
              </div>

              {/* タイトル（英語・編集可） */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">タイトル（英語）</label>
                <textarea
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, 80))}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#BF0000] resize-none"
                />
                <p className="text-[10px] text-gray-400 mt-0.5">{title.length}/80　自動で英語タイトルを入れています（編集OK）</p>
              </div>

              {/* 説明文（英語・編集可） */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">説明文（英語）</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#BF0000] resize-none leading-relaxed"
                />
              </div>

              {/* 状態 */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">商品の状態</label>
                <select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-[#BF0000]"
                >
                  <option value="NEW">新品（New）</option>
                  <option value="USED_EXCELLENT">中古 - 非常に良い</option>
                  <option value="USED_GOOD">中古 - 良い</option>
                </select>
              </div>

              {/* 価格 */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">販売価格（USD）</label>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-sm">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={priceUsd}
                    onChange={(e) => setPriceUsd(e.target.value)}
                    className="flex-1 h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#BF0000]"
                  />
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">eBay相場の目安：{formatJpy(data.product.ebayAvgJpy)}（≒ 上記USD）</p>
              </div>

              {/* 送料サイズ */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">送料（荷物のサイズ）</label>
                {data.shipping.length > 0 ? (
                  <select
                    value={shippingId}
                    onChange={(e) => setShippingId(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-[#BF0000]"
                  >
                    {data.shipping.map((s) => (
                      <option key={s.fulfillmentPolicyId} value={s.fulfillmentPolicyId}>
                        {shippingLabel(s.name)}（送料 ${s.costUsd}）
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-[12px] text-[#BF0000] bg-red-50 rounded-xl px-3 py-2">
                    配送ポリシーが見つかりません。設定で「発送設定」を完了してください。
                  </p>
                )}
                <p className="text-[10px] text-gray-400 mt-0.5">送料は購入者負担（国際発送・一律）です</p>
              </div>

              {/* カテゴリ */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">eBayカテゴリ（自動判定）</label>
                {data.category?.categoryId ? (
                  <p className="text-[13px] font-bold text-gray-800 bg-[#F5F7FA] rounded-xl px-3 py-2">
                    {data.category.categoryName}
                  </p>
                ) : (
                  <p className="text-[12px] text-[#BF0000] bg-red-50 rounded-xl px-3 py-2">
                    カテゴリを自動判定できませんでした。タイトルを具体的にして開き直すか、時間をおいて再度お試しください。
                  </p>
                )}
              </div>

              {/* 必須Item Specifics */}
              {data.requiredAspects.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-[11px] text-gray-500">必須の商品情報</label>
                  {data.requiredAspects.map((a) => (
                    <div key={a.name}>
                      <span className="block text-[10px] text-gray-400 mb-0.5">{a.name}</span>
                      {!a.free && a.values.length > 0 ? (
                        <select
                          value={aspects[a.name] ?? ""}
                          onChange={(e) => setAspects((s) => ({ ...s, [a.name]: e.target.value }))}
                          className="w-full h-9 px-2.5 rounded-lg border border-gray-200 text-[13px] bg-white focus:outline-none focus:border-[#BF0000]"
                        >
                          <option value="">選択してください</option>
                          {a.values.map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={aspects[a.name] ?? ""}
                          onChange={(e) => setAspects((s) => ({ ...s, [a.name]: e.target.value }))}
                          className="w-full h-9 px-2.5 rounded-lg border border-gray-200 text-[13px] focus:outline-none focus:border-[#BF0000]"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* 出品ボタン */}
              <button
                onClick={publish}
                disabled={!canPublish}
                className="w-full h-12 bg-[#0064D2] text-white font-bold text-sm rounded-xl active:bg-[#0053AE] disabled:opacity-40"
              >
                この内容でeBayに出品する
              </button>
            </div>
          )}

          {phase === "publishing" && (
            <div className="py-10 text-center text-sm text-gray-500">eBayに出品中...（10〜20秒ほど）</div>
          )}

          {phase === "done" && (
            <div className="py-6 text-center">
              <BadgeCheck size={40} className="mx-auto mb-3 text-emerald-500" />
              <p className="text-sm font-black text-gray-800 mb-1">eBayに出品しました！</p>
              <p className="text-xs text-gray-500 mb-5">売れたら自動で検知して、この一覧の下の方に移動します。</p>
              {result?.listingId && (
                <a
                  href={`https://www.ebay.com/itm/${result.listingId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 h-10 px-5 border border-[#0064D2] text-[#0064D2] font-bold text-sm rounded-xl active:bg-blue-50 mb-2"
                >
                  出品ページを見る <ExternalLink size={14} />
                </a>
              )}
              <div>
                <button onClick={onClose} className="mt-2 text-sm font-bold text-gray-500">閉じる</button>
              </div>
            </div>
          )}

          {phase === "draftsaved" && (
            <div className="py-4">
              <div className="text-center">
                <BadgeCheck size={40} className="mx-auto mb-3 text-emerald-500" />
                <p className="text-sm font-black text-gray-800 mb-1">出品内容は準備できました！あと1ステップ</p>
                <p className="text-xs text-gray-500 mb-3 leading-relaxed">
                  公開には、<b className="text-gray-700">初回だけ必要なeBayのセラー登録（売上の受け取り設定）</b>が必要です。
                </p>
                <p className="text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2.5 mb-3 leading-relaxed">
                  登録は<b>初めての1回だけ</b>。終わったら、もう一度「出品する」を押せば<b>公開</b>されます。
                </p>
                <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 mb-4 leading-relaxed text-left">
                  ※ 登録前の出品は、eBayの「下書き」一覧には<b>表示されません</b>（eBayの仕様）。登録後にこのアプリから公開すると「出品中」に出ます。探さなくて大丈夫です。
                </p>
                <a
                  href="https://www.ebay.com/sl/sell"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 h-11 px-6 bg-[#0064D2] text-white font-bold text-sm rounded-xl active:bg-[#0053AE]"
                >
                  eBayでセラー登録する
                </a>
              </div>
              <EbaySellerGuide />
              <div className="text-center mt-3">
                <button onClick={onClose} className="text-sm font-bold text-gray-500">あとで</button>
              </div>
            </div>
          )}

          {phase === "error" && (
            <div className="py-6">
              <AlertTriangle size={36} className="mx-auto mb-3 text-[#BF0000]" />
              <p className="text-sm font-bold text-gray-800 text-center mb-2">出品できませんでした</p>
              <p className="text-[12px] text-[#BF0000] text-center mb-3 leading-relaxed break-words">{msg}</p>
              {result?.steps && result.steps.length > 0 && (
                <ul className="mb-4 space-y-1 bg-gray-50 rounded-xl p-3">
                  {result.steps.map((s, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[12px]">
                      {s.ok ? <BadgeCheck size={14} className="text-emerald-600 shrink-0 mt-0.5" /> : <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />}
                      <span className="text-gray-600">{s.step}{!s.ok && s.error ? `：${s.error}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <button onClick={() => { setPhase("form"); setResult(null); }} className="flex-1 h-11 border border-gray-200 rounded-xl text-sm font-bold text-gray-600">
                  入力に戻る
                </button>
                <button onClick={onClose} className="flex-1 h-11 bg-gray-100 rounded-xl text-sm font-bold text-gray-600">
                  閉じる
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}
