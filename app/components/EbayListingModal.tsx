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
import { computePriceModelTotal, netAtTotalJpy } from "../lib/ebay/priceModel";
import { ebayFeeRate, ebayFeeFixedJpy } from "../lib/ebay/landedCostCore.mjs"; // 手数料内訳表示用の実効率(時計15%等)
import { readListingDefaults } from "../lib/prefs"; // 出品の既定値（Best Offer・発送までの日数）
import { reportClientError, errToDetail } from "../lib/clientError";

interface RequiredAspect { name: string; values: string[]; free: boolean; required: boolean; value: string }
interface ShippingChoice { fulfillmentPolicyId: string; name: string; costUsd: string }
interface PrepareData {
  product: { id: string; jaTitle: string; imageUrl: string; rakutenPrice: number; ebayAvgJpy: number };
  title: string;
  description: string;
  priceUsd: string;
  medianUsd?: string;        // 中央値USD（売り方「相場/はやく」の基準）
  lowestUsd?: string | null; // 同等品の現在の最安USD（最速出品用）
  competitionCount?: number | null; // eBay現在出品総数＝競合の目安（概算・null=取得不可）
  floorUsd?: string;         // 損益分岐USD（これ未満は赤字・国際送料/関税の目安を織り込み済み）
  effBuyJpy?: number;        // 実質仕入れ原価。重さ(任意)入力時に損益分岐をクライアントで再計算するのに使う
  feeCategory?: string;      // 手数料率(時計15%等)をクライアント再計算でも正しく使うためのジャンル
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
  refImages?: string[];     // カタログのギャラリー画像(自宅ワーカー取得・出品/撮影の候補)
  productImages?: string[]; // カタログの代表画像(常に最低1枚)
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
  return <span className="ml-1 align-middle text-[10px] font-bold text-[#2D323B] bg-[#A98B5C]/15 border border-[#A98B5C]/40 rounded px-1 py-px">必須</span>;
}
function OptBadge() {
  return <span className="ml-1 align-middle text-[10px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-1 py-px">任意</span>;
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
  needsPlan?: boolean; // free(プラン未加入)で出品不可（プラン加入の導線を出す。上限到達とは区別）
  planNeeded?: string; // 必要なプラン。"promax"=eBay自動出品はプロMAX限定（文言の出し分けに使う）
}

type Phase = "loading" | "setup" | "form" | "publishing" | "done" | "notready" | "error" | "limit";

// 価格(±0/最安/中央/高値)の算出は SSOT(computePriceModel) に一本化。商品管理(priceTiers)と同じ式・同じ入力＝食い違わない。
// FAST_DISCOUNT(最安=中央値-8%)/HIGH_MARKUP(高値=+10%) も SSOT から import（旧:ローカル定数）。
// USD_JPY は SSOT(landedCostCore・env駆動/既定155)から import に統一（クライアントでは既定155に解決）。

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
  onBehalfOf,
  dropship = false,
}: {
  product: ProfitProduct;
  onClose: () => void;
  onListed?: () => void;
  onBehalfOf?: string; // チーム共有：オーナー名義で出品する時のオーナーactor
  dropship?: boolean; // 無在庫出品（仕入れ前にeBay出品）＝プロMAX以上限定。publishへ dropship:true を送り、サーバーでも権限を再判定させる。
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<PrepareData | null>(null);
  const [title, setTitle] = useState(product.coreKeyword || product.title);
  const [description, setDescription] = useState("");
  const [priceUsd, setPriceUsd] = useState(""); // 内部はUSD（eBayは$建て）。表示/入力は円。
  const [priceYen, setPriceYen] = useState(""); // 本体価格の円入力（表示用。priceUsd と同期）
  const [weightInput, setWeightInput] = useState(""); // 重さ(任意・g・梱包込み)。入力すると送料/損益分岐を再計算
  const [showWeight, setShowWeight] = useState(false); // 重さ入力欄は既定で隠し、押したら開く
  const [acceptLoss, setAcceptLoss] = useState(false); // 損益分岐を下回る価格でも「承知の上で」確認した時だけ出品可（警告＋確認で続行）
  // 価格の選び方：breakeven(±0=育成) / custom(自由入力) / low(最安) / median(中央値) / high(高値)。既定=最安（最速・カード表示と一致）。
  const [strategy, setStrategy] = useState<"breakeven" | "custom" | "low" | "median" | "high">("median");
  const [condition, setCondition] = useState("NEW");
  const [shippingId, setShippingId] = useState("");
  // 送料の出し方: true=送料込み(価格に上乗せして「送料無料」表示) / false=送料別(購入者が送料を払う)。
  // 送料無料は総額が同じでも eBay検索(総額順)・バイヤー心理で有利＝既定ON（送料無料ポリシーが無い口座では自動的に送料別へフォールバック）。
  const [freeShip, setFreeShip] = useState(true);
  // 発送までの日数は「出品の既定値」（設定で保存・端末単位）を初期値に使う。
  const [handlingDays, setHandlingDays] = useState(() => readListingDefaults().handlingDays);
  const [quantity, setQuantity] = useState(1); // 出品する個数（在庫数。既定1）
  const [aspects, setAspects] = useState<Record<string, string>>({});
  const [selectedImages, setSelectedImages] = useState<string[]>([]); // 出品に使う写真URL（先頭=メイン・チェックで選択）
  // 候補のうち「読み込めない/明らかに低解像度(<300px)」を非表示にする集合。クライアントで実寸を見て判定＝
  // 関係ない別商品のサムネや粗い画像を候補から落とす（ユーザー要望：明らかに解像度が悪い/関係ない画像は出さない）。
  const [badPhotos, setBadPhotos] = useState<Set<string>>(new Set());
  const markBadPhoto = (u: string) => {
    setBadPhotos((s) => (s.has(u) ? s : new Set(s).add(u)));
    setSelectedImages((cur) => cur.filter((x) => x !== u)); // 低解像度と判明した選択は外す
  };
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
    // ★実際に選んでいる価格(priceUsd)でEMS判定する。中央値/高値で$120を跨いだら大サイズ(EMS)へ自動で上げる(送料負け防止)。
    const v = Number(priceUsd) || Number(data.priceUsd) || data.product.ebayAvgJpy / USD_JPY;
    const id = pickShippingPolicyId(data.shipping, recommendShippingTier(w, v));
    if (id) setShippingId(id);
  }, [weightInput, data, priceUsd]);
  const [showOptional, setShowOptional] = useState(false); // おすすめ(任意)項目を開いて編集するか（既定は閉じる＝自動入力のまま）
  const [showAdv, setShowAdv] = useState(false); // 詳細オプション（説明文/状態/売り方/送料/個数など）を開くか。既定は閉じて最小表示＝写真・タイトル・価格だけ。
  const [result, setResult] = useState<PublishResult | null>(null);
  const [msg, setMsg] = useState("");
  const [confirming, setConfirming] = useState(false); // 「登録完了」処理中
  const [confirmErr, setConfirmErr] = useState(false); // 「登録完了」後も未登録だった
  const [cooldown, setCooldown] = useState(0); // 「登録完了」失敗後のクールダウン秒数
  const [reportState, setReportState] = useState<"idle" | "sending" | "done">("idle"); // 開発者に報告
  const [pubStep, setPubStep] = useState(0); // 出品中の擬似ステップ表示（時間ベースで順送り・体感の待ち軽減）
  const dialogRef = useRef<HTMLDivElement>(null); // フォーカストラップ＆初期フォーカス用のダイアログ本体

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
      const p: PrepareData & { ok?: boolean; error?: string; connected?: boolean; fetchFailed?: boolean } = await fetch("/api/ebay/list/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id, onBehalfOf }),
      })
        .then((r) => r.json())
        .catch((e) => {
          reportClientError("ebay_list_prepare", { action: "list_prepare", endpoint: "/api/ebay/list/prepare", status: 0, productId: product.id, detail: `fetch例外: ${errToDetail(e)}` });
          return { ok: false, fetchFailed: true }; // fetch例外は↑で報告済み＝下の非ok分岐で二重報告しない目印
        });
      if (!alive) return;
      // 連携が切れていたら（読み込み中にトークン失効など）再連携へ誘導
      if (p.connected === false) {
        setPhase("setup");
        return;
      }
      if (!p.ok) {
        // fetch例外(fetchFailed)は.catchで報告済み。ここはサーバが非okを返した場合だけ報告する。
        if (!p.fetchFailed) reportClientError("ebay_list_prepare", { action: "list_prepare", endpoint: "/api/ebay/list/prepare", status: 0, productId: product.id, detail: p.error || "(no detail)" });
        setMsg(p.error || "出品準備に失敗しました。");
        setPhase("error");
        return;
      }
      setData(p);
      setTitle(p.title);
      setDescription(p.description);
      // 既定は「中央値」＝過去落札の中央値（損益分岐は割らない）。取れなければ最安→相場（ユーザー指示2026-06-27）。
      {
        const lowU = Number(p.lowestUsd) || 0;
        const floorU = Number(p.floorUsd) || 0;
        const medU = Number(p.medianUsd) || Number(p.priceUsd) || 0;
        const initMedian = medU > 0 ? Math.max(medU, floorU) : lowU > 0 ? Math.max(lowU, floorU) : Number(p.priceUsd) || 0;
        setPriceUsd(initMedian.toFixed(2));
        setPriceYen(initMedian > 0 ? String(Math.round(initMedian * USD_JPY)) : "");
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
      // 出品写真：候補を既定で最大MAX_LISTING_PHOTOS枚まで選択（先頭=メイン）。不要なら再タップで解除・並べ替えはタップ順。
      const cands = Array.from(new Set([...(p.refImages ?? []), ...(p.productImages ?? [])])).filter(Boolean);
      setSelectedImages(cands.slice(0, MAX_LISTING_PHOTOS));
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

  // 出品中(10〜20秒)の擬似ステップ表示。実際の進捗ではなく時間ベースで順送りし、待ち時間の不安をやわらげる。
  // pubStep の初期化は publish() 側で行い、ここでは publishing 中のみタイマーで進める（effect内の同期setStateを避ける）。
  useEffect(() => {
    if (phase !== "publishing") return;
    const a = setTimeout(() => setPubStep(1), 3500);  // 画像を最適化中
    const b = setTimeout(() => setPubStep(2), 8000);  // カテゴリ・項目を設定中
    const c = setTimeout(() => setPubStep(3), 13000); // eBayに登録中
    return () => { clearTimeout(a); clearTimeout(b); clearTimeout(c); };
  }, [phase]);

  // Escで閉じる（出品中・登録確認中は実行を取りこぼさないため無視）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (phase === "publishing" || confirming) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [phase, confirming, onClose]);

  // 開いた時にダイアログ先頭へフォーカス＋Tabをダイアログ内でループする簡易フォーカストラップ。
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    el.focus(); // 先頭（ダイアログ本体）へフォーカス
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = el.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) { e.preventDefault(); el.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || active === el) { e.preventDefault(); last.focus(); }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [phase]);

  // 準備済みの内容で出品APIを叩く（publish と「登録完了」で共有）。
  const postPublish = (): Promise<PublishResult> => {
    // 価格は「総額(買い手の支払=申告価値)」基準。送料無料モード＝eBay掲載価格=総額そのまま(送料を別請求しない＝検索の総額順/心理で有利)。
    // 送料別モード＝eBay商品価格=総額−送料で出し送料を別請求＝買い手の総額は同じ。送料無料ポリシーが無ければ自動で送料別。
    const freePol = data?.shipping?.find((s) => Number(s.costUsd) < 0.01) || null;
    const selPol = data?.shipping?.find((s) => s.fulfillmentPolicyId === shippingId) || null;
    const useFree = freeShip && !!freePol;
    const shipChargeUsd = Number(selPol?.costUsd || 0);
    const itemPriceUsd = useFree ? Number(priceUsd || 0) : Math.max(0.01, Number(priceUsd || 0) - shipChargeUsd);
    return fetch("/api/ebay/list/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: product.id,
        title,
        description,
        priceUsd: itemPriceUsd.toFixed(2), // 総額基準：送料無料=総額そのまま／送料別=総額−送料(商品価格)
        condition,
        categoryId: data?.category?.categoryId,
        aspects,
        fulfillmentPolicyId: useFree ? freePol.fulfillmentPolicyId : shippingId, // 送料込みは送料無料ポリシー
        handlingDays,
        quantity,
        selectedImages, // 出品に使う写真（先頭=メイン）
        onBehalfOf, // チーム共有：オーナー名義で出品
        totalUsd: Number(priceUsd || 0).toFixed(2), // 買い手総額(送料込み)＝サーバー赤字ガードが損益分岐と照合する基準
        acceptLoss, // 損益分岐未満を承知のうえで出品（チェック時のみtrue。サーバーの赤字ガードを通す）
        dropship, // 無在庫出品＝サーバーがプロMAX以上か再判定する（未満は403）
      }),
    })
      .then((r) => r.json())
      .catch((e) => {
        reportClientError("ebay_publish_error", { action: "ebay_publish", endpoint: "/api/ebay/list/publish", status: 0, productId: product.id, detail: `fetch例外: ${errToDetail(e)}` });
        return { ok: false, error: "通信に失敗しました。" };
      });
  };

  const finishOk = (res: PublishResult) => {
    setResult(res);
    track("ebay_list_published", { product_id: product.id });
    logEvent("listed"); // 出品成功（ファネル計測）
    setPhase("done");
    onListed?.();
  };

  const publish = async () => {
    setPubStep(0); // 擬似ステップを最初から
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
    if (res.needsPlan || res.planLimitReached) { setResult(res); setPhase("limit"); return; } // プラン未加入 or 上限到達→「壁」画面（中で出し分け）
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
    else if (res.needsPlan || res.planLimitReached) { setResult(res); setPhase("limit"); } // プラン未加入 or 上限到達→「壁」画面（中で出し分け）
    else {
      setConfirmErr(true);
      setCooldown(40); // 失敗後は数十秒待ってから再試行（メール到着前の連打を抑止）
    }
  };

  // 必須Item Specifics（Type等）が全て埋まっているか。未入力だと公開が #25002 で弾かれるため出品をブロック。
  // 推奨(任意)項目は空でも公開できるのでブロック対象外。
  const aspectsFilled = (data?.requiredAspects ?? []).filter((a) => a.required).every((a) => (aspects[a.name] ?? "").trim() !== "");
  // 詳細オプションの開閉。必須項目が未入力の時は強制で開く（隠れて出品できない原因にならないように）。
  const advOpen = showAdv || !aspectsFilled;

  // 出品写真の候補（カタログのギャラリー画像＋代表画像・重複除去）。ユーザーがチェックで選ぶ。
  const photoCandidates = Array.from(new Set([...(data?.refImages ?? []), ...(data?.productImages ?? [])]))
    .filter(Boolean)
    .filter((u) => !badPhotos.has(u)); // 低解像度/読み込み不可と判定した候補は出さない
  // 拡大プレビューは「実際にeBayへ送る加工後画像」を出す（clean-img の list=1＝enhanceToEpsと同一加工）＝WYSIWYG。
  // プロキシはレガシー画像ホスト(rakuten.co.jp|r10s.jp)のみ許可なので、その画像だけ通し、それ以外は元URL。
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
  // $800超は米国向けDDP郵便ルートで発送不可＝売れても出荷不能(キャンセル/defect)になるため出品をブロックする(総額=priceUsdで判定)。
  const aboveDdpMax = Number(priceUsd) > 800;
  const canPublish = !!data?.category?.categoryId && Number(priceUsd) > 0 && aspectsFilled && photoOk && !aboveDdpMax;

  // 売り方の選択：最安（eBay最安・最速・既定）/ はやく（相場-8%）/ 高く（相場どおり）。選ぶと価格を自動セット。
  // 相場の基準は中央値(medianUsd)。表示価格(priceUsd)は最安ベースなので、はやく/高くは中央値を基準に計算する。
  const medianUsd = Number(data?.medianUsd) || Number(data?.priceUsd) || 0;
  // 着地コスト(国際送料＋米国関税)は「重さ(任意)」入力で動的に再計算。未入力なら概算(data.landed.weightG)。
  // 関税/EMSの元値は「実際にユーザーが出す価格(priceUsd)」を使う。推奨価格固定だと $100(関税)/$120(EMS) の境界を
  // またいで価格を変えた時に floor が実態とズレ、過剰/過少な赤字警告になる（修正前の不具合）。空欄/タイプ途中は推奨価格へフォールバック。
  const estWeightG = data?.landed?.weightG ?? 700;
  const effWeightG = Number(weightInput) > 0 ? Number(weightInput) : estWeightG;
  // ★価格は全て「総額(eBay掲載価格=買い手の支払=申告価値・priceUsd)」基準。関税/EMS/送料の閾値も総額で評価する
  //   ＝実際の送料method($120EMS)/米国関税($100)/eBay手数料と一致＝閾値を跨ぐ品も損益分岐に正しく織り込み、絶対に赤字にならない。
  const dutyValueUsd = Number(priceUsd) || Number(data?.priceUsd) || (data ? data.product.ebayAvgJpy / USD_JPY : 0);
  const liveLanded = data?.landed ? landedCostForWeight(effWeightG, dutyValueUsd) : null;
  // 価格モデル(SSOT・総額基準)＝±0/最安/中央/高値を一括算出。各段は自身の総額で損益分岐を割らないクランプ済み＝赤字にならない。
  const priceModel = data?.effBuyJpy != null
    ? computePriceModelTotal(data.effBuyJpy, effWeightG, medianUsd, data.feeCategory)
    : { breakevenUsd: Number(data?.floorUsd) || 0, lowUsd: 0, medianUsd: 0, highUsd: 0 };
  const floorStableUsd = priceModel.breakevenUsd; // 総額の損益分岐(±0)。表示/クランプ/警告の基準を総額で統一。
  const floorUsd = floorStableUsd;
  // 損益分岐未満＝赤字の恐れ。警告は「実際に出す総額(priceUsd)」での純利益で精密判定＝閾値直上の損失帯も検知。
  // ハードブロックはせず警告＋「承知の上で」確認で続行可。
  const belowFloor =
    Number(priceUsd) > 0 &&
    (data?.effBuyJpy != null
      ? netAtTotalJpy(data.effBuyJpy, effWeightG, Number(priceUsd), undefined, data.feeCategory) < 0
      : floorUsd > 0 && Number(priceUsd) < floorUsd);
  // 価格が floor 以上に戻ったら確認をリセット＝再び下回ったら必ず再チェックさせる（確認の使い回し防止）。
  useEffect(() => { if (!belowFloor) setAcceptLoss(false); }, [belowFloor]);
  // 最適サイズ（自動選択中の配送ポリシー）と、その定額請求が実費をカバーできているかの判定。
  const recoChoice = data?.shipping?.find((s) => s.fulfillmentPolicyId === shippingId) || null;
  const recoRealJpy = liveLanded?.shippingJpy ?? 0;
  const recoChargeJpy = recoChoice ? Math.round(Number(recoChoice.costUsd) * USD_JPY) : 0;
  const recoCovers = recoChargeJpy >= recoRealJpy;
  const recoGapJpy = Math.max(0, recoRealJpy - recoChargeJpy);
  // 送料込み(送料無料)関連の派生値（UI表示用）。送料無料ポリシーが口座にあるか／価格への上乗せ額／eBay実表示価格。
  const freePolicy = data?.shipping?.find((s) => Number(s.costUsd) < 0.01) || null;
  const canFreeShip = !!freePolicy;
  // 価格の3段は SSOT から（最安=中央値-8%／中央値＝eBay落札中央値／高値＝中央値+10%、各段とも損益分岐を割らない）。
  const lowSel = priceModel.lowUsd;
  const medianSel = priceModel.medianUsd;
  const highSel = priceModel.highUsd;
  // 価格の選び方を適用（カスタムは価格を触らない＝ユーザーが自由入力）。
  // 価格を $ で確定すると同時に、円入力欄(priceYen)も同期する（表示は円・内部はUSD）。
  const applyUsd = (u: number) => { setPriceUsd(u.toFixed(2)); setPriceYen(u > 0 ? String(Math.round(u * USD_JPY)) : ""); };
  const chooseStrategy = (s: "breakeven" | "custom" | "low" | "median" | "high") => {
    setStrategy(s);
    if (s === "custom") return; // 自由入力（価格はそのまま）
    if (s === "breakeven") { if (floorStableUsd > 0) applyUsd(floorStableUsd); return; } // ±0＝損益分岐（利益ほぼ0・アカウント育成）。固定値で出す。
    if (s === "median") { if (medianSel > 0) applyUsd(medianSel); return; }
    if (s === "high") { if (highSel > 0) applyUsd(highSel); return; }
    if (lowSel > 0) applyUsd(lowSel); // 最安（既定）
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
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[92dvh] overflow-y-auto outline-none"
      >
        {/* ヘッダー */}
        <div className="sticky top-0 z-10 bg-white border-b border-[#A98B5C]/25 px-4 py-3 flex items-center justify-between">
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
              <AlertTriangle size={36} aria-hidden="true" className="mx-auto mb-4 text-amber-400" />
              <h2 className="text-base font-black text-gray-800 mb-2">出品の準備がもう少しです</h2>
              <p className="text-sm text-gray-500 mb-3 leading-relaxed">
                <span className="whitespace-nowrap">出品の準備が残っています。</span><wbr />
                <span className="whitespace-nowrap">設定画面で順に進めれば</span><wbr />
                <span className="whitespace-nowrap">数分で完了。</span>
              </p>
              {/* 全体像（何をやるか）を先に提示して心構えを作る。①連携 ②送料/返品 ③発送元。途中で英語ログインが一度開く。 */}
              <ol className="text-left text-[12px] text-gray-600 leading-relaxed bg-[#F5F7FA] border border-[#A98B5C]/25 rounded-xl px-4 py-3 mb-6 list-decimal pl-7 space-y-1">
                <li>eBayアカウントと<b>連携</b>する</li>
                <li><b>送料・返品</b>のポリシーを決める</li>
                <li><b>発送元（日本）</b>を設定する</li>
                <li className="text-gray-400 list-none -ml-3">※ 途中でeBayの英語ログイン画面が一度だけ開きます</li>
              </ol>
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
              {/* 無在庫出品の注意（先に買わずに出す＝在庫リスクを正直に開示）。仕入れ元が売切/価格変動したら欠品・赤字・eBay規約違反のリスク。 */}
              {dropship && (
                <div className="rounded-xl border border-[#A98B5C]/50 bg-[#A98B5C]/10 px-3 py-2.5">
                  <p className="text-[12px] font-bold text-[#2D323B] leading-relaxed">
                    <span className="whitespace-nowrap">📦 無在庫出品（プロMAX）</span>
                  </p>
                  <p className="text-[10px] text-[#6b5d3f] leading-relaxed mt-0.5">
                    <span className="whitespace-nowrap">先に買わずに出品し、</span><wbr />
                    <span className="whitespace-nowrap">売れてから仕入れて発送します。</span><wbr />
                    <span className="whitespace-nowrap">仕入れ元の売切・価格変動で</span><wbr />
                    <span className="whitespace-nowrap">欠品・赤字・eBay規約違反</span><wbr />
                    <span className="whitespace-nowrap">（出品取消で評価低下）の</span><wbr />
                    <span className="whitespace-nowrap">リスクがあります。自己責任でご判断ください。</span>
                  </p>
                </div>
              )}
              {/* 商品画像（カタログ） */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">商品画像（自動取得）</label>
                <div className="flex items-center gap-3">
                  {data.product.imageUrl ? (
                    <img src={data.product.imageUrl} alt="" className="w-20 h-20 object-cover rounded-xl border border-[#A98B5C]/25" />
                  ) : (
                    <div className="w-20 h-20 rounded-xl bg-gray-100" />
                  )}
                  <p className="text-[10px] text-gray-400 leading-relaxed flex-1">
                    <span className="whitespace-nowrap">この画像で出品します。</span><wbr />
                    <span className="whitespace-nowrap">権利が気になる商品は、</span><wbr />
                    <span className="whitespace-nowrap">後でeBay側で自分の写真に差し替えを。</span>
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
                  className="w-full px-3 py-2 rounded-xl border border-[#A98B5C]/35 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D323B]/40 focus:border-[#2D323B] resize-none"
                />
                <p className="text-[10px] text-gray-400 mt-0.5">{title.length}/80　英語タイトルを自動入力（編集OK）</p>
              </div>

              {/* 詳細オプション。既定は閉じて「写真・タイトル・価格」だけの最小表示。説明文・状態・売り方・送料・個数などは自動設定済みでここに格納。 */}
              <button
                type="button"
                onClick={() => setShowAdv((v) => !v)}
                className="flex items-center justify-between w-full text-[11px] text-gray-500 active:text-gray-700 border-y border-[#A98B5C]/20 py-2"
              >
                <span>詳細オプション（説明文・状態・売り方・送料・個数など）</span>
                <span className="text-gray-400">{advOpen ? "閉じる ▲" : "開く ▼"}</span>
              </button>

              {advOpen && (<>
              {/* 説明文（英語・編集可） */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">説明文（英語）<OptBadge /></label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 rounded-xl border border-[#A98B5C]/35 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D323B]/40 focus:border-[#2D323B] resize-none leading-relaxed"
                />
              </div>

              {/* 状態 */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">商品の状態<OptBadge /></label>
                <select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-[#A98B5C]/35 text-sm bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D323B]/40 focus:border-[#2D323B]"
                >
                  <option value="NEW">新品（New）</option>
                  <option value="USED_EXCELLENT">中古 - 非常に良い</option>
                  <option value="USED_GOOD">中古 - 良い</option>
                  <option value="USED_ACCEPTABLE">中古 - 可（難あり/ジャンク）</option>
                </select>
              </div>
              </>)}

              {/* 出品に使う写真（カタログのギャラリー画像から選ぶ・先頭がメイン写真） */}
              {photoCandidates.length > 0 && (
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">
                    出品に使う写真（<b>タップした順に並びます</b>・先頭がメイン・{selectedImages.length}/{Math.min(photoCandidates.length, MAX_LISTING_PHOTOS)}枚）<ReqBadge />
                  </label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {photoCandidates.map((u, i) => {
                      const idx = selectedImages.indexOf(u);
                      const checked = idx >= 0;
                      const disabled = !checked && selectedImages.length >= MAX_LISTING_PHOTOS;
                      return (
                        <div
                          key={i}
                          className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${
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
                            <img
                              src={ebayPreviewSrc(u)}
                              alt={`候補${i + 1}`}
                              loading="lazy"
                              // 実寸が小さい(<300px)＝粗い/別商品のサムネは候補から落とす。読み込み失敗(リンク切れ)も同様。
                              onLoad={(e) => { const t = e.currentTarget; if (t.naturalWidth > 0 && (t.naturalWidth < 300 || t.naturalHeight < 300)) markBadPhoto(u); }}
                              onError={() => markBadPhoto(u)}
                              className="w-full h-full object-contain bg-white"
                            />
                          </button>
                          {/* 選択バッジ（左上・番号）。タップは下の画像ボタンに透過。 */}
                          <span
                            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full text-[11px] font-black flex items-center justify-center pointer-events-none border ${
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
                            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/45 text-white text-[10px] flex items-center justify-center"
                          >
                            🔍
                          </button>
                          {checked && <span className="absolute inset-0 rounded-md ring-2 ring-inset ring-[#0064D2] pointer-events-none" />}
                          {idx === 0 && (
                            <span className="absolute bottom-0 inset-x-0 bg-[#0064D2] text-white text-[9px] font-bold text-center py-px pointer-events-none">メイン</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">
                    🔍で拡大確認（最大{MAX_LISTING_PHOTOS}枚）。
                  </p>
                  {!photoOk && (
                    <p role="alert" className="text-[11px] text-[#2D323B] bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 mt-1.5">
                      写真を1枚以上選んでください。
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
                      <div className="px-4 py-3 text-xs text-white/70" onClick={(e) => e.stopPropagation()}>← スワイプで確認・選択 ／ 右上 ✕ で閉じる →</div>
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

              {/* 価格の選び方（上段2＝±0育成/カスタム、下段3＝過去落札の最安/中央/高値）。既定は中央値。常時表示（写真/タイトル/価格は常に出す）。 */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">出品価格の選択</label>
                {/* 上段（2）：±0出品(育成用) / カスタム(自由入力) */}
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => chooseStrategy("breakeven")}
                    aria-pressed={strategy === "breakeven"}
                    className={`flex flex-col items-center justify-center h-12 rounded-xl border transition-colors ${
                      strategy === "breakeven" ? "border-[#2D323B] bg-[#2D323B]/5 text-[#2D323B]" : "border-[#A98B5C]/35 text-gray-500"
                    }`}
                  >
                    <span className="text-[12px] font-bold">🌱 ±0出品</span>
                    <span className="text-[10px]">アカウント育成用{floorStableUsd > 0 ? `・${formatJpy(Math.round(floorStableUsd * USD_JPY))}` : ""}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseStrategy("custom")}
                    aria-pressed={strategy === "custom"}
                    className={`flex flex-col items-center justify-center h-12 rounded-xl border transition-colors ${
                      strategy === "custom" ? "border-[#2D323B] bg-[#2D323B]/5 text-[#2D323B]" : "border-[#A98B5C]/35 text-gray-500"
                    }`}
                  >
                    <span className="text-[12px] font-bold">✏️ カスタム設定</span>
                    <span className="text-[10px]">価格を自由に入力</span>
                  </button>
                </div>
                {/* 下段（3）：過去落札の 最安 / 中央値 / 高値 */}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => chooseStrategy("low")}
                    aria-pressed={strategy === "low"}
                    className={`flex flex-col items-center justify-center h-12 rounded-xl border transition-colors ${
                      strategy === "low" ? "border-[#2D323B] bg-[#2D323B]/5 text-[#2D323B]" : "border-[#A98B5C]/35 text-gray-500"
                    }`}
                  >
                    <span className="text-[12px] font-bold">最安</span>
                    <span className="text-[10px]">{lowSel > 0 ? formatJpy(Math.round(lowSel * USD_JPY)) : "—"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseStrategy("median")}
                    aria-pressed={strategy === "median"}
                    className={`flex flex-col items-center justify-center h-12 rounded-xl border transition-colors ${
                      strategy === "median" ? "border-[#2D323B] bg-[#2D323B]/5 text-[#2D323B]" : "border-[#A98B5C]/35 text-gray-500"
                    }`}
                  >
                    <span className="text-[12px] font-bold">中央値</span>
                    <span className="text-[10px]">{medianSel > 0 ? formatJpy(Math.round(medianSel * USD_JPY)) : "—"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseStrategy("high")}
                    aria-pressed={strategy === "high"}
                    className={`flex flex-col items-center justify-center h-12 rounded-xl border transition-colors ${
                      strategy === "high" ? "border-[#2D323B] bg-[#2D323B]/5 text-[#2D323B]" : "border-[#A98B5C]/35 text-gray-500"
                    }`}
                  >
                    <span className="text-[12px] font-bold">高値</span>
                    <span className="text-[10px]">{highSel > 0 ? formatJpy(Math.round(highSel * USD_JPY)) : "—"}</span>
                  </button>
                </div>
                <p className="text-[9px] text-gray-300 mt-0.5">
                  <span className="whitespace-nowrap">※ 最安/中央値/高値は</span><wbr />
                  <span className="whitespace-nowrap">eBayの過去落札の中央値をもとに算出</span><wbr />
                  <span className="whitespace-nowrap">（いずれも損益分岐は割りません）</span>
                </p>
              </div>

              {/* 価格 */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">出品価格（円・送料込み）<ReqBadge /></label>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-sm">¥</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={priceYen}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, "");
                      setPriceYen(raw);
                      const yen = Number(raw);
                      setPriceUsd(yen > 0 ? (yen / USD_JPY).toFixed(2) : ""); // 内部はUSD（eBayは$建て）に換算
                    }}
                    className="flex-1 h-10 px-3 rounded-xl border border-[#A98B5C]/35 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D323B]/40 focus:border-[#2D323B]"
                  />
                </div>
                {/* 価格の内訳を1行コンパクトに。仕入・送料・関税・手数料を引いた利益まで。各値は下の送料/関税表示と同値。利益マイナスは赤字色。 */}
                {Number(priceUsd) > 0 && data?.effBuyJpy != null && liveLanded && (() => {
                  const totalJpy = Math.round(Number(priceUsd) * USD_JPY); // priceUsd=総額(買い手の支払)＝eBay掲載価格
                  const costJ = Math.round(data.effBuyJpy);
                  const feeJ = Math.round(totalJpy * ebayFeeRate(data.feeCategory)) + ebayFeeFixedJpy(); // 実効手数料(FVF+海外決済+為替・時計15%)＋固定$0.40
                  // 利益は損益分岐(belowFloor)と同じ式(netAtTotalJpy=安全係数込み)で出す＝緑/赤の表示が赤字警告と必ず一致する。
                  // 内訳の送料/関税は実費の目安(liveLanded)を表示するため、安全係数ぶん利益と僅差が出るが、判定の正は利益(=net)。
                  const profitJ = netAtTotalJpy(data.effBuyJpy, effWeightG, Number(priceUsd), undefined, data.feeCategory);
                  const j = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");
                  return (
                    <p className="text-[10px] text-gray-500 mt-1 leading-snug">
                      <span className="whitespace-nowrap">仕入{j(costJ)}</span>・<span className="whitespace-nowrap">送料{j(liveLanded.shippingJpy)}</span>・<span className="whitespace-nowrap">関税{j(liveLanded.dutyJpy)}</span>・<span className="whitespace-nowrap">手数料{j(feeJ)}</span><span className={`whitespace-nowrap font-bold ${profitJ >= 0 ? "text-emerald-600" : "text-rose-600"}`}>→利益{j(profitJ)}</span>
                    </p>
                  );
                })()}

                {/* 送料の出し方：送料込み(価格に送料を上乗せ＝送料無料表示)か 送料別(購入者が送料を別途負担)。
                    買い手の総額は同じでも eBayに出る「掲載価格」が変わる＝下の結果行が切替で必ず動く。 */}
                <div className="mt-2 rounded-xl border border-[#A98B5C]/30 bg-[#F8F9FB] p-2.5">
                  <p className="text-[11px] font-bold text-gray-600 mb-1.5">送料の出し方</p>
                  <label className={`flex items-start gap-2 mb-1.5 ${canFreeShip ? "" : "opacity-60"}`}>
                    <input type="radio" name="shipmode" className="mt-0.5 accent-[#2D323B]" checked={freeShip && canFreeShip} disabled={!canFreeShip} onChange={() => setFreeShip(true)} />
                    <span className="text-[12px] leading-snug">
                      <b className="whitespace-nowrap">送料無料(推奨)</b><span className="text-gray-500"> : <span className="whitespace-nowrap">出品価格 + 送料を合算して請求</span></span>
                      {!canFreeShip && <span className="block text-[10px] text-orange-600 mt-0.5"><span className="whitespace-nowrap">※eBayに「送料無料」の配送ポリシーを</span><wbr /><span className="whitespace-nowrap">1つ作ると使えます（一度だけ）。</span><wbr /><span className="whitespace-nowrap">今は送料別。</span></span>}
                    </span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input type="radio" name="shipmode" className="mt-0.5 accent-[#2D323B]" checked={!freeShip || !canFreeShip} onChange={() => setFreeShip(false)} />
                    <span className="text-[12px] leading-snug"><b className="whitespace-nowrap">送料別(購入者が送料を払う)</b><span className="text-gray-500"> : <span className="whitespace-nowrap">本体 + 送料を別に請求</span></span></span>
                  </label>
                </div>

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
                        ＋ 重さを入力して送料を正確に（任意）
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
                          className="w-24 h-8 px-2 rounded-lg border border-[#A98B5C]/35 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D323B]/40 focus:border-[#2D323B]"
                        />
                        <span>梱包込み（未入力は安全側で少し重め）</span>
                      </div>
                    )}
                    <span className="whitespace-nowrap">📦 国際送料の目安 {formatJpy(liveLanded.shippingJpy)}</span>
                    {liveLanded.needsDutyPrepay && (
                      <span className="block text-amber-600 font-bold mt-0.5">
                        <span className="whitespace-nowrap">🛃 米国関税(前払い) {formatJpy(liveLanded.dutyJpy)}</span><wbr />
                        <span className="whitespace-nowrap">・$100超はZonosで関税を前払い＋</span><wbr />
                        <span className="whitespace-nowrap">指定郵便局から発送</span>
                      </span>
                    )}
                  </div>
                )}
                {belowFloor && (
                  <div className="mt-1.5">
                    <p role="alert" className="text-[11px] text-[#2D323B] bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 leading-relaxed">
                      <span aria-hidden="true">⚠️ </span><span className="whitespace-nowrap">損益分岐 {formatJpy(Math.round(floorUsd * USD_JPY))}</span><wbr /><span className="whitespace-nowrap">を下回り、<b>赤字の恐れ</b>があります。</span>
                    </p>
                    <label className="flex items-start gap-2 mt-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={acceptLoss}
                        onChange={(e) => setAcceptLoss(e.target.checked)}
                        className="accent-[#2D323B] w-4 h-4 mt-0.5 shrink-0"
                      />
                      <span className="text-[11px] text-[#2D323B] leading-relaxed">赤字の可能性を承知の上で、このまま出品する</span>
                    </label>
                  </div>
                )}
              </div>

              {advOpen && (<>
              {/* 出品する個数（在庫数） */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">出品する個数（在庫数）<OptBadge /></label>
                <select
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-xl border border-[#A98B5C]/35 text-sm bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D323B]/40 focus:border-[#2D323B]"
                >
                  {[...Array(30)].map((_, i) => (
                    <option key={i + 1} value={i + 1}>{i + 1}個</option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-400 mt-0.5">1個だけならそのままでOK（最大30）</p>
              </div>

              {/* 送料サイズ（アプリが重さ・価格から最適サイズを自動選択。実費カバーを明示） */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">送料（荷物のサイズ）<OptBadge /></label>
                {data.shipping.length > 0 ? (
                  <>
                    {recoChoice && (
                      <div className={`rounded-xl px-3 py-2 mb-1.5 text-[11px] leading-relaxed border ${recoCovers ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
                        <div><span className="whitespace-nowrap">📦 この商品の最適サイズ：<b className="text-gray-800">{shippingLabel(recoChoice.name)}</b></span><wbr /><span className="whitespace-nowrap">（{liveLanded?.shippingMethod === "ems" ? "EMS・補償あり" : "エアパケット"}・約{effWeightG}g）</span></div>
                        <div className="mt-0.5">
                          <span className="whitespace-nowrap">設定送料 <b>${recoChoice.costUsd}</b></span><wbr /><span className="whitespace-nowrap">／ 実費の目安 {formatJpy(recoRealJpy)}</span>
                          {recoCovers ? (
                            <b className="text-emerald-700"> → <span className="whitespace-nowrap">✅ カバーできています</span><wbr /><span className="whitespace-nowrap">（赤字になりません）</span></b>
                          ) : (
                            <b className="text-amber-700"> → <span className="whitespace-nowrap">⚠️ 約{formatJpy(recoGapJpy)}不足</span><wbr /><span className="whitespace-nowrap">（利益計算には反映済み。</span><wbr /><span className="whitespace-nowrap">「大」の送料を上げると安心）</span></b>
                          )}
                        </div>
                      </div>
                    )}
                    <select
                      value={shippingId}
                      onChange={(e) => setShippingId(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl border border-[#A98B5C]/35 text-sm bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D323B]/40 focus:border-[#2D323B]"
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
                    <span className="whitespace-nowrap">配送ポリシーが</span><wbr />
                    <span className="whitespace-nowrap">見つかりません。</span><wbr />
                    <span className="whitespace-nowrap">設定で「発送設定」を</span><wbr />
                    <span className="whitespace-nowrap">完了してください。</span>
                  </p>
                )}
                <p className="text-[10px] text-gray-400 mt-0.5">
                  <span className="whitespace-nowrap">送料は購入者負担。</span><wbr />
                  <span className="whitespace-nowrap">重さ・価格から最適サイズを自動選択</span><wbr />
                  <span className="whitespace-nowrap">（変更可）。</span>
                </p>
              </div>

              {/* 発送までの日数（handling time） */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5 flex items-center gap-1">
                  <Clock size={12} className="text-gray-400" />発送までの日数（落札後に発送するまで）<OptBadge />
                </label>
                <select
                  value={handlingDays}
                  onChange={(e) => setHandlingDays(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-xl border border-[#A98B5C]/35 text-sm bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D323B]/40 focus:border-[#2D323B]"
                >
                  {[1, 2, 3, 5, 7, 10, 14, 20, 30].map((d) => (
                    <option key={d} value={d}>
                      {d}日以内に発送{d === 7 ? "（おすすめ）" : ""}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  <span className="whitespace-nowrap">買い手に表示される発送の目安。</span><wbr />
                  <span className="whitespace-nowrap">初めは余裕をもって7日がおすすめ。</span>
                </p>
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
                    <span className="whitespace-nowrap">カテゴリを自動判定できませんでした。</span><wbr />
                    <span className="whitespace-nowrap">タイトルを具体的にして開き直すか、</span><wbr />
                    <span className="whitespace-nowrap">時間をおいて再度お試しを。</span>
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
                  const base = `w-full h-9 px-2.5 rounded-lg border text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D323B]/40 focus:border-[#2D323B] ${showRed ? "border-red-300 bg-red-50/40" : "border-[#A98B5C]/35"}`;
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
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      <span className="whitespace-nowrap">※必須だけ確認すればOK。</span><wbr />
                      <span className="whitespace-nowrap">他は検索に出やすい値を自動入力ずみ</span><wbr />
                      <span className="whitespace-nowrap">（必要なら下で編集）。</span>
                    </p>
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
              </>)}

              {/* 必須項目が未入力の時の案内（公開エラー#25002の予防） */}
              {!aspectsFilled && (
                <p role="alert" className="text-[11px] text-[#2D323B] bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <span aria-hidden="true">⚠️ </span><span className="whitespace-nowrap">上の「商品の詳細（必須）」に未入力あり。</span><wbr /><span className="whitespace-nowrap">候補から選ぶと出品できます。</span>
                </p>
              )}
            </div>
          )}

          {/* スティッキー出品フッター（form時のみ・safe-area対応）。長いフォームでも主CTAが常に見える。
              .p-4 の余白を打ち消して全幅・最下部に固定。未充足は理由＋簡易チェックリストで明示。 */}
          {phase === "form" && data && (() => {
            // 出品ブロックの理由を動的チェックリスト化（未充足だけ示す）。
            const checks = [
              { ok: photoOk, label: `写真を1枚以上選ぶ（現在 ${selectedImages.length}枚）` },
              { ok: aspectsFilled, label: "必須項目（商品の詳細）をすべて入力" },
              { ok: Number(priceUsd) > 0, label: "販売価格を入力" },
              { ok: !!data.category?.categoryId, label: "eBayカテゴリの自動判定" },
              ...(aboveDdpMax ? [{ ok: false, label: "送料込み価格を$800以下に（$800超は米国へDDP発送できず出荷不能になります）" }] : []),
              ...(belowFloor ? [{ ok: acceptLoss, label: "赤字の可能性を承知のうえでチェック" }] : []),
            ];
            const unmet = checks.filter((c) => !c.ok);
            const blocked = !canPublish || (belowFloor && !acceptLoss);
            return (
              <div className="sticky bottom-0 -mx-4 -mb-4 mt-2 bg-white/95 backdrop-blur border-t border-[#A98B5C]/30 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                {/* 未充足の理由（押せない理由を明示）。すべて満たすと消える。 */}
                {unmet.length > 0 && (
                  <ul role="alert" className="mb-2 space-y-0.5">
                    {unmet.map((c, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11px] text-[#2D323B]">
                        <AlertTriangle size={13} aria-hidden="true" className="text-amber-500 shrink-0 mt-0.5" />
                        <span>{c.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  onClick={publish}
                  disabled={blocked}
                  className="w-full h-12 bg-[#0064D2] text-white font-bold text-sm rounded-xl active:bg-[#0053AE] disabled:opacity-40"
                >
                  この内容でeBayに出品する
                </button>
              </div>
            );
          })()}

          {phase === "publishing" && (() => {
            // 擬似ステップ（時間ベースで順送り・体感の待ち軽減）。実際の進捗ではない。
            const steps = ["出品準備中", "画像を最適化中", "カテゴリ・項目を設定中", "eBayに登録中"];
            return (
              <div className="py-10 flex flex-col items-center justify-center gap-4 text-center">
                <span className="w-8 h-8 border-[3px] border-[#A98B5C]/35 border-t-[#0064D2] rounded-full animate-spin" aria-hidden="true" />
                <p className="text-sm text-gray-500" role="status" aria-live="polite">
                  eBayに出品中...（10〜20秒ほど）
                  <span className="block text-[12px] text-gray-400">この画面は閉じないで</span>
                </p>
                <ol className="w-full max-w-[260px] space-y-1.5 text-left">
                  {steps.map((s, i) => {
                    const done = i < pubStep;
                    const active = i === pubStep;
                    return (
                      <li key={s} className="flex items-center gap-2 text-[12px]">
                        {done ? (
                          <BadgeCheck size={15} aria-hidden="true" className="text-emerald-500 shrink-0" />
                        ) : active ? (
                          <span aria-hidden="true" className="w-3.5 h-3.5 shrink-0 border-2 border-[#A98B5C]/40 border-t-[#0064D2] rounded-full animate-spin" />
                        ) : (
                          <span aria-hidden="true" className="w-3.5 h-3.5 shrink-0 rounded-full border border-gray-200" />
                        )}
                        <span className={done ? "text-gray-400 line-through" : active ? "text-[#2D323B] font-bold" : "text-gray-400"}>{s}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })()}

          {phase === "done" && (
            <div className="py-8 text-center">
              <BadgeCheck size={44} aria-hidden="true" className="mx-auto mb-3 text-emerald-500" />
              <h2 className="text-base font-black text-gray-800 mb-1.5">出品が完了しました！</h2>
              <p className="text-xs text-gray-500 mb-4 leading-relaxed">
                <span className="whitespace-nowrap">売れたら自動で検知して、</span><wbr />
                <span className="whitespace-nowrap">この一覧の下の方に移動します。</span>
              </p>
              {/* 前進CTA：出品の勢いを次の行動へ。連続出品(=売上の主因)とアプリ内回遊を切らさない。 */}
              <button
                onClick={() => router.push("/search")}
                className="w-full h-12 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23] mb-2"
              >
                続けてもう1品さがす →
              </button>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  onClick={() => router.push("/manage?tab=listed")}
                  className="h-11 border border-[#A98B5C]/35 rounded-xl text-[13px] font-bold text-gray-700 active:bg-gray-50"
                >
                  出品管理を見る
                </button>
                {/* eBayで出品を確認（写真の追加・編集）。listingIdがあれば直リンク、無ければ自分の出品一覧へ。 */}
                <a
                  href={result?.listingId ? `https://www.ebay.com/itm/${result.listingId}` : "https://www.ebay.com/sh/lst/active"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-11 inline-flex items-center justify-center gap-1 border border-[#A98B5C]/35 rounded-xl text-[13px] font-bold text-[#0064D2] active:bg-gray-50"
                >
                  eBayで確認 <ExternalLink size={13} />
                </a>
              </div>
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
                <AlertTriangle size={40} aria-hidden="true" className="mx-auto mb-3 text-amber-500" />
                <h2 className="text-lg font-black text-amber-700 mb-2">セラー登録が完了していません</h2>
                <p className="text-[12px] text-gray-500 mb-4 leading-relaxed">
                  <span className="whitespace-nowrap">あと<b className="text-gray-700">セラー登録（初回の1回だけ）</b>が済めば、</span><wbr />
                  <span className="whitespace-nowrap">ここから出品できます。</span>
                </p>
              </div>

              {/* 復帰導線を主役に：なぜ必要か＋初回1回＋できたら即再開。自力で進めてもらう前提の前向きな案内。 */}
              <div className="bg-[#FFF7ED] border border-amber-200 rounded-xl px-3.5 py-3 mb-4 text-left">
                <h3 className="text-[13px] font-black text-amber-900 mb-1.5">セラー登録について（初回だけ）</h3>
                <ul className="text-[12px] text-amber-900 leading-relaxed list-disc pl-4 space-y-1">
                  <li><span className="whitespace-nowrap"><b>なぜ必要？</b> 売上を受け取るための本人確認で、</span><wbr /><span className="whitespace-nowrap">eBay側の必須手続きです。</span></li>
                  <li><span className="whitespace-nowrap"><b>1回だけ</b>：一度登録すれば、</span><wbr /><span className="whitespace-nowrap">次からはアプリのワンタップ出品でOK。</span></li>
                  <li><span className="whitespace-nowrap"><b>できたら即再開</b>：登録後、</span><wbr /><span className="whitespace-nowrap">下の「登録できた・もう一度試す」を押せば</span><wbr /><span className="whitespace-nowrap">そのまま出品に進めます。</span></li>
                </ul>
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
                    <span className="whitespace-nowrap">確認は数十秒おき。</span><wbr />
                    <span className="whitespace-nowrap">少し待ってからもう一度押してください。</span>
                  </p>
                ) : !confirmErr ? (
                  <p className="mb-2 text-[11px] text-gray-400 leading-relaxed">
                    <span className="whitespace-nowrap">eBayから〈アカウントの準備ができました〉の</span><wbr />
                    <span className="whitespace-nowrap">メールが届いたら押してください。</span><wbr />
                    <span className="whitespace-nowrap">準備済みならそのまま出品に進めます。</span>
                  </p>
                ) : null}
                {confirmErr && (
                  <p role="alert" className="mb-2 text-[11px] text-[#2D323B] leading-relaxed">
                    <span className="whitespace-nowrap">まだ登録が完了していません。</span><wbr />
                    <span className="whitespace-nowrap">eBayの〈アカウントの準備ができました〉メールが</span><wbr />
                    <span className="whitespace-nowrap">届いてから押してください。</span>
                  </p>
                )}
                <button onClick={onClose} className="w-full h-10 mb-3 text-sm font-bold text-gray-500">あとで</button>

                {/* 二次導線（控えめ）：自力が難しければ他社サポートに頼める、という補助的な選択肢。 */}
                <div className="border-t border-[#A98B5C]/20 pt-3 text-left">
                  <p className="text-[11px] text-gray-400 leading-relaxed mb-1.5">
                    <span className="whitespace-nowrap">登録でつまずいたら、</span><wbr />
                    <span className="whitespace-nowrap">他社サービスのベテランに</span><wbr />
                    <span className="whitespace-nowrap">代行を頼むこともできます。</span>
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
                    className="inline-flex items-center gap-1 text-[12px] font-bold text-gray-500 underline underline-offset-2 active:text-gray-700"
                  >
                    ココナラでセラー登録のサポートを探す <ExternalLink size={12} aria-hidden="true" />
                  </a>
                  {/* 通常リンクは検索済みで着地しないため、検索ワードを貼り付けて探すよう誘導（検索着地リンクなら不要）。 */}
                  {!COCONALA_PRESEARCHED && (
                    <div className="mt-2">
                      <p className="text-[11px] text-gray-400 leading-relaxed mb-1.5">
                        <span className="whitespace-nowrap">開いたら検索まどに</span><wbr />
                        <span className="whitespace-nowrap">下のワードを貼り付けて検索</span><wbr />
                        <span className="whitespace-nowrap">（このボタンで自動コピー）</span>
                      </p>
                      <CopyKeyword value={COCONALA_KEYWORD} />
                    </div>
                  )}
                  {/* アフィリエイト時はステマ規制対応で「広告」を明示。A8.net等はインプレ計測の1x1画像も置く。 */}
                  {COCONALA_IS_AD && (
                    <div className="mt-1 flex items-center justify-end">
                      <span className="text-[10px] text-gray-400">広告（ココナラ）</span>
                      {COCONALA_AFFILIATE_IMG && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={COCONALA_AFFILIATE_IMG} width={1} height={1} alt="" className="absolute opacity-0" />
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {phase === "limit" && (
            <div className="py-6 text-center">
              <Crown size={36} aria-hidden="true" className="mx-auto mb-3 text-[#A98B5C]" />
              {result?.needsPlan && result?.planNeeded === "promax" ? (
                /* eBay自動出品はプロMAX限定。ライト等では使えないので、ここで正しく「プロMAXが必要」と案内する。 */
                <>
                  <h2 className="text-sm font-bold text-gray-800 mb-2">eBay自動出品はプロMAX限定です</h2>
                  <p className="text-[12px] text-gray-600 leading-relaxed mb-1 px-2">
                    <span className="whitespace-nowrap">写真だけで自動出品する機能は</span><wbr />
                    <span className="whitespace-nowrap"><b className="text-[#2D323B]">プロMAXプラン</b>でご利用いただけます。</span>
                  </p>
                  <p className="text-[12px] text-gray-500 leading-relaxed mb-4">
                    <span className="whitespace-nowrap">在庫を確保してから出す通常の出品はそのまま。</span><wbr />
                    <span className="whitespace-nowrap">無在庫での自動出品を使う場合に</span><wbr />
                    <span className="whitespace-nowrap">プロMAXが必要です。</span>
                  </p>
                  <a
                    href="/pricing?from=listing"
                    className="flex items-center justify-center gap-1.5 w-full h-12 bg-[#2D323B] text-white rounded-xl text-sm font-black active:bg-[#1A1D23] mb-2"
                  >
                    <Crown size={16} /> プランを見る →
                  </a>
                </>
              ) : result?.needsPlan ? (
                /* free(プラン未加入)＝まだ一度も出品できない人。「上限到達」ではなく「加入が必要」＋30日無料で背中を押す。 */
                <>
                  <h2 className="text-sm font-bold text-gray-800 mb-2">出品にはプラン加入が必要です</h2>
                  <p className="text-[12px] text-gray-600 leading-relaxed mb-1 px-2">
                    eBayへの出品はプランへのご加入が必要です。
                  </p>
                  <p className="text-[12px] text-gray-500 leading-relaxed mb-4">
                    <span className="whitespace-nowrap"><b className="text-[#2D323B]">ライトは30日無料</b>ではじめられます</span><wbr />
                    <span className="whitespace-nowrap">（月10件まで出品可）。</span>
                  </p>
                  <a
                    href="/pricing"
                    className="flex items-center justify-center gap-1.5 w-full h-12 bg-[#2D323B] text-white rounded-xl text-sm font-black active:bg-[#1A1D23] mb-2"
                  >
                    <Crown size={16} /> 30日無料ではじめる →
                  </a>
                </>
              ) : (
                /* 既にプラン加入済みで同時出品の上限に到達した人＝アップグレード訴求。 */
                <>
                  <h2 className="text-sm font-bold text-gray-800 mb-2">出品の上限に達しました</h2>
                  <p className="text-[12px] text-gray-600 leading-relaxed mb-1 px-2">
                    {result?.error || "現在のプランの同時出品上限に達しました。"}
                  </p>
                  <p className="text-[12px] text-gray-500 leading-relaxed mb-4">
                    <span className="whitespace-nowrap">上のプランで同時出品をもっと増やせます</span><wbr />
                    <span className="whitespace-nowrap">（スタンダード50件／プロ100件）。</span>
                  </p>
                  <a
                    href="/pricing"
                    className="flex items-center justify-center gap-1.5 w-full h-12 bg-[#2D323B] text-white rounded-xl text-sm font-black active:bg-[#1A1D23] mb-2"
                  >
                    <Crown size={16} /> プランをアップグレード →
                  </a>
                </>
              )}
              <button onClick={onClose} className="w-full h-11 bg-gray-100 rounded-xl text-sm font-bold text-gray-600">
                閉じる
              </button>
            </div>
          )}

          {phase === "error" && (
            <div className="py-6">
              <AlertTriangle size={36} aria-hidden="true" className="mx-auto mb-3 text-[#2D323B]" />
              <h2 className="text-sm font-bold text-gray-800 text-center mb-2">出品できませんでした</h2>
              <p role="alert" className="text-[12px] text-[#2D323B] text-center mb-3 leading-relaxed break-words">{msg}</p>
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
                  <li><span className="whitespace-nowrap">少し時間をおいて<b>もう一度出品</b></span><wbr /><span className="whitespace-nowrap">（一時的な通信エラーの場合あり）</span></li>
                  <li><span className="whitespace-nowrap">写真が暗い・小さいときは</span><wbr /><span className="whitespace-nowrap"><b>別の写真</b>に差し替える</span></li>
                  {result?.errorKind !== "known" && <li>直らなければ下のボタンで報告を</li>}
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
                    <p className="text-[11px] text-gray-500 text-center mb-2"><span className="whitespace-nowrap">内容を確認して修正します。</span><wbr /><span className="whitespace-nowrap">直ったら再度お試しを。</span></p>
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
