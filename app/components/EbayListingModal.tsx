"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ProfitProduct } from "../lib/profitFilter";
import { formatJpy } from "../lib/utils";
import { track, logEvent } from "../lib/analytics";
import SaveProgressNudge from "./SaveProgressNudge";
import CopyKeyword from "./CopyKeyword";
import { X, BadgeCheck, AlertTriangle, ExternalLink, Settings, Clock, Crown } from "lucide-react";
import { landedCostForWeight, recommendShippingTier, pickShippingPolicyId, USD_JPY } from "../lib/ebay/landedCost";
import { readListingDefaults } from "../lib/prefs"; // 出品の既定値（Best Offer・発送までの日数）

interface RequiredAspect { name: string; values: string[]; free: boolean; required: boolean; value: string }
interface ShippingChoice { fulfillmentPolicyId: string; name: string; costUsd: string }
interface PrepareData {
  product: { id: string; jaTitle: string; imageUrl: string; rakutenPrice: number; ebayAvgJpy: number };
  title: string;
  description: string;
  priceUsd: string;
  medianUsd?: string;        // 中央値USD（売り方「相場/はやく」の基準）
  lowestUsd?: string | null; // 同等品の現在の最安USD（最速出品用）
  floorUsd?: string;         // 損益分岐USD（これ未満は赤字・国際送料/関税の目安を織り込み済み）
  effBuyJpy?: number;        // 実質仕入れ原価。重さ(任意)入力時に損益分岐をクライアントで再計算するのに使う
  landed?: {                 // 損益分岐に織り込んだ着地コスト（国際送料・米国関税）の内訳
    weightG: number;
    shippingJpy: number;
    shippingMethod: "airpacket" | "ems";
    dutyJpy: number;
    needsDutyPrepay: boolean;
  };
  condition: string;
  category: { categoryId?: string; categoryName?: string; categoryTreeId: string } | null;
  requiredAspects: RequiredAspect[];
  shipping: ShippingChoice[];
  recommendedShippingId?: string; // ジャンル(サイズ)に最適な送料ポリシー（既定選択に使う）
  refImages?: string[];     // 楽天ギャラリー(自宅ワーカー取得・出品/撮影の候補)
  productImages?: string[]; // 楽天APIの代表画像(常に最低1枚)
}

const MAX_LISTING_PHOTOS = 12; // eBay出品に使える最大枚数（EPS加工時間の都合で12に制限）

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
// 各項目の必須/任意バッジ（「何を必ず入れるか」を一目で）。
function ReqBadge() {
  return <span className="ml-1 align-middle text-[9px] font-bold text-[#BF0000] bg-red-50 border border-red-200 rounded px-1 py-px">必須</span>;
}
function OptBadge() {
  return <span className="ml-1 align-middle text-[9px] text-gray-400 bg-gray-50 border border-gray-200 rounded px-1 py-px">任意</span>;
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
  errorKind?: "known" | "unexpected"; // known=要因が特定できた／unexpected=予期せぬエラー（報告ボタンを出す）
  errorDetail?: string; // 生のeBayエラー（ユーザーには見せず、開発者報告に同梱）
  planLimitReached?: boolean; // 同時出品数がプラン上限に到達（アップグレード誘導画面を出す）
}

type Phase = "loading" | "setup" | "form" | "publishing" | "done" | "notready" | "error" | "limit";

// 「はやく売る」＝相場より少し安く（8%）して早く売れやすくする。
const FAST_DISCOUNT = 0.08;
const FAST_UNDERCUT = 0.05; // 「はやく」＝「最安」からさらに5%オフ（最速で売る）
// USD_JPY は SSOT(landedCostCore・env駆動/既定155)から import に統一（旧:ローカル155）。クライアントでは既定155に解決。
const HIGH_MARKUP = 0.10; // 「高値出品」＝eBay相場(中央値)から10%高く

// ココナラ(他社)のセラー登録サポート導線。A8.netアフィリエイト(本人のa8mat)。
// env が優先。未設定でも下のデフォルト(本番リンク)で動く。NEXT_PUBLIC_* はビルド時に埋め込まれる(公開値=a8matは元々公開)。
const COCONALA_AFFILIATE_URL =
  process.env.NEXT_PUBLIC_COCONALA_AFFILIATE_URL || "https://px.a8.net/svt/ejp?a8mat=4B5X8G+C6720I+2PEO+1HP31U";
const COCONALA_AFFILIATE_IMG =
  process.env.NEXT_PUBLIC_COCONALA_AFFILIATE_IMG || "https://www10.a8.net/0.gif?a8mat=4B5X8G+C6720I+2PEO+1HP31U";
// ココナラで探してもらう検索ワード（コピー誘導＆フォールバック検索URLで共通利用）。
const COCONALA_KEYWORD = "eBayセラー登録";
// アフィリ未設定時のフォールバック＝アフィリ無しのココナラ検索(「eBayセラー登録」結果)に着地。
const COCONALA_SEARCH_URL = "https://coconala.com/search?keyword=" + encodeURIComponent(COCONALA_KEYWORD);
const COCONALA_HREF = COCONALA_AFFILIATE_URL || COCONALA_SEARCH_URL;
const COCONALA_IS_AD = !!COCONALA_AFFILIATE_URL; // アフィリエイト時のみ「広告」表記(ステマ規制対応)
// 着地先が既に検索結果(どこでもリンク等)なら「検索してね」の案内は不要。通常リンクの時だけ案内を出す。
const COCONALA_PRESEARCHED = /search\?|a8ejpredirect/.test(COCONALA_HREF);

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
  const [weightInput, setWeightInput] = useState(""); // 重さ(任意・g・梱包込み)。入力すると送料/損益分岐を再計算
  const [showWeight, setShowWeight] = useState(false); // 重さ入力欄は既定で隠し、押したら開く
  const [strategy, setStrategy] = useState<"fast" | "market" | "lowest" | "high">("lowest"); // 売り方（既定: 最安出品＝最速・カード表示と一致）
  const [condition, setCondition] = useState("NEW");
  const [shippingId, setShippingId] = useState("");
  // 発送までの日数・Best Offer は「出品の既定値」（設定で保存・端末単位）を初期値に使う。
  const [handlingDays, setHandlingDays] = useState(() => readListingDefaults().handlingDays);
  const [quantity, setQuantity] = useState(1); // 出品する個数（在庫数。既定1）
  const [bestOffer, setBestOffer] = useState(() => readListingDefaults().bestOffer);
  const [aspects, setAspects] = useState<Record<string, string>>({});
  const [selectedImages, setSelectedImages] = useState<string[]>([]); // 出品に使う写真URL（先頭=メイン・チェックで選択）
  const [zoomIndex, setZoomIndex] = useState<number | null>(null); // 拡大プレビューを開いた起点index（null=閉じ）
  const carouselRef = useRef<HTMLDivElement>(null); // 拡大カルーセルの横スクロール制御
  useEffect(() => {
    if (zoomIndex === null) return;
    const el = carouselRef.current;
    const child = el?.children[zoomIndex] as HTMLElement | undefined;
    if (el && child) el.scrollLeft = child.offsetLeft; // 開いた写真までスクロール
  }, [zoomIndex]);
  // 送料ポリシーを「重さ(入力 or 概算)＋高額(EMS必須)」で自動選択。重さを入れ替えると最適なサイズに切り替わる。
  useEffect(() => {
    if (!data?.shipping?.length || !data.landed) return;
    const w = Number(weightInput) > 0 ? Number(weightInput) : data.landed.weightG ?? 700;
    const v = Number(data.priceUsd) || data.product.ebayAvgJpy / USD_JPY;
    const id = pickShippingPolicyId(data.shipping, recommendShippingTier(w, v));
    if (id) setShippingId(id);
  }, [weightInput, data]);
  const [showOptional, setShowOptional] = useState(false); // おすすめ(任意)項目を開いて編集するか（既定は閉じる＝自動入力のまま）
  const [result, setResult] = useState<PublishResult | null>(null);
  const [msg, setMsg] = useState("");
  const [confirming, setConfirming] = useState(false); // 「登録完了」処理中
  const [confirmErr, setConfirmErr] = useState(false); // 「登録完了」後も未登録だった
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
      // 出品写真は自分で選ぶ（既定は未選択）。タップした順がそのまま出品の画像順になる（先頭＝メイン）。
      setSelectedImages([]);
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
        floorUsd, // 重さ入力を反映した再計算後のfloor（表示と一致・Best Offer自動拒否に使用）
        selectedImages, // 出品に使う写真（先頭=メイン）
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
    if (res.planLimitReached) { setResult(res); setPhase("limit"); return; } // 上限到達→アップグレード誘導
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
          message: result?.errorDetail || result?.error || msg || "",
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
    else if (res.planLimitReached) { setResult(res); setPhase("limit"); } // 上限到達→アップグレード誘導
    else {
      setConfirmErr(true);
      setCooldown(40); // 失敗後は数十秒待ってから再試行（メール到着前の連打を抑止）
    }
  };

  // 必須Item Specifics（Type等）が全て埋まっているか。未入力だと公開が #25002 で弾かれるため出品をブロック。
  // 推奨(任意)項目は空でも公開できるのでブロック対象外。
  const aspectsFilled = (data?.requiredAspects ?? []).filter((a) => a.required).every((a) => (aspects[a.name] ?? "").trim() !== "");

  // 出品写真の候補（楽天ギャラリー＋API代表画像・重複除去）。ユーザーがチェックで選ぶ。
  const photoCandidates = Array.from(new Set([...(data?.refImages ?? []), ...(data?.productImages ?? [])])).filter(Boolean);
  // 拡大プレビューは「実際にeBayへ送る加工後画像」を出す（clean-img の list=1＝enhanceToEpsと同一加工）＝WYSIWYG。
  // プロキシは楽天系ホストのみ許可なので、楽天画像だけ通し、それ以外は元URL。
  const ebayPreviewSrc = (url: string) =>
    /(rakuten\.co\.jp|r10s\.jp)/i.test(url) ? `/api/clean-img?u=${encodeURIComponent(url)}&list=1` : url;
  // チェックの切り替え。選んだ順を保持＝この順番がそのまま出品の画像順になる（先頭=メイン写真）。
  const togglePhoto = (url: string) => {
    setSelectedImages((cur) => {
      if (cur.includes(url)) return cur.filter((u) => u !== url);
      if (cur.length >= MAX_LISTING_PHOTOS) return cur; // 上限超えは追加しない
      return [...cur, url]; // 末尾に追加＝タップした順を維持
    });
  };
  // 候補があるのに1枚も選んでいなければ出品させない（写真ゼロの出品を防ぐ）。
  const photoOk = photoCandidates.length === 0 || selectedImages.length >= 1;
  const canPublish = !!data?.category?.categoryId && Number(priceUsd) > 0 && aspectsFilled && photoOk;

  // 売り方の選択：最安（eBay最安・最速・既定）/ はやく（相場-8%）/ 高く（相場どおり）。選ぶと価格を自動セット。
  // 相場の基準は中央値(medianUsd)。表示価格(priceUsd)は最安ベースなので、はやく/高くは中央値を基準に計算する。
  const medianUsd = Number(data?.medianUsd) || Number(data?.priceUsd) || 0;
  const lowUsd = Number(data?.lowestUsd) || 0;     // eBay同等品の現在の最安
  // 着地コスト(国際送料＋米国関税)は「重さ(任意)」入力で動的に再計算。未入力なら概算(data.landed.weightG)。
  // 関税の元値は編集中に動く価格でなく安定した推奨価格(data.priceUsd)を使う（損益分岐がタイプ中に揺れないように）。
  const estWeightG = data?.landed?.weightG ?? 700;
  const effWeightG = Number(weightInput) > 0 ? Number(weightInput) : estWeightG;
  const dutyValueUsd = Number(data?.priceUsd) || (data ? data.product.ebayAvgJpy / USD_JPY : 0);
  const liveLanded = data?.landed ? landedCostForWeight(effWeightG, dutyValueUsd) : null;
  // 損益分岐（これ未満は赤字・国際送料/関税込み）。effBuyJpy があれば重さに応じて再計算、無ければサーバー値。
  const floorUsd =
    data?.effBuyJpy != null && liveLanded
      ? Math.round((((data.effBuyJpy + 47 + liveLanded.subtractJpy) / (1 - 0.1325)) / USD_JPY) * 100) / 100
      : Number(data?.floorUsd) || 0;
  // 最適サイズ（自動選択中の配送ポリシー）と、その定額請求が実費をカバーできているかの判定。
  const recoChoice = data?.shipping?.find((s) => s.fulfillmentPolicyId === shippingId) || null;
  const recoRealJpy = liveLanded?.shippingJpy ?? 0;
  const recoChargeJpy = recoChoice ? Math.round(Number(recoChoice.costUsd) * USD_JPY) : 0;
  const recoCovers = recoChargeJpy >= recoRealJpy;
  const recoGapJpy = Math.max(0, recoRealJpy - recoChargeJpy);
  const lowestAvailable = lowUsd > 0;
  const lowestClamped = lowUsd > 0 && floorUsd > lowUsd; // eBay最安が赤字→損益分岐で出す
  const lowestTarget = lowUsd > 0 ? Math.max(lowUsd, floorUsd) : medianUsd > 0 ? medianUsd * (1 - FAST_DISCOUNT) : 0;
  // 「はやく」＝「最安」からさらに5%オフ（最速で売る）。ただし損益分岐(floor)は割らない。
  const fastTarget = lowestTarget > 0 ? Math.max(lowestTarget * (1 - FAST_UNDERCUT), floorUsd) : 0;
  const highTarget = medianUsd > 0 ? medianUsd * (1 + HIGH_MARKUP) : 0; // 高値出品＝eBay相場+10%
  const chooseStrategy = (s: "fast" | "market" | "lowest" | "high") => {
    setStrategy(s);
    if (s === "market") { const t = Math.max(medianUsd, floorUsd); if (t > 0) setPriceUsd(t.toFixed(2)); return; } // 相場でも損益分岐は割らない
    if (s === "high") { const t = Math.max(highTarget, floorUsd); if (t > 0) setPriceUsd(t.toFixed(2)); return; } // 高値でも損益分岐は割らない
    if (s === "fast") { if (fastTarget > 0) setPriceUsd(fastTarget.toFixed(2)); return; }
    if (lowestTarget > 0) setPriceUsd(lowestTarget.toFixed(2)); // 最安出品（損益分岐は割らない）
  };
  // 入力USD価格の日本円めやす（為替は固定155円＝アプリの換算と一致）。
  const priceJpy = Number(priceUsd) > 0 ? Math.round(Number(priceUsd) * USD_JPY) : 0;

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
        <div className="sticky top-0 bg-white border-b border-[#A98B5C]/25 px-4 py-3 flex items-center justify-between">
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
                  router.push(`/settings/ebay?list=${encodeURIComponent(product.id)}`);
                }}
                className="inline-flex items-center justify-center gap-1.5 h-12 px-7 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23]"
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
                    <img src={data.product.imageUrl} alt="" className="w-20 h-20 object-cover rounded-xl border border-[#A98B5C]/25" />
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
                <label className="block text-[11px] text-gray-500 mb-0.5">タイトル（英語）<ReqBadge /></label>
                <textarea
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, 80))}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl border border-[#A98B5C]/35 text-sm focus:outline-none focus:border-[#2D323B] resize-none"
                />
                <p className="text-[10px] text-gray-400 mt-0.5">{title.length}/80　自動で英語タイトルを入れています（編集OK）</p>
              </div>

              {/* 説明文（英語・編集可） */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">説明文（英語）<OptBadge /></label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 rounded-xl border border-[#A98B5C]/35 text-sm focus:outline-none focus:border-[#2D323B] resize-none leading-relaxed"
                />
              </div>

              {/* 状態 */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">商品の状態<OptBadge /></label>
                <select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-[#A98B5C]/35 text-sm bg-white focus:outline-none focus:border-[#2D323B]"
                >
                  <option value="NEW">新品（New）</option>
                  <option value="USED_EXCELLENT">中古 - 非常に良い</option>
                  <option value="USED_GOOD">中古 - 良い</option>
                </select>
              </div>

              {/* 出品に使う写真（楽天ギャラリーから選ぶ・先頭がメイン写真） */}
              {photoCandidates.length > 0 && (
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">
                    出品に使う写真（<b>タップした順に並びます</b>・先頭がメイン・{selectedImages.length}/{Math.min(photoCandidates.length, MAX_LISTING_PHOTOS)}枚）<ReqBadge />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {photoCandidates.map((u, i) => {
                      const idx = selectedImages.indexOf(u);
                      const checked = idx >= 0;
                      const disabled = !checked && selectedImages.length >= MAX_LISTING_PHOTOS;
                      return (
                        <div
                          key={i}
                          className={`relative aspect-square rounded-xl overflow-hidden border-[3px] transition-colors ${
                            checked ? "border-[#0064D2]" : "border-[#A98B5C]/30"
                          } ${disabled && !checked ? "opacity-50" : ""}`}
                        >
                          {/* 画像タップ＝そのまま選択（全部を大きく見て直接選べる） */}
                          <button
                            type="button"
                            onClick={() => togglePhoto(u)}
                            disabled={disabled}
                            aria-pressed={checked}
                            aria-label={checked ? `写真${i + 1}の選択を外す` : `写真${i + 1}を出品に使う`}
                            className="absolute inset-0 w-full h-full"
                          >
                            <img src={ebayPreviewSrc(u)} alt={`候補${i + 1}`} loading="lazy" className="w-full h-full object-contain bg-white" />
                          </button>
                          {/* 選択バッジ（左上・番号）。タップは下の画像ボタンに透過。 */}
                          <span
                            className={`absolute top-1 left-1 w-7 h-7 rounded-full text-sm font-black flex items-center justify-center pointer-events-none border ${
                              checked ? "bg-[#0064D2] text-white border-[#0064D2] shadow" : "bg-white/90 text-gray-400 border-gray-300"
                            }`}
                          >
                            {checked ? idx + 1 : "＋"}
                          </span>
                          {/* 右上＝さらにフルスクリーンで拡大（任意） */}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setZoomIndex(i); }}
                            aria-label={`写真${i + 1}をフルスクリーンで拡大`}
                            className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/45 text-white text-xs flex items-center justify-center"
                          >
                            🔍
                          </button>
                          {checked && <span className="absolute inset-0 rounded-lg ring-2 ring-inset ring-[#0064D2] pointer-events-none" />}
                          {idx === 0 && (
                            <span className="absolute bottom-0 inset-x-0 bg-[#0064D2] text-white text-[10px] font-bold text-center py-0.5 pointer-events-none">メイン</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">
                    写真は<b>タップした順に並びます</b>（最初の1枚がメイン・もう一度タップで解除）。各画像は<b>実際にeBayに出る加工後</b>です。🔍でさらに大きく確認（最大{MAX_LISTING_PHOTOS}枚）。実物が届いたら自分の写真に差し替えを。
                  </p>
                  {!photoOk && (
                    <p className="text-[11px] text-[#2D323B] bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 mt-1.5">
                      出品に使う写真を1枚以上選んでください。
                    </p>
                  )}

                  {/* 拡大プレビュー（横スワイプ）。モーダル本体が overflow-y-auto のため、その中に fixed を置くと
                      iOS等でスクロールコンテナに閉じ込められ、右上の×の当たり判定がズレて押せなくなる。
                      document.body へ portal してスクロールコンテナの外に出す（React のイベント伝播は保たれる）。 */}
                  {zoomIndex !== null && createPortal(
                    <div className="fixed inset-0 z-[120] bg-black/90 flex flex-col" onClick={() => setZoomIndex(null)}>
                      <button
                        type="button"
                        onClick={() => setZoomIndex(null)}
                        aria-label="閉じて出品画面に戻る"
                        className="absolute top-3 right-3 z-10 w-11 h-11 rounded-full bg-black/55 border border-white/50 text-white flex items-center justify-center active:bg-black/75 shadow-lg"
                      >
                        <X size={26} />
                      </button>
                      <div className="px-4 py-3 text-xs text-white/70" onClick={(e) => e.stopPropagation()}>← 横にスワイプして確認・選択 ／ 右上 ✕ で閉じる →</div>
                      <div ref={carouselRef} className="flex-1 flex overflow-x-auto snap-x snap-mandatory" onClick={(e) => e.stopPropagation()}>
                        {photoCandidates.map((u, i) => {
                          const idx = selectedImages.indexOf(u);
                          const checked = idx >= 0;
                          const disabled = !checked && selectedImages.length >= MAX_LISTING_PHOTOS;
                          return (
                            <div key={i} className="w-full min-w-0 shrink-0 snap-center flex flex-col items-center justify-center gap-3 px-4">
                              <p className="text-[11px] text-white/70 text-center">
                                {i + 1} / {photoCandidates.length}・実際にeBayに出る画像{checked ? `（選択中・${idx + 1}枚目${idx === 0 ? "・メイン" : ""}）` : ""}
                              </p>
                              <img src={ebayPreviewSrc(u)} alt={`写真${i + 1}`} className="max-w-full max-h-[58vh] object-contain bg-white rounded" />
                              <button
                                type="button"
                                onClick={() => togglePhoto(u)}
                                disabled={disabled}
                                className={`w-[90%] max-w-md h-12 rounded-xl font-black text-sm ${
                                  checked ? "bg-white text-[#0064D2]" : disabled ? "bg-white/20 text-white/50" : "bg-[#0064D2] text-white active:bg-[#0052ab]"
                                }`}
                              >
                                {checked ? "✓ 出品画像から外す" : disabled ? `上限${MAX_LISTING_PHOTOS}枚に達しています` : "＋ この写真を出品に使う"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>,
                    document.body
                  )}
                </div>
              )}

              {/* 売り方（激安出品=最安-5% / 最安出品=最安値 / 相場出品=eBay相場 / 高値出品=相場+10%）。既定は最安出品 */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">売り方<OptBadge /></label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => chooseStrategy("fast")}
                    aria-pressed={strategy === "fast"}
                    className={`flex flex-col items-center justify-center h-14 rounded-xl border transition-colors ${
                      strategy === "fast" ? "border-[#2D323B] bg-[#2D323B]/5 text-[#2D323B]" : "border-[#A98B5C]/35 text-gray-500"
                    }`}
                  >
                    <span className="text-[12px] font-bold">⚡ 激安出品</span>
                    <span className="text-[10px]">最安−5%</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseStrategy("lowest")}
                    aria-pressed={strategy === "lowest"}
                    className={`flex flex-col items-center justify-center h-14 rounded-xl border transition-colors ${
                      strategy === "lowest" ? "border-[#2D323B] bg-[#2D323B]/5 text-[#2D323B]" : "border-[#A98B5C]/35 text-gray-500"
                    }`}
                  >
                    <span className="text-[12px] font-bold">🔽 最安出品</span>
                    <span className="text-[10px]">最安値と同額</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseStrategy("market")}
                    aria-pressed={strategy === "market"}
                    className={`flex flex-col items-center justify-center h-14 rounded-xl border transition-colors ${
                      strategy === "market" ? "border-[#2D323B] bg-[#2D323B]/5 text-[#2D323B]" : "border-[#A98B5C]/35 text-gray-500"
                    }`}
                  >
                    <span className="text-[12px] font-bold">📊 相場出品</span>
                    <span className="text-[10px]">eBay相場</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseStrategy("high")}
                    aria-pressed={strategy === "high"}
                    className={`flex flex-col items-center justify-center h-14 rounded-xl border transition-colors ${
                      strategy === "high" ? "border-[#2D323B] bg-[#2D323B]/5 text-[#2D323B]" : "border-[#A98B5C]/35 text-gray-500"
                    }`}
                  >
                    <span className="text-[12px] font-bold">💎 高値出品</span>
                    <span className="text-[10px]">相場+10%</span>
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">
                  {strategy === "fast"
                    ? "eBay最安よりさらに5%安く。最速で売れやすい（おすすめ・損益分岐は割りません）"
                    : strategy === "high"
                    ? "eBay相場より10%高く。利益重視（売れるまで時間はかかります）"
                    : strategy === "market"
                    ? "eBay相場（中央値）どおりの価格。売れるまで少し待ちます"
                    : !lowestAvailable
                    ? "eBayの最安が取れなかったため、相場より少し安くしています"
                    : lowestClamped
                    ? `eBayの最安は赤字になるため、損益分岐 $${data.floorUsd} で出します（赤字回避）`
                    : "eBay最安値と同額。最速で売れやすくします（赤字にはしません）"}
                </p>
              </div>

              {/* 価格 */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">販売価格（USD）<ReqBadge /></label>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-sm">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={priceUsd}
                    onChange={(e) => setPriceUsd(e.target.value)}
                    className="flex-1 h-10 px-3 rounded-xl border border-[#A98B5C]/35 text-sm focus:outline-none focus:border-[#2D323B]"
                  />
                </div>
                {priceJpy > 0 && (
                  <p className="text-[12px] text-[#2D323B] font-bold mt-1">≒ {formatJpy(priceJpy)}（日本円のめやす）</p>
                )}
                <p className="text-[10px] text-gray-400 mt-0.5">eBay相場の目安：{formatJpy(data.product.ebayAvgJpy)}</p>
                {/* 着地コスト（国際送料・米国関税）の内訳＋重さ(任意)入力。損益分岐に織り込み済み。
                    重さは分かれば入力するとより正確に（未入力はカテゴリ概算）。 */}
                {liveLanded && (
                  <div className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
                    {!showWeight ? (
                      <button
                        type="button"
                        onClick={() => setShowWeight(true)}
                        className="text-gray-500 underline underline-offset-2 active:text-gray-700 mb-1"
                      >
                        ＋ 重さを入力して送料を正確にする（任意）
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5 mb-1">
                        <label className="text-gray-500">重さ（g）<OptBadge /></label>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={weightInput}
                          onChange={(e) => setWeightInput(e.target.value)}
                          placeholder={`概算${estWeightG}`}
                          className="w-24 h-8 px-2 rounded-lg border border-[#A98B5C]/35 text-[12px] focus:outline-none focus:border-[#2D323B]"
                        />
                        <span>梱包込み（未入力は安全側で少し重め）</span>
                      </div>
                    )}
                    📦 国際送料の目安 {formatJpy(liveLanded.shippingJpy)}（
                    {liveLanded.shippingMethod === "ems" ? "EMS・補償あり" : "エアパケット・追跡のみ"}／
                    {Number(weightInput) > 0 ? `入力${effWeightG}` : `概算${effWeightG}`}g）＝<b className="text-gray-500">購入者が負担</b>
                    {liveLanded.needsDutyPrepay && (
                      <span className="block text-amber-600 font-bold mt-0.5">
                        🛃 米国関税(前払い) {formatJpy(liveLanded.dutyJpy)}・$100超はZonosで関税を前払い＋指定郵便局からの発送が必要です
                      </span>
                    )}
                    <span className="block mt-0.5">
                      ※ 損益分岐に入れるのは<b className="text-gray-500">関税{liveLanded.needsDutyPrepay ? "" : "(この価格は不要)"}＋送料にかかるeBay手数料</b>のみ。送料そのものは購入者負担です。
                    </span>
                  </div>
                )}
                {floorUsd > 0 && Number(priceUsd) > 0 && Number(priceUsd) < floorUsd && (
                  <p className="text-[11px] text-[#2D323B] bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 mt-1.5 leading-relaxed">
                    ⚠️ 損益分岐 ${floorUsd.toFixed(2)} を下回っています。このままだと赤字の恐れがあります。
                  </p>
                )}
              </div>

              {/* 値下げ交渉（Best Offer）の自動対応 */}
              <div className="rounded-xl border border-[#A98B5C]/35 p-2.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bestOffer}
                    onChange={(e) => setBestOffer(e.target.checked)}
                    className="accent-[#2D323B] w-4 h-4"
                  />
                  <span className="text-xs font-bold text-gray-700">値下げ交渉（Best Offer）を受け付ける<OptBadge /></span>
                </label>
                {bestOffer && Number(priceUsd) > 0 && (
                  <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                    ${(Number(priceUsd) * 0.9).toFixed(2)}（{formatJpy(Math.round(Number(priceUsd) * 0.9 * USD_JPY))}）以上のオファーは<b>自動承諾</b>（10%引きまで即売）
                    {floorUsd > 0 && floorUsd < Number(priceUsd) * 0.9 && (
                      <>／ 損益分岐 ${floorUsd.toFixed(2)}（{formatJpy(Math.round(floorUsd * USD_JPY))}）未満は<b>自動拒否</b></>
                    )}
                  </p>
                )}
              </div>

              {/* 出品する個数（在庫数） */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">出品する個数（在庫数）<OptBadge /></label>
                <select
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-xl border border-[#A98B5C]/35 text-sm bg-white focus:outline-none focus:border-[#2D323B]"
                >
                  {[...Array(30)].map((_, i) => (
                    <option key={i + 1} value={i + 1}>{i + 1}個</option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-400 mt-0.5">在庫数。1個だけならそのままでOK（最大30）</p>
              </div>

              {/* 送料サイズ（アプリが重さ・価格から最適サイズを自動選択。実費カバーを明示） */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">送料（荷物のサイズ）<OptBadge /><span className="ml-1 text-[9px] text-gray-400">最適サイズを自動選択</span></label>
                {data.shipping.length > 0 ? (
                  <>
                    {recoChoice && (
                      <div className={`rounded-xl px-3 py-2 mb-1.5 text-[11px] leading-relaxed border ${recoCovers ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
                        📦 この商品の最適サイズ：<b className="text-gray-800">{shippingLabel(recoChoice.name)}</b>
                        （{liveLanded?.shippingMethod === "ems" ? "EMS・補償あり" : "エアパケット"}・約{effWeightG}g）<br />
                        設定送料 <b>${recoChoice.costUsd}</b> ／ 実費の目安 {formatJpy(recoRealJpy)}
                        {recoCovers ? (
                          <b className="text-emerald-700"> → ✅ カバーできています（赤字になりません）</b>
                        ) : (
                          <b className="text-amber-700"> → ⚠️ 約{formatJpy(recoGapJpy)}不足（利益計算には反映済み。「大」の送料を上げると安心です）</b>
                        )}
                      </div>
                    )}
                    <select
                      value={shippingId}
                      onChange={(e) => setShippingId(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl border border-[#A98B5C]/35 text-sm bg-white focus:outline-none focus:border-[#2D323B]"
                    >
                      {data.shipping.map((s) => (
                        <option key={s.fulfillmentPolicyId} value={s.fulfillmentPolicyId}>
                          {shippingLabel(s.name)}（{shippingHint(s.name)}・${s.costUsd}）{s.fulfillmentPolicyId === data.recommendedShippingId ? "（おすすめ）" : ""}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <p className="text-[12px] text-[#2D323B] bg-red-50 rounded-xl px-3 py-2">
                    配送ポリシーが見つかりません。設定で「発送設定」を完了してください。
                  </p>
                )}
                <p className="text-[10px] text-gray-400 mt-0.5">送料は購入者負担。重さ・価格から最適サイズを自動で選んでいます（変更も可）。</p>
              </div>

              {/* 発送までの日数（handling time） */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5 flex items-center gap-1">
                  <Clock size={12} className="text-gray-400" />発送までの日数（落札後に発送するまで）<OptBadge />
                </label>
                <select
                  value={handlingDays}
                  onChange={(e) => setHandlingDays(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-xl border border-[#A98B5C]/35 text-sm bg-white focus:outline-none focus:border-[#2D323B]"
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
                  <p className="text-[12px] text-[#2D323B] bg-red-50 rounded-xl px-3 py-2">
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
                  const base = `w-full h-9 px-2.5 rounded-lg border text-[13px] focus:outline-none focus:border-[#2D323B] ${showRed ? "border-red-300 bg-red-50/40" : "border-[#A98B5C]/35"}`;
                  return (
                    <div key={a.name}>
                      <span className="block text-[10px] text-gray-400 mb-0.5">{aspectLabel(a.name)}{a.required ? (empty && <span className="text-[#2D323B]"> ※必須</span>) : <span className="text-gray-400"> （任意）</span>}</span>
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
                      <div className="border-t border-[#A98B5C]/25 pt-2.5">
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

              {/* 海外出品の不安をやわらげる一言 */}
              <p className="text-[11px] text-gray-600 bg-[#F5F7FA] border border-[#A98B5C]/25 rounded-lg px-3 py-2 leading-relaxed">
                🌏 英語の説明は自動入力ずみ。購入者とのやり取りも定型文でOK。売れたら<b>日本の郵便局から送るだけ</b>です。
              </p>

              {/* 必須項目が未入力の時の案内（公開エラー#25002の予防） */}
              {!aspectsFilled && (
                <p className="text-[11px] text-[#2D323B] bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  ⚠️ 上の「商品の詳細（必須）」に未入力があります。候補から選ぶと出品できます。
                </p>
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
            <div className="py-10 flex flex-col items-center justify-center gap-3 text-center">
              <span className="w-8 h-8 border-[3px] border-[#A98B5C]/35 border-t-[#0064D2] rounded-full animate-spin" aria-hidden="true" />
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
              {/* “勝ちの瞬間”の損失回避ナッジ。未ログイン時に1回だけ・閉じれるチップ（達成表示の最後に置く）。 */}
              <div className="mb-2 text-left">
                <SaveProgressNudge
                  from="listing"
                  once="rr_nudge_listing"
                  message="🎉 初出品おめでとう！この出品と成績は“この端末だけ”に保存中。ログインしておくと機種変・別端末でも消えません。"
                />
              </div>
              <button onClick={onClose} className="w-full h-11 border border-[#A98B5C]/35 rounded-xl text-sm font-bold text-gray-600">
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

              {/* 「登録の壁」は他社サポート(ココナラ等)で突破するのが近道、という後押し。自力で消耗させない方針。 */}
              <div className="bg-[#FFF7ED] border border-amber-200 rounded-xl px-3.5 py-3 mb-4 text-left">
                <p className="text-[12px] text-amber-900 leading-relaxed">
                  💪 ここが<b>最初の関門</b>。でも<b>登録は一度きり</b>、<b>詳しい人に頼めば60分ほど</b>で終わります。
                  ここでつまずいて<b>下の図のような将来</b>をあきらめるのは、もったいなさすぎます。
                  <br />
                  自力で粘って消耗するより、<b>ココナラ（他社サービス）でベテランにサポートしてもらって一気に越える</b>のが近道です。この壁さえ越えれば、あとは<b>アプリのワンタップ出品</b>で世界に売っていけます。応援しています！
                </p>
                <a
                  href={COCONALA_HREF}
                  target="_blank"
                  rel="sponsored noopener noreferrer"
                  onClick={() => {
                    track("coconala_click", { product_id: product.id });
                    // 押した時点で検索ワードをコピーしておく（ココナラの検索窓にすぐ貼れる）。
                    if (!COCONALA_PRESEARCHED) { try { navigator.clipboard.writeText(COCONALA_KEYWORD); } catch { /* noop */ } }
                  }}
                  className="mt-2.5 w-full inline-flex items-center justify-center gap-1.5 h-11 bg-white border border-amber-300 text-amber-800 font-bold text-[13px] rounded-xl active:bg-amber-100"
                >
                  ココナラでセラー登録のサポートを探す <ExternalLink size={14} />
                </a>
                {/* 通常リンクは検索済みで着地しないため、検索ワードを貼り付けて探すよう明確に誘導（検索着地リンクなら不要）。 */}
                {!COCONALA_PRESEARCHED && (
                  <div className="mt-2 bg-white/60 border border-amber-200 rounded-lg px-3 py-2.5">
                    <p className="text-[11px] text-amber-900 leading-relaxed mb-1.5">
                      ココナラが開いたら、<b>検索まどに下のワードを貼り付けて検索</b>してください👇（このボタンを押すと自動でコピーされます）
                    </p>
                    <CopyKeyword value={COCONALA_KEYWORD} />
                  </div>
                )}
                {/* アフィリエイト時はステマ規制対応で「広告」を明示。A8.net等はインプレ計測の1x1画像も置く。 */}
                {COCONALA_IS_AD && (
                  <div className="mt-1 flex items-center justify-end">
                    <span className="text-[10px] text-amber-700/70">広告（ココナラ）</span>
                    {COCONALA_AFFILIATE_IMG && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={COCONALA_AFFILIATE_IMG} width={1} height={1} alt="" className="absolute opacity-0" />
                    )}
                  </div>
                )}
              </div>

              {/* 収益の複利イメージ（10万円→毎月+10%）。断定額ではなく「イメージ図」＋免責で誇大表現を回避。 */}
              <div className="bg-white border border-[#A98B5C]/25 rounded-xl px-3 pt-3 pb-2 mb-4">
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
                  <p className="mb-2 text-[11px] text-[#2D323B] leading-relaxed">
                    まだ登録が完了していません。eBayから〈アカウントの準備ができました〉のメールが届いてから押してください。
                  </p>
                )}
                <button onClick={onClose} className="w-full h-10 text-sm font-bold text-gray-500">あとで</button>
              </div>
            </div>
          )}

          {phase === "limit" && (
            <div className="py-6 text-center">
              <Crown size={36} className="mx-auto mb-3 text-[#A98B5C]" />
              <p className="text-sm font-bold text-gray-800 mb-2">出品の上限に達しました</p>
              <p className="text-[12px] text-gray-600 leading-relaxed mb-1 px-2">
                {result?.error || "現在のプランの同時出品上限に達しました。"}
              </p>
              <p className="text-[12px] text-gray-500 leading-relaxed mb-4">
                上のプランにすると、もっと多く同時に出品できます（スタンダード50件／プロ100件）。
              </p>
              <a
                href="/pricing"
                className="flex items-center justify-center gap-1.5 w-full h-12 bg-[#2D323B] text-white rounded-xl text-sm font-black active:bg-[#1A1D23] mb-2"
              >
                <Crown size={16} /> プランをアップグレード →
              </a>
              <button onClick={onClose} className="w-full h-11 bg-gray-100 rounded-xl text-sm font-bold text-gray-600">
                閉じる
              </button>
            </div>
          )}

          {phase === "error" && (
            <div className="py-6">
              <AlertTriangle size={36} className="mx-auto mb-3 text-[#2D323B]" />
              <p className="text-sm font-bold text-gray-800 text-center mb-2">出品できませんでした</p>
              <p className="text-[12px] text-[#2D323B] text-center mb-3 leading-relaxed break-words">{msg}</p>
              {result?.errorKind !== "known" && result?.steps && result.steps.length > 0 && (
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
                  {result?.errorKind !== "known" && <li>それでも直らなければ、下のボタンで報告してください</li>}
                </ul>
              </div>
              {/* 予期せぬエラーのときだけ「開発者に報告」を出す（既知エラーは要因が分かっているので不要）。 */}
              {result?.errorKind !== "known" && (
                <>
                  <button
                    type="button"
                    onClick={reportError}
                    disabled={reportState !== "idle"}
                    className="w-full h-11 mb-2 bg-[#2D323B] text-white rounded-xl text-sm font-bold active:bg-[#1A1D23] disabled:opacity-50"
                  >
                    {reportState === "idle" ? "🛠 このエラーを開発者に報告" : reportState === "sending" ? "送信中..." : "✓ 報告しました。ありがとうございます！"}
                  </button>
                  {reportState === "done" && (
                    <p className="text-[11px] text-gray-500 text-center mb-2">内容を確認して修正します。直ったら再度お試しください。</p>
                  )}
                </>
              )}
              <div className="flex gap-2">
                {/* 入力フォームがある時だけ「入力に戻る」。初回準備の失敗（data無し）では空フォームになるため出さない。 */}
                {data && (
                  <button onClick={() => { setPhase("form"); setResult(null); }} className="flex-1 h-11 border border-[#A98B5C]/35 rounded-xl text-sm font-bold text-gray-600">
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
