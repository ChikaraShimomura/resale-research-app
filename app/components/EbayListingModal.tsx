"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ProfitProduct } from "../lib/profitFilter";
import { formatJpy } from "../lib/utils";
import { track, logEvent } from "../lib/analytics";
import EbaySellerGuide from "./EbaySellerGuide";
import { X, BadgeCheck, AlertTriangle, ExternalLink, Settings, Clock } from "lucide-react";

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
  if (/small/i.test(name)) return "小サイズ送料";
  if (/medium/i.test(name)) return "中サイズの送料";
  if (/large/i.test(name)) return "大サイズの送料";
  return name;
}
// 各サイズの目安（荷姿のイメージ）。プルダウンに併記する。
function shippingHint(name: string): string {
  if (/small/i.test(name)) return "封筒サイズ";
  if (/medium/i.test(name)) return "小さい段ボール";
  if (/large/i.test(name)) return "大きい段ボール";
  return "";
}
// 必須項目（Item Specifics）の代表名を日本語ラベルに。未知の名前は原語のまま。
function aspectLabel(name: string): string {
  const map: Record<string, string> = {
    brand: "ブランド",
    type: "種類",
    character: "キャラクター",
    color: "色",
    mpn: "型番（不明なら空欄でOK）",
  };
  return map[name.trim().toLowerCase()] ?? name;
}
interface PublishResult {
  ok: boolean;
  listingId?: string;
  error?: string;
  steps?: { step: string; ok: boolean; error?: string }[];
  needsSellerRegistration?: boolean;
  pendingVerification?: boolean;
  connected?: boolean; // false=連携切れ（再連携が必要）
}

type Phase = "loading" | "setup" | "form" | "publishing" | "done" | "draftsaved" | "pending" | "error";

// 「はやく売る」＝相場より少し安く（8%）して早く売れやすくする。
const FAST_DISCOUNT = 0.08;

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
  const [strategy, setStrategy] = useState<"fast" | "market">("fast"); // 売り方（既定: はやく売る）
  const [condition, setCondition] = useState("NEW");
  const [shippingId, setShippingId] = useState("");
  const [handlingDays, setHandlingDays] = useState(7); // 発送までの日数（既定7日）
  const [quantity, setQuantity] = useState(1); // 出品する個数（在庫数。既定1）
  const [aspects, setAspects] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PublishResult | null>(null);
  const [msg, setMsg] = useState("");
  const [confirming, setConfirming] = useState(false); // 「登録完了」処理中
  const [confirmErr, setConfirmErr] = useState(false); // 「登録完了」後も未登録だった
  const [ordered, setOrdered] = useState(false); // 先に楽天で注文した（無在庫抑止のチェック）
  const [cooldown, setCooldown] = useState(0); // 「登録完了」失敗後のクールダウン秒数

  useEffect(() => {
    let alive = true;
    logEvent("listing_open"); // モーダルを開いた（出品着手）を1回記録
    (async () => {
      const rd = await fetch("/api/ebay/listing-readiness", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({}));
      if (!alive) return;
      if (!rd.connected || !rd.ready) {
        setPhase("setup");
        return;
      }
      const p: PrepareData & { ok?: boolean; error?: string; connected?: boolean } = await fetch("/api/ebay/list/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      })
        .then((r) => r.json())
        .catch(() => ({ ok: false }));
      if (!alive) return;
      // 連携が切れていたら（読み込み中にトークン失効など）再連携へ誘導
      if (p.connected === false) {
        setPhase("setup");
        return;
      }
      if (!p.ok) {
        setMsg(p.error || "出品準備に失敗しました。");
        setPhase("error");
        return;
      }
      setData(p);
      setTitle(p.title);
      setDescription(p.description);
      // 既定は「はやく売る」＝相場より少し安く
      setPriceUsd((Number(p.priceUsd) * (1 - FAST_DISCOUNT)).toFixed(2));
      setCondition(p.condition);
      // デフォルトは中サイズの送料（無ければ先頭）
      const midShip = p.shipping?.find((s) => /medium/i.test(s.name)) ?? p.shipping?.[0];
      setShippingId(midShip?.fulfillmentPolicyId ?? "");
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

  // 「登録完了」失敗後のクールダウン（連打防止・メール到着待ちを促す）
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // 準備済みの内容で出品APIを叩く（publish と「登録完了」で共有）。
  const postPublish = (): Promise<PublishResult> =>
    fetch("/api/ebay/list/publish", {
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
        handlingDays,
        quantity,
      }),
    })
      .then((r) => r.json())
      .catch(() => ({ ok: false, error: "通信に失敗しました。" }));

  const finishOk = (res: PublishResult) => {
    setResult(res);
    track("ebay_list_published", { product_id: product.id });
    logEvent("listed"); // 出品成功（ファネル計測）
    setPhase("done");
    onListed?.();
  };

  const publish = async () => {
    setPhase("publishing");
    setMsg("");
    const res = await postPublish();
    if (res.connected === false) {
      setPhase("setup"); // 連携切れ → 再連携へ
      return;
    }
    if (res.ok) {
      finishOk(res);
      return;
    }
    setResult(res);
    if (res.needsSellerRegistration) setPhase("draftsaved");
    else if (res.pendingVerification) setPhase("pending");
    else {
      setMsg(res.error || "出品に失敗しました。");
      setPhase("error");
    }
  };

  // 「登録完了」：準備済みの内容で再出品。成功で公開、失敗なら赤字メッセージ。
  const confirmRegistered = async () => {
    setConfirming(true);
    setConfirmErr(false);
    const res = await postPublish();
    setConfirming(false);
    if (res.connected === false) {
      setPhase("setup"); // 連携切れ → 再連携へ
      return;
    }
    if (res.ok) finishOk(res);
    else {
      setConfirmErr(true);
      setCooldown(40); // 失敗後は数十秒待ってから再試行（メール到着前の連打を抑止）
    }
  };

  const canPublish = !!data?.category?.categoryId && Number(priceUsd) > 0;

  // 売り方の選択：はやく売る（相場より少し安く）/ 高く売る（相場どおり）。選ぶと価格を自動セット。
  const marketUsd = Number(data?.priceUsd) || 0;
  const chooseStrategy = (s: "fast" | "market") => {
    setStrategy(s);
    if (marketUsd > 0) setPriceUsd((s === "fast" ? marketUsd * (1 - FAST_DISCOUNT) : marketUsd).toFixed(2));
  };

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="eBay出品"
      className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center"
      // 出品中・登録確認中は背景タップでの誤クローズを防ぐ（実行中の操作を取りこぼさない）
      onClick={phase === "publishing" || confirming ? undefined : onClose}
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
            <div className="py-8 text-center">
              <AlertTriangle size={36} className="mx-auto mb-4 text-amber-400" />
              <p className="text-base font-black text-gray-800 mb-2">出品の準備がもう少しです</p>
              <p className="text-sm text-gray-500 mb-6 leading-relaxed">
                eBayに出品する準備（連携・送料・発送元）が、まだ残っています。<br />
                設定画面で順に進めれば、数分で完了します。
              </p>
              <button
                onClick={() => {
                  // OAuth全ページ往復で ?list= が消えても復元できるよう端末に控える（EbayListingSetupが拾う）
                  try { sessionStorage.setItem("ebay_list_after", product.id); } catch { /* noop */ }
                  router.push(`/settings?list=${encodeURIComponent(product.id)}`);
                }}
                className="inline-flex items-center justify-center gap-1.5 h-12 px-7 bg-[#BF0000] text-white font-bold text-sm rounded-xl active:bg-[#9E0000]"
              >
                <Settings size={16} /> 設定へ進む
              </button>
            </div>
          )}

          {phase === "form" && data && (
            <div className="space-y-4">
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

              {/* 売り方（はやく売る / 高く売る）。既定は「はやく売る」 */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">売り方</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => chooseStrategy("fast")}
                    aria-pressed={strategy === "fast"}
                    className={`flex flex-col items-center justify-center h-14 rounded-xl border transition-colors ${
                      strategy === "fast" ? "border-[#BF0000] bg-[#BF0000]/5 text-[#BF0000]" : "border-gray-200 text-gray-500"
                    }`}
                  >
                    <span className="text-[13px] font-bold">⚡ はやく売る</span>
                    <span className="text-[10px]">相場より少し安く</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseStrategy("market")}
                    aria-pressed={strategy === "market"}
                    className={`flex flex-col items-center justify-center h-14 rounded-xl border transition-colors ${
                      strategy === "market" ? "border-[#BF0000] bg-[#BF0000]/5 text-[#BF0000]" : "border-gray-200 text-gray-500"
                    }`}
                  >
                    <span className="text-[13px] font-bold">💰 高く売る</span>
                    <span className="text-[10px]">相場どおり・待つ</span>
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">
                  {strategy === "fast"
                    ? "相場より少し安くして、早く売れやすくします（おすすめ）"
                    : "相場どおりの価格。売れるまで少し待ちます"}
                </p>
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

              {/* 出品する個数（在庫数） */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">出品する個数（在庫数）</label>
                <select
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-[#BF0000]"
                >
                  {[...Array(30)].map((_, i) => (
                    <option key={i + 1} value={i + 1}>{i + 1}個</option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-400 mt-0.5">在庫数。1個だけならそのままでOK（最大30）</p>
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
                        {shippingLabel(s.name)}（{shippingHint(s.name)}・${s.costUsd}）
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

              {/* 発送までの日数（handling time） */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5 flex items-center gap-1">
                  <Clock size={12} className="text-gray-400" />発送までの日数（落札後に発送するまで）
                </label>
                <select
                  value={handlingDays}
                  onChange={(e) => setHandlingDays(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-[#BF0000]"
                >
                  {[1, 2, 3, 5, 7, 10, 14, 20, 30].map((d) => (
                    <option key={d} value={d}>
                      {d}日以内に発送{d === 7 ? "（おすすめ）" : ""}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-400 mt-0.5">買い手に表示される発送の目安です。初めは余裕をもって7日がおすすめ。</p>
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
                <div className="space-y-2.5">
                  <label className="block text-[11px] text-gray-500">商品の詳細</label>
                  <p className="text-[10px] text-gray-400 leading-relaxed">分かる範囲でOK・空欄でも多くは出品できます。</p>
                  {data.requiredAspects.map((a) => (
                    <div key={a.name}>
                      <span className="block text-[10px] text-gray-400 mb-0.5">{aspectLabel(a.name)}</span>
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

              {/* 無在庫の抑止：先に楽天で注文したことを必須チェック */}
              <label className="flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl px-3 py-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ordered}
                  onChange={(e) => setOrdered(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-[#BF0000] shrink-0"
                />
                <span className="text-[12px] text-amber-800 leading-relaxed">
                  先に楽天で<b>注文しました</b>（手元に在庫があります）。<br />
                  <span className="text-[11px] text-amber-700">無在庫での出品はトラブルのもと。注文してからチェックしてね。</span>
                </span>
              </label>

              {/* 出品ボタン */}
              <button
                onClick={publish}
                disabled={!canPublish || !ordered}
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
            <div className="py-8 text-center">
              <BadgeCheck size={44} className="mx-auto mb-3 text-emerald-500" />
              <p className="text-base font-black text-gray-800 mb-1.5">eBayに出品しました！</p>
              <p className="text-xs text-gray-500 mb-4 leading-relaxed">売れたら自動で検知して、この一覧の下の方に移動します。</p>
              <div className="mb-4 bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3 text-left">
                <p className="text-[12px] text-emerald-800 leading-relaxed">
                  <b>売れたら</b>：① 日本郵便で発送 → ② 売上はPayoneerに入る → 銀行へ出金
                </p>
                <a
                  href="/guide/payoneer-withdraw"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-[12px] font-bold text-[#0064D2] underline underline-offset-2"
                >
                  💴 売上の受け取り方を見る
                </a>
              </div>
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
                <p className="text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-3 mb-3 leading-relaxed text-center">
                  <b className="text-[15px]">！！初回だけ！！</b>
                  <br />
                  セラー登録をする必要があります。
                </p>
                <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 mb-4 leading-relaxed text-left">
                  <b className="text-gray-700">eBayの「下書き」を探さなくて大丈夫。</b> 登録前の出品はそこに出ない仕様です。登録後にこのアプリから公開すれば「出品中」に並びます。
                </p>
                <button
                  type="button"
                  onClick={() => {
                    // 別ウィンドウでeBay登録を開く（アプリは開いたまま→戻って「登録完了」を押せる）
                    const w = window.open(
                      "https://www.ebay.com/sl/sell",
                      "ebaySellerRegister",
                      "width=920,height=840"
                    );
                    if (w) w.opener = null; // 逆タブナビング対策
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 h-11 px-6 bg-[#0064D2] text-white font-bold text-sm rounded-xl active:bg-[#0053AE]"
                >
                  eBayでセラー登録する
                </button>

                <button
                  type="button"
                  onClick={confirmRegistered}
                  disabled={confirming || cooldown > 0}
                  className="mt-2 w-full inline-flex items-center justify-center gap-1.5 h-11 px-6 bg-emerald-600 text-white font-bold text-sm rounded-xl active:bg-emerald-700 disabled:opacity-50"
                >
                  {confirming ? "確認中..." : cooldown > 0 ? `もう一度（${cooldown}秒後）` : "登録完了"}
                </button>

                {confirmErr && (
                  <p className="mt-2 text-[11px] text-[#BF0000] leading-relaxed">
                    まだ登録が完了していません。eBayから〈アカウントの準備ができました〉のメールが届いてから押してください。
                  </p>
                )}
              </div>
              <a
                href="/guide/ebay-seller"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 block text-center text-[12px] font-bold text-[#0064D2] underline underline-offset-2"
              >
                📖 登録のやり方を画像つきでくわしく見る
              </a>
              <EbaySellerGuide />
              <div className="text-center mt-3">
                <button onClick={onClose} className="text-sm font-bold text-gray-500">あとで</button>
              </div>
            </div>
          )}

          {phase === "pending" && (
            <div className="py-5 text-center">
              <Clock size={40} className="mx-auto mb-3 text-amber-500" />
              <p className="text-sm font-black text-gray-800 mb-1">アカウントの最終確認待ちです</p>
              <p className="text-xs text-gray-500 mb-3 leading-relaxed">
                登録ありがとうございます！いまeBayが<b className="text-gray-700">本人確認</b>をしています。
                <br />
                <b>確認メール</b>が届いたら出品できます（早ければ数分、長いと数日）。
              </p>
              <p className="text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2.5 mb-4 leading-relaxed">
                メールが届いたら、下のボタンを押すと<b>そのまま出品</b>されます。
              </p>
              <button
                type="button"
                onClick={confirmRegistered}
                disabled={confirming || cooldown > 0}
                className="w-full inline-flex items-center justify-center gap-1.5 h-11 px-6 bg-emerald-600 text-white font-bold text-sm rounded-xl active:bg-emerald-700 disabled:opacity-50"
              >
                {confirming ? "確認中..." : cooldown > 0 ? `もう一度（${cooldown}秒後）` : "確認できた・出品する"}
              </button>
              {confirmErr && (
                <p className="mt-2 text-[11px] text-[#BF0000] leading-relaxed">
                  まだ確認が取れていません。eBayから〈アカウントの準備ができました〉のメールが届いてから押してください。
                </p>
              )}
              <a
                href="/guide/ebay-seller"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 block text-center text-[12px] font-bold text-[#0064D2] underline underline-offset-2"
              >
                📖 登録のやり方を画像つきで見る
              </a>
              <div className="mt-3">
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
                {/* 入力フォームがある時だけ「入力に戻る」。初回準備の失敗（data無し）では空フォームになるため出さない。 */}
                {data && (
                  <button onClick={() => { setPhase("form"); setResult(null); }} className="flex-1 h-11 border border-gray-200 rounded-xl text-sm font-bold text-gray-600">
                    入力に戻る
                  </button>
                )}
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
