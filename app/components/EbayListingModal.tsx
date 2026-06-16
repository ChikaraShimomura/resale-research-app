"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ProfitProduct } from "../lib/profitFilter";
import { formatJpy } from "../lib/utils";
import { track, logEvent } from "../lib/analytics";
import { X, BadgeCheck, AlertTriangle, ExternalLink, Settings, Clock } from "lucide-react";

interface RequiredAspect { name: string; values: string[]; free: boolean; required: boolean; value: string }
interface ShippingChoice { fulfillmentPolicyId: string; name: string; costUsd: string }
interface PrepareData {
  product: { id: string; jaTitle: string; imageUrl: string; rakutenPrice: number; ebayAvgJpy: number };
  title: string;
  description: string;
  priceUsd: string;
  medianUsd?: string;        // 中央値USD（売り方「相場/はやく」の基準）
  lowestUsd?: string | null; // 同等品の現在の最安USD（最速出品用）
  floorUsd?: string;         // 損益分岐USD（これ未満は赤字）
  condition: string;
  category: { categoryId?: string; categoryName?: string; categoryTreeId: string } | null;
  requiredAspects: RequiredAspect[];
  shipping: ShippingChoice[];
  recommendedShippingId?: string; // ジャンル(サイズ)に最適な送料ポリシー（既定選択に使う）
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
  accountUnusable?: boolean; // アカウントが出品できる状態にない（制限/確認中 等）
  connected?: boolean; // false=連携切れ（再連携が必要）
}

type Phase = "loading" | "setup" | "form" | "publishing" | "done" | "notready" | "error";

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
  const [strategy, setStrategy] = useState<"fast" | "market" | "lowest">("lowest"); // 売り方（既定: 最安＝最速・カード表示と一致）
  const [condition, setCondition] = useState("NEW");
  const [shippingId, setShippingId] = useState("");
  const [handlingDays, setHandlingDays] = useState(7); // 発送までの日数（既定7日）
  const [quantity, setQuantity] = useState(1); // 出品する個数（在庫数。既定1）
  const [bestOffer, setBestOffer] = useState(true); // 値下げ交渉(Best Offer)を受け付ける（既定ON）
  const [aspects, setAspects] = useState<Record<string, string>>({});
  const [showOptional, setShowOptional] = useState(false); // おすすめ(任意)項目を開いて編集するか（既定は閉じる＝自動入力のまま）
  const [result, setResult] = useState<PublishResult | null>(null);
  const [msg, setMsg] = useState("");
  const [confirming, setConfirming] = useState(false); // 「登録完了」処理中
  const [confirmErr, setConfirmErr] = useState(false); // 「登録完了」後も未登録だった
  const [ordered, setOrdered] = useState(false); // 先に楽天で注文した（無在庫抑止のチェック）
  const [cooldown, setCooldown] = useState(0); // 「登録完了」失敗後のクールダウン秒数
  const [reportState, setReportState] = useState<"idle" | "sending" | "done">("idle"); // 開発者に報告

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
      // 既定は「最安」＝eBay最安に合わせる（損益分岐は割らない）。取れなければ相場-8%。
      {
        const lowU = Number(p.lowestUsd) || 0;
        const floorU = Number(p.floorUsd) || 0;
        const medU = Number(p.medianUsd) || Number(p.priceUsd) || 0;
        const initLowest = lowU > 0 ? Math.max(lowU, floorU) : medU > 0 ? medU * (1 - FAST_DISCOUNT) : Number(p.priceUsd) || 0;
        setPriceUsd(initLowest.toFixed(2));
      }
      setCondition(p.condition);
      // デフォルトはジャンル(サイズ)に最適な送料。無ければ中サイズ→先頭にフォールバック。
      const recOk =
        p.recommendedShippingId && p.shipping?.some((s) => s.fulfillmentPolicyId === p.recommendedShippingId);
      const def = recOk
        ? p.recommendedShippingId
        : (p.shipping?.find((s) => /medium/i.test(s.name)) ?? p.shipping?.[0])?.fulfillmentPolicyId;
      setShippingId(def ?? "");
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
        bestOffer,
        floorUsd: data?.floorUsd,
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
    if (res.needsSellerRegistration || res.pendingVerification || res.accountUnusable) setPhase("notready");
    else {
      setMsg(res.error || "出品に失敗しました。");
      setPhase("error");
    }
  };

  // 「開発者に報告」：予期せぬエラーの状況を送る（KV保存＋運用者へメール）。開発者が取り込んで修正に使う。
  const reportError = async () => {
    setReportState("sending");
    try {
      await fetch("/api/report/error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          where: "ebay_listing",
          message: msg || result?.error || "",
          steps: result?.steps,
          productId: product.id,
          coreKeyword: product.coreKeyword,
          category: data?.category,
          priceUsd,
          strategy,
          condition,
          quantity,
          aspects,
        }),
      });
    } catch {
      /* 送信失敗でも done にして多重送信を防ぐ */
    }
    setReportState("done");
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

  // 必須Item Specifics（Type等）が全て埋まっているか。未入力だと公開が #25002 で弾かれるため出品をブロック。
  // 推奨(任意)項目は空でも公開できるのでブロック対象外。
  const aspectsFilled = (data?.requiredAspects ?? []).filter((a) => a.required).every((a) => (aspects[a.name] ?? "").trim() !== "");
  const canPublish = !!data?.category?.categoryId && Number(priceUsd) > 0 && aspectsFilled;

  // 売り方の選択：最安（eBay最安・最速・既定）/ はやく（相場-8%）/ 高く（相場どおり）。選ぶと価格を自動セット。
  // 相場の基準は中央値(medianUsd)。表示価格(priceUsd)は最安ベースなので、はやく/高くは中央値を基準に計算する。
  const medianUsd = Number(data?.medianUsd) || Number(data?.priceUsd) || 0;
  const lowUsd = Number(data?.lowestUsd) || 0;     // eBay同等品の現在の最安
  const floorUsd = Number(data?.floorUsd) || 0;    // 損益分岐（これ未満は赤字）
  const lowestAvailable = lowUsd > 0;
  const lowestClamped = lowUsd > 0 && floorUsd > lowUsd; // eBay最安が赤字→損益分岐で出す
  const lowestTarget = lowUsd > 0 ? Math.max(lowUsd, floorUsd) : medianUsd > 0 ? medianUsd * (1 - FAST_DISCOUNT) : 0;
  const chooseStrategy = (s: "fast" | "market" | "lowest") => {
    setStrategy(s);
    if (s === "market") { if (medianUsd > 0) setPriceUsd(medianUsd.toFixed(2)); return; }
    if (s === "fast") { if (medianUsd > 0) setPriceUsd((medianUsd * (1 - FAST_DISCOUNT)).toFixed(2)); return; }
    if (lowestTarget > 0) setPriceUsd(lowestTarget.toFixed(2)); // 最安（損益分岐は割らない）
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
                  // OAuth/アカウント作成の往復で ?list= や sessionStorage が消えても復元できるよう、
                  // localStorage にも控える（アプリ内ブラウザは session が消えやすい）。EbayListingSetupが拾う。
                  try {
                    sessionStorage.setItem("ebay_list_after", product.id);
                    localStorage.setItem("ebay_list_after", product.id);
                  } catch { /* noop */ }
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

              {/* 売り方（はやく / 最安 / 高く）。既定は「はやく売る」 */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">売り方</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => chooseStrategy("fast")}
                    aria-pressed={strategy === "fast"}
                    className={`flex flex-col items-center justify-center h-14 rounded-xl border transition-colors ${
                      strategy === "fast" ? "border-[#BF0000] bg-[#BF0000]/5 text-[#BF0000]" : "border-gray-200 text-gray-500"
                    }`}
                  >
                    <span className="text-[12px] font-bold">⚡ はやく</span>
                    <span className="text-[10px]">相場−8%</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseStrategy("lowest")}
                    aria-pressed={strategy === "lowest"}
                    className={`flex flex-col items-center justify-center h-14 rounded-xl border transition-colors ${
                      strategy === "lowest" ? "border-[#BF0000] bg-[#BF0000]/5 text-[#BF0000]" : "border-gray-200 text-gray-500"
                    }`}
                  >
                    <span className="text-[12px] font-bold">🚀 最安</span>
                    <span className="text-[10px]">eBay最安に</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseStrategy("market")}
                    aria-pressed={strategy === "market"}
                    className={`flex flex-col items-center justify-center h-14 rounded-xl border transition-colors ${
                      strategy === "market" ? "border-[#BF0000] bg-[#BF0000]/5 text-[#BF0000]" : "border-gray-200 text-gray-500"
                    }`}
                  >
                    <span className="text-[12px] font-bold">💰 高く</span>
                    <span className="text-[10px]">相場どおり</span>
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">
                  {strategy === "fast"
                    ? "相場より少し安くして、早く売れやすくします（おすすめ）"
                    : strategy === "market"
                    ? "相場どおりの価格。売れるまで少し待ちます"
                    : !lowestAvailable
                    ? "eBayの最安が取れなかったため、相場より少し安くしています"
                    : lowestClamped
                    ? `eBayの最安は赤字になるため、損益分岐 $${data.floorUsd} で出します（最速・赤字回避）`
                    : "eBayの最安値に合わせて、最速で売れやすくします（赤字にはしません）"}
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
                {floorUsd > 0 && Number(priceUsd) > 0 && Number(priceUsd) < floorUsd && (
                  <p className="text-[11px] text-[#BF0000] bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 mt-1.5 leading-relaxed">
                    ⚠️ 損益分岐 ${floorUsd.toFixed(2)} を下回っています。このままだと赤字の恐れがあります。
                  </p>
                )}
              </div>

              {/* 値下げ交渉（Best Offer）の自動対応 */}
              <div className="rounded-xl border border-gray-200 p-2.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bestOffer}
                    onChange={(e) => setBestOffer(e.target.checked)}
                    className="accent-[#BF0000] w-4 h-4"
                  />
                  <span className="text-xs font-bold text-gray-700">値下げ交渉（Best Offer）を受け付ける</span>
                </label>
                {bestOffer && Number(priceUsd) > 0 && (
                  <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                    ${(Number(priceUsd) * 0.9).toFixed(2)} 以上のオファーは<b>自動承諾</b>（10%引きまで即売）
                    {floorUsd > 0 && floorUsd < Number(priceUsd) * 0.9 && (
                      <>／ 損益分岐 ${floorUsd.toFixed(2)} 未満は<b>自動拒否</b></>
                    )}
                  </p>
                )}
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

              {/* Item Specifics（必須＝常時表示／推奨＝自動入力ずみで折りたたみ） */}
              {data.requiredAspects.length > 0 && (() => {
                const required = data.requiredAspects.filter((a) => a.required);
                const optional = data.requiredAspects.filter((a) => !a.required);
                const renderField = (a: RequiredAspect) => {
                  const empty = (aspects[a.name] ?? "").trim() === "";
                  const showRed = a.required && empty; // 推奨は空でも赤くしない（出品はブロックしない）
                  const base = `w-full h-9 px-2.5 rounded-lg border text-[13px] focus:outline-none focus:border-[#BF0000] ${showRed ? "border-red-300 bg-red-50/40" : "border-gray-200"}`;
                  return (
                    <div key={a.name}>
                      <span className="block text-[10px] text-gray-400 mb-0.5">{aspectLabel(a.name)}{a.required ? (empty && <span className="text-[#BF0000]"> ※必須</span>) : <span className="text-gray-400"> （任意）</span>}</span>
                      {a.values.length > 0 ? (
                        <select
                          value={aspects[a.name] ?? ""}
                          onChange={(e) => setAspects((s) => ({ ...s, [a.name]: e.target.value }))}
                          className={`${base} bg-white`}
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
                          className={base}
                        />
                      )}
                    </div>
                  );
                };
                return (
                  <div className="space-y-2.5">
                    <label className="block text-[11px] text-gray-500">商品の詳細</label>
                    <p className="text-[10px] text-gray-400 leading-relaxed">※必須だけ確認すればOK。それ以外は検索に出やすい値を自動入力ずみです（必要なら下で編集）。</p>
                    {required.map(renderField)}
                    {optional.length > 0 && (
                      <div className="border-t border-gray-100 pt-2.5">
                        <button
                          type="button"
                          onClick={() => setShowOptional((v) => !v)}
                          className="flex items-center justify-between w-full text-[11px] text-gray-500"
                        >
                          <span>おすすめ項目（自動入力ずみ・{optional.length}件）</span>
                          <span className="text-gray-400">{showOptional ? "閉じる ▲" : "編集する ▼"}</span>
                        </button>
                        {showOptional && <div className="space-y-2.5 mt-2.5">{optional.map(renderField)}</div>}
                      </div>
                    )}
                  </div>
                );
              })()}

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

              {/* 海外出品の不安をやわらげる一言 */}
              <p className="text-[11px] text-gray-600 bg-[#F5F7FA] border border-gray-100 rounded-lg px-3 py-2 leading-relaxed">
                🌏 英語の説明は自動入力ずみ。購入者とのやり取りも定型文でOK。売れたら<b>日本の郵便局から送るだけ</b>です。
              </p>

              {/* 必須項目が未入力の時の案内（公開エラー#25002の予防） */}
              {!aspectsFilled && (
                <p className="text-[11px] text-[#BF0000] bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  ⚠️ 上の「商品の詳細（必須）」に未入力があります。候補から選ぶと出品できます。
                </p>
              )}

              {/* 必須項目はOKだが注文チェック未済で押せない時の理由を明示 */}
              {aspectsFilled && !ordered && (
                <p className="text-[11px] text-[#BF0000] bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  ⚠️ 上の「先に楽天で注文しました」にチェックすると出品できます。
                </p>
              )}

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
            <div className="py-10 flex flex-col items-center justify-center gap-3 text-center">
              <span className="w-8 h-8 border-[3px] border-gray-200 border-t-[#0064D2] rounded-full animate-spin" aria-hidden="true" />
              <p className="text-sm text-gray-500">
                eBayに出品中...（10〜20秒ほど）<br />
                <span className="text-[12px] text-gray-400">この画面は閉じないでください</span>
              </p>
            </div>
          )}

          {phase === "done" && (
            <div className="py-8 text-center">
              <BadgeCheck size={44} className="mx-auto mb-3 text-emerald-500" />
              <p className="text-base font-black text-gray-800 mb-1.5">出品が完了しました！</p>
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
              {/* 実物写真の追加を促す。楽天の画像だけより、実物写真があると信頼され売れやすい。 */}
              <div className="mb-4 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-left">
                <p className="text-[12px] text-amber-800 leading-relaxed">
                  <b>📸 楽天から商品が届いたら</b>、実物の写真を撮って <b>eBayの出品に追加</b>しましょう。実物写真があると<b>信頼されて売れやすく</b>なります（下の「出品した商品を見る」→ 写真の編集から追加できます）。
                </p>
              </div>
              {/* eBayで出品した商品を確認。listingIdがあれば直リンク、無ければ自分の出品一覧へ（必ず確認できる）。 */}
              <a
                href={result?.listingId ? `https://www.ebay.com/itm/${result.listingId}` : "https://www.ebay.com/sh/lst/active"}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-1.5 h-12 bg-[#0064D2] text-white font-bold text-sm rounded-xl active:bg-[#0053AE] mb-2"
              >
                🔎 eBayで出品した商品を見る <ExternalLink size={14} />
              </a>
              <button onClick={onClose} className="w-full h-11 border border-gray-200 rounded-xl text-sm font-bold text-gray-600">
                閉じる
              </button>
            </div>
          )}

          {phase === "notready" && (
            <div className="py-6">
              <div className="text-center">
                <AlertTriangle size={40} className="mx-auto mb-3 text-amber-500" />
                <p className="text-lg font-black text-amber-700 mb-2">セラー登録が出来ていません。</p>
                <p className="text-[12px] text-gray-500 mb-4 leading-relaxed">
                  eBayで売上を受け取るための<b className="text-gray-700">セラー登録（初回だけ）</b>が済むと、ここから出品できます。
                </p>
              </div>

              {/* 「登録の壁」は他社サポート(ココナラ等)で突破できる、という応援。手順はアプリでは案内しない方針。 */}
              <div className="bg-[#FFF7ED] border border-amber-200 rounded-xl px-3.5 py-3 mb-4 text-left">
                <p className="text-[12px] text-amber-900 leading-relaxed">
                  💪 ここが<b>最初の関門</b>。登録は<b>一度きり</b>です。自分で進めるのが不安なら、
                  <b>ココナラ（スキル販売の他社サービス）</b>で「eBay セラー登録 サポート」を探すと、詳しい人に手伝ってもらえます。
                  <br />
                  この壁さえ越えれば、あとは<b>アプリのワンタップ出品</b>で世界に売っていけます。応援しています！
                </p>
              </div>

              {/* 収益の複利イメージ（10万円→毎月+10%）。断定額ではなく「イメージ図」＋免責で誇大表現を回避。 */}
              <div className="bg-white border border-gray-100 rounded-xl px-3 pt-3 pb-2 mb-4">
                <p className="text-[12px] font-black text-gray-800 text-center">🌍 海外輸出業のポテンシャル</p>
                <p className="text-[10px] text-gray-500 text-center mb-1">10万円から、毎月10%ずつ増やせたら…📈</p>
                <svg
                  viewBox="0 0 340 180"
                  className="w-full h-auto"
                  role="img"
                  aria-label="10万円を毎月10%増やすと5年で約3,000万円になる複利のイメージ図"
                >
                  <line x1="38" y1="18" x2="38" y2="140" stroke="#E5E7EB" strokeWidth="1.5" />
                  <line x1="38" y1="140" x2="326" y2="140" stroke="#E5E7EB" strokeWidth="1.5" />
                  <text x="8" y="16" fontSize="10" fill="#9CA3AF">資産</text>
                  <path
                    d="M40 139.6 L96 138.8 L152 136.1 L208 127.8 L264 101.8 L320 20 L320 140 L40 140 Z"
                    fill="#10B98120"
                  />
                  <polyline
                    points="40,139.6 96,138.8 152,136.1 208,127.8 264,101.8 320,20"
                    fill="none"
                    stroke="#10B981"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="40" cy="139.6" r="3.5" fill="#10B981" />
                  <circle cx="208" cy="127.8" r="3.5" fill="#10B981" />
                  <circle cx="264" cy="101.8" r="3.5" fill="#10B981" />
                  <circle cx="320" cy="20" r="4.5" fill="#059669" />
                  <text x="40" y="132" fontSize="9.5" fill="#6B7280" textAnchor="middle">10万</text>
                  <text x="206" y="121" fontSize="9.5" fill="#059669" textAnchor="middle">約300万</text>
                  <text x="322" y="14" fontSize="12" fontWeight="bold" fill="#059669" textAnchor="end">
                    5年で約3,000万円
                  </text>
                  {["今", "1年", "2年", "3年", "4年", "5年"].map((l, i) => (
                    <text key={l} x={40 + i * 56} y="156" fontSize="10" fill="#9CA3AF" textAnchor="middle">
                      {l}
                    </text>
                  ))}
                </svg>
                <p className="text-[10px] text-gray-400 leading-relaxed mt-1">
                  ※ 利益を仕入れに回して<b>毎月10%</b>増やせた場合の複利イメージです（実際の結果を保証するものではありません）。
                </p>
              </div>

              <div className="text-center">
                <button
                  type="button"
                  onClick={confirmRegistered}
                  disabled={confirming || cooldown > 0}
                  className="w-full h-11 mb-2 bg-emerald-600 text-white font-bold text-sm rounded-xl active:bg-emerald-700 disabled:opacity-50"
                >
                  {confirming ? "eBayに確認中..." : cooldown > 0 ? `もう一度（${cooldown}秒後）` : "登録できた・もう一度試す"}
                </button>
                {cooldown > 0 && !confirmErr ? (
                  <p className="mb-2 text-[11px] text-gray-400 leading-relaxed">
                    eBayへの確認は数十秒おきに行えます。少し待ってからもう一度押してください。
                  </p>
                ) : !confirmErr ? (
                  <p className="mb-2 text-[11px] text-gray-400 leading-relaxed">
                    eBayから〈アカウントの準備ができました〉のメールが届いたら押してください。準備ができていればそのまま出品に進めます。
                  </p>
                ) : null}
                {confirmErr && (
                  <p className="mb-2 text-[11px] text-[#BF0000] leading-relaxed">
                    まだ登録が完了していません。eBayから〈アカウントの準備ができました〉のメールが届いてから押してください。
                  </p>
                )}
                <button onClick={onClose} className="w-full h-10 text-sm font-bold text-gray-500">あとで</button>
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
              {/* まず自分で試せる対処。大半は再試行か画像差し替えで解決するため、報告の前に提示する。 */}
              <div className="mb-3 bg-amber-50 border border-amber-100 rounded-xl px-3.5 py-2.5 text-left">
                <p className="text-[11px] font-bold text-amber-800 mb-1">まず試してみてください</p>
                <ul className="text-[11px] text-amber-900/80 leading-relaxed list-disc pl-4 space-y-0.5">
                  <li>少し時間をおいて<b>もう一度出品</b>（一時的な通信エラーのことがあります）</li>
                  <li>写真が暗い・小さいときは<b>別の写真</b>に差し替える</li>
                  <li>それでも直らなければ、下のボタンで報告してください</li>
                </ul>
              </div>
              {/* 予期せぬエラーを開発者に報告（自動修復のための情報を送る） */}
              <button
                type="button"
                onClick={reportError}
                disabled={reportState !== "idle"}
                className="w-full h-11 mb-2 bg-[#BF0000] text-white rounded-xl text-sm font-bold active:bg-[#9E0000] disabled:opacity-50"
              >
                {reportState === "idle" ? "🛠 このエラーを開発者に報告" : reportState === "sending" ? "送信中..." : "✓ 報告しました。ありがとうございます！"}
              </button>
              {reportState === "done" && (
                <p className="text-[11px] text-gray-500 text-center mb-2">内容を確認して修正します。直ったら再度お試しください。</p>
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
