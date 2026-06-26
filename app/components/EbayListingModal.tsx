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
  competitionCount?: number | null; // eBay現在出品総数＝競合の目安（概算・null=取得不可）
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
  needsPlan?: boolean; // free(プラン未加入)で出品不可（プラン加入＝30日無料の導線を出す。上限到達とは区別）
}

type Phase = "loading" | "setup" | "form" | "publishing" | "done" | "notready" | "error" | "limit";

// 「最安」フォールバック＝eBay現在の最安が取れない時は相場(中央値)より少し安く（8%）。
const FAST_DISCOUNT = 0.08;
// USD_JPY は SSOT(landedCostCore・env駆動/既定155)から import に統一（旧:ローカル155）。クライアントでは既定155に解決。
const HIGH_MARKUP = 0.10; // 「高値」＝eBay相場(中央値)から10%高く

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
}: {
  product: ProfitProduct;
  onClose: () => void;
  onListed?: () => void;
  onBehalfOf?: string; // チーム共有：オーナー名義で出品する時のオーナーactor
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<PrepareData | null>(null);
  const [title, setTitle] = useState(product.coreKeyword || product.title);
  const [description, setDescription] = useState("");
  const [priceUsd, setPriceUsd] = useState("");
  const [weightInput, setWeightInput] = useState(""); // 重さ(任意・g・梱包込み)。入力すると送料/損益分岐を再計算
  const [showWeight, setShowWeight] = useState(false); // 重さ入力欄は既定で隠し、押したら開く
  const [acceptLoss, setAcceptLoss] = useState(false); // 損益分岐を下回る価格でも「承知の上で」確認した時だけ出品可（警告＋確認で続行）
  // 価格の選び方：breakeven(±0=育成) / custom(自由入力) / low(最安) / median(中央値) / high(高値)。既定=最安（最速・カード表示と一致）。
  const [strategy, setStrategy] = useState<"breakeven" | "custom" | "low" | "median" | "high">("low");
  const [condition, setCondition] = useState("NEW");
  const [shippingId, setShippingId] = useState("");
  // 送料の出し方: true=送料込み(価格に上乗せして「送料無料」表示) / false=送料別(購入者が送料を払う)。
  // 送料無料は総額が同じでも eBay検索(総額順)・バイヤー心理で有利＝既定ON（送料無料ポリシーが無い口座では自動的に送料別へフォールバック）。
  const [freeShip, setFreeShip] = useState(true);
  // 発送までの日数・Best Offer は「出品の既定値」（設定で保存・端末単位）を初期値に使う。
  const [handlingDays, setHandlingDays] = useState(() => readListingDefaults().handlingDays);
  const [quantity, setQuantity] = useState(1); // 出品する個数（在庫数。既定1）
  const [bestOffer, setBestOffer] = useState(() => readListingDefaults().bestOffer);
  // 値下げ交渉の自動承諾ライン＝定価の何%引きまで受けるか（既定値から・出品ごとに変更可）。
  const [offerDiscountPct, setOfferDiscountPct] = useState(() => readListingDefaults().offerDiscountPct);
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
    const v = Number(data.priceUsd) || data.product.ebayAvgJpy / USD_JPY;
    const id = pickShippingPolicyId(data.shipping, recommendShippingTier(w, v));
    if (id) setShippingId(id);
  }, [weightInput, data]);
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
      const p: PrepareData & { ok?: boolean; error?: string; connected?: boolean } = await fetch("/api/ebay/list/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id, onBehalfOf }),
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
      // 出品写真：候補の先頭1枚を既定でメイン選択（ゼロ選択で詰むのを防ぐ）。再タップで解除・追加はタップ順。
      const cands = Array.from(new Set([...(p.refImages ?? []), ...(p.productImages ?? [])])).filter(Boolean);
      setSelectedImages(cands.length > 0 ? [cands[0]] : []);
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
    // 送料込み(送料無料)なら、選んだ送料サイズの送料を価格に上乗せ＋配送ポリシーを「送料無料」に差し替える。
    // eBay上は「価格=本体+送料／送料無料」になり、総額が同じでも検索(総額順)・バイヤー心理で有利。
    // 送料無料ポリシーが口座に無ければ自動で送料別のまま(useFree=false)。floorも送料分だけ上げ、Best Offer自動承認で送料負けしないようにする。
    const freePol = data?.shipping?.find((s) => Number(s.costUsd) < 0.01) || null;
    const selPol = data?.shipping?.find((s) => s.fulfillmentPolicyId === shippingId) || null;
    const useFree = freeShip && !!freePol;
    const foldUsd = useFree ? Number(selPol?.costUsd || 0) : 0;
    return fetch("/api/ebay/list/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: product.id,
        title,
        description,
        priceUsd: (Number(priceUsd || 0) + foldUsd).toFixed(2), // 送料込みは送料分を上乗せ
        condition,
        categoryId: data?.category?.categoryId,
        aspects,
        fulfillmentPolicyId: useFree ? freePol.fulfillmentPolicyId : shippingId, // 送料込みは送料無料ポリシー
        handlingDays,
        quantity,
        bestOffer,
        offerDiscountPct, // 値下げ交渉の自動承諾ライン（定価の何%引きまで）
        floorUsd: ((Number(floorUsd) || 0) + foldUsd).toFixed(2), // 送料分だけ損益分岐も上げる（送料込みでBest Offer自動承認が送料負けしないように）
        selectedImages, // 出品に使う写真（先頭=メイン）
        onBehalfOf, // チーム共有：オーナー名義で出品
      }),
    })
      .then((r) => r.json())
      .catch(() => ({ ok: false, error: "通信に失敗しました。" }));
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

  // 出品写真の候補（楽天ギャラリー＋API代表画像・重複除去）。ユーザーがチェックで選ぶ。
  const photoCandidates = Array.from(new Set([...(data?.refImages ?? []), ...(data?.productImages ?? [])]))
    .filter(Boolean)
    .filter((u) => !badPhotos.has(u)); // 低解像度/読み込み不可と判定した候補は出さない
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
  const competitionCount = typeof data?.competitionCount === "number" ? data.competitionCount : null; // eBay競合数（概算）
  // 着地コスト(国際送料＋米国関税)は「重さ(任意)」入力で動的に再計算。未入力なら概算(data.landed.weightG)。
  // 関税/EMSの元値は「実際にユーザーが出す価格(priceUsd)」を使う。推奨価格固定だと $100(関税)/$120(EMS) の境界を
  // またいで価格を変えた時に floor が実態とズレ、過剰/過少な赤字警告になる（修正前の不具合）。空欄/タイプ途中は推奨価格へフォールバック。
  const estWeightG = data?.landed?.weightG ?? 700;
  const effWeightG = Number(weightInput) > 0 ? Number(weightInput) : estWeightG;
  const dutyValueUsd = Number(priceUsd) || Number(data?.priceUsd) || (data ? data.product.ebayAvgJpy / USD_JPY : 0);
  const liveLanded = data?.landed ? landedCostForWeight(effWeightG, dutyValueUsd) : null;
  // 損益分岐（これ未満は赤字・国際送料/関税込み）。effBuyJpy があれば重さに応じて再計算、無ければサーバー値。
  const floorUsd =
    data?.effBuyJpy != null && liveLanded
      ? Math.round((((data.effBuyJpy + 47 + liveLanded.subtractJpy) / (1 - 0.1325)) / USD_JPY) * 100) / 100
      : Number(data?.floorUsd) || 0;
  // 損益分岐(floor)未満の価格＝赤字の恐れ。出すには「承知の上で」確認チェックが要る（ハードブロックはせず警告＋確認で続行可）。
  const belowFloor = floorUsd > 0 && Number(priceUsd) > 0 && Number(priceUsd) < floorUsd;
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
  const shipFoldUsd = freeShip && canFreeShip ? Number(recoChoice?.costUsd || 0) : 0; // 価格に上乗せする送料
  const listedPriceUsd = Number(priceUsd || 0) + shipFoldUsd; // eBayに実際に出る価格
  const paidShipUsd = Number(recoChoice?.costUsd || 0); // 送料別のとき買い手に別途請求する送料(表示用)
  const lowestAvailable = lowUsd > 0;
  const lowestClamped = lowUsd > 0 && floorUsd > lowUsd; // eBay最安が赤字→損益分岐で出す
  // 価格の3段（過去落札ベース）。いずれも損益分岐(floor)は割らない。最安=eBay現在の最安 or 中央値-8%／中央値＝eBay落札中央値／高値＝中央値+10%。
  const lowSel = lowUsd > 0 ? Math.max(lowUsd, floorUsd) : medianUsd > 0 ? Math.max(medianUsd * (1 - FAST_DISCOUNT), floorUsd) : 0;
  const medianSel = medianUsd > 0 ? Math.max(medianUsd, floorUsd) : 0;
  const highSel = medianUsd > 0 ? Math.max(medianUsd * (1 + HIGH_MARKUP), floorUsd) : 0;
  // 価格の選び方を適用（カスタムは価格を触らない＝ユーザーが自由入力）。
  const chooseStrategy = (s: "breakeven" | "custom" | "low" | "median" | "high") => {
    setStrategy(s);
    if (s === "custom") return; // 自由入力（価格はそのまま）
    if (s === "breakeven") { if (floorUsd > 0) setPriceUsd(floorUsd.toFixed(2)); return; } // ±0＝損益分岐（利益ほぼ0・アカウント育成）
    if (s === "median") { if (medianSel > 0) setPriceUsd(medianSel.toFixed(2)); return; }
    if (s === "high") { if (highSel > 0) setPriceUsd(highSel.toFixed(2)); return; }
    if (lowSel > 0) setPriceUsd(lowSel.toFixed(2)); // 最安（既定）
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
                出品の準備が残っています。設定画面で順に進めれば数分で完了。
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
              {/* 商品画像（楽天） */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">商品画像（自動取得）</label>
                <div className="flex items-center gap-3">
                  {data.product.imageUrl ? (
                    <img src={data.product.imageUrl} alt="" className="w-20 h-20 object-cover rounded-xl border border-[#A98B5C]/25" />
                  ) : (
                    <div className="w-20 h-20 rounded-xl bg-gray-100" />
                  )}
                  <p className="text-[10px] text-gray-400 leading-relaxed flex-1">
                    この画像で出品します。権利が気になる商品は、後でeBay側で自分の写真に差し替えを。
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
                    <b>タップした順に並びます</b>（先頭=メイン・再タップで解除）。各画像は<b>実際にeBayに出る加工後</b>。🔍で拡大確認（最大{MAX_LISTING_PHOTOS}枚）。実物が届いたら自分の写真に差し替えを。
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

              {advOpen && (<>
              {/* 価格の選び方（上段2＝±0育成/カスタム、下段3＝過去落札の最安/中央/高値）。既定は最安＝最速で売れやすい。 */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">価格の選び方<OptBadge /></label>
                {/* 上段（2）：±0出品(育成用) / カスタム(自由入力) */}
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => chooseStrategy("breakeven")}
                    aria-pressed={strategy === "breakeven"}
                    className={`flex flex-col items-center justify-center h-14 rounded-xl border transition-colors ${
                      strategy === "breakeven" ? "border-[#2D323B] bg-[#2D323B]/5 text-[#2D323B]" : "border-[#A98B5C]/35 text-gray-500"
                    }`}
                  >
                    <span className="text-[12px] font-bold">🌱 ±0出品</span>
                    <span className="text-[10px]">アカウント育成用{floorUsd > 0 ? `・$${Math.round(floorUsd)}` : ""}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseStrategy("custom")}
                    aria-pressed={strategy === "custom"}
                    className={`flex flex-col items-center justify-center h-14 rounded-xl border transition-colors ${
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
                    className={`flex flex-col items-center justify-center h-14 rounded-xl border transition-colors ${
                      strategy === "low" ? "border-[#2D323B] bg-[#2D323B]/5 text-[#2D323B]" : "border-[#A98B5C]/35 text-gray-500"
                    }`}
                  >
                    <span className="text-[12px] font-bold">最安</span>
                    <span className="text-[10px]">{lowSel > 0 ? `$${Math.round(lowSel)}` : "—"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseStrategy("median")}
                    aria-pressed={strategy === "median"}
                    className={`flex flex-col items-center justify-center h-14 rounded-xl border transition-colors ${
                      strategy === "median" ? "border-[#2D323B] bg-[#2D323B]/5 text-[#2D323B]" : "border-[#A98B5C]/35 text-gray-500"
                    }`}
                  >
                    <span className="text-[12px] font-bold">中央値</span>
                    <span className="text-[10px]">{medianSel > 0 ? `$${Math.round(medianSel)}` : "—"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseStrategy("high")}
                    aria-pressed={strategy === "high"}
                    className={`flex flex-col items-center justify-center h-14 rounded-xl border transition-colors ${
                      strategy === "high" ? "border-[#2D323B] bg-[#2D323B]/5 text-[#2D323B]" : "border-[#A98B5C]/35 text-gray-500"
                    }`}
                  >
                    <span className="text-[12px] font-bold">高値</span>
                    <span className="text-[10px]">{highSel > 0 ? `$${Math.round(highSel)}` : "—"}</span>
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
                  {strategy === "breakeven"
                    ? "利益ほぼ±0で出す。eBayアカウントの評価を早く貯める育成向け（損益分岐ぎりぎり・赤字にはしません）"
                    : strategy === "custom"
                    ? "下の「本体価格」に好きな金額を入力できます"
                    : strategy === "high"
                    ? "過去落札の中央値より10%高く。利益重視（売れるまで時間がかかります）"
                    : strategy === "median"
                    ? "過去落札の中央値どおり。売れるまで少し待ちます"
                    : !lowestAvailable
                    ? "過去落札ベースで安めに（eBay現在の最安が取れず、中央値より少し安く）"
                    : lowestClamped
                    ? `eBay最安は赤字のため、損益分岐 $${floorUsd.toFixed(2)} で出します（赤字回避）`
                    : "eBay現在の最安値と同額。最速で売れやすく（赤字にはしません）"}
                </p>
                <p className="text-[9px] text-gray-300 mt-0.5">※ 最安/中央値/高値は eBayの過去落札の中央値と現在の最安値をもとに算出（いずれも損益分岐は割りません）</p>
              </div>
              </>)}

              {/* 価格 */}
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">本体価格（USD・商品代）<ReqBadge /></label>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-sm">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={priceUsd}
                    onChange={(e) => setPriceUsd(e.target.value)}
                    className="flex-1 h-10 px-3 rounded-xl border border-[#A98B5C]/35 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D323B]/40 focus:border-[#2D323B]"
                  />
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">eBay相場の目安：{formatJpy(data.product.ebayAvgJpy)}</p>
                {/* 競合数＝同等品のeBay現在出品総数(概算)。価格表示と同一クエリなので信頼度も同等。出品判断の参考。 */}
                {competitionCount != null && (
                  <p className="text-[10px] mt-0.5 leading-relaxed">
                    {competitionCount === 0 ? (
                      <span className="text-green-700 font-bold">🟢 eBay同等出品：現在ほぼ無し（競合少・狙い目）</span>
                    ) : competitionCount <= 5 ? (
                      <span className="text-green-700 font-bold">🟢 eBay競合：現在 約{competitionCount}件・少なめ（狙い目）</span>
                    ) : competitionCount <= 30 ? (
                      <span className="text-gray-400">eBay競合：現在 約{competitionCount}件</span>
                    ) : (
                      <span className="text-amber-600 font-bold">🟠 eBay競合：現在 約{competitionCount}件・多め（最安〜送料無料で差別化を）</span>
                    )}
                  </p>
                )}

                {/* 送料の出し方：送料込み(価格に送料を上乗せ＝送料無料表示)か 送料別(購入者が送料を別途負担)。
                    買い手の総額は同じでも eBayに出る「掲載価格」が変わる＝下の結果行が切替で必ず動く。 */}
                <div className="mt-2 rounded-xl border border-[#A98B5C]/30 bg-[#F8F9FB] p-2.5">
                  <p className="text-[11px] font-bold text-gray-600 mb-1.5">送料の出し方</p>
                  <label className={`flex items-start gap-2 mb-1.5 ${canFreeShip ? "" : "opacity-60"}`}>
                    <input type="radio" name="shipmode" className="mt-0.5 accent-[#2D323B]" checked={freeShip && canFreeShip} disabled={!canFreeShip} onChange={() => setFreeShip(true)} />
                    <span className="text-[12px] leading-snug">
                      <b>送料込み（送料無料で出す）</b>
                      <span className="text-gray-500"> — 価格に送料を上乗せして「送料無料」表示。総額が同じでも検索・転換に強い（推奨）</span>
                      {!canFreeShip && <span className="block text-[10px] text-orange-600 mt-0.5">※eBayに「送料無料」の配送ポリシーを1つ作ると使えます（一度だけ）。今は送料別。</span>}
                    </span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input type="radio" name="shipmode" className="mt-0.5 accent-[#2D323B]" checked={!freeShip || !canFreeShip} onChange={() => setFreeShip(false)} />
                    <span className="text-[12px] leading-snug"><b>送料別（購入者が送料を払う）</b><span className="text-gray-500"> — 本体価格＋送料を別に請求</span></span>
                  </label>
                  {/* どちらのモードでも「eBay掲載価格」を常に表示＝切替で数字が動く。買い手の総額は両モード同じ。 */}
                  {Number(priceUsd) > 0 && (
                    freeShip && canFreeShip ? (
                      <p className="text-[12px] text-[#2D323B] font-bold mt-2 leading-relaxed">
                        → eBay掲載価格 <b>${listedPriceUsd.toFixed(2)}</b>（≒{formatJpy(Math.round(listedPriceUsd * USD_JPY))}）・<b>送料無料</b>
                        <span className="block text-[10px] font-normal text-gray-500">本体 ${Number(priceUsd).toFixed(2)} ＋ 送料 ${shipFoldUsd.toFixed(2)} を価格に込み（買い手の総額は送料別と同じ）</span>
                      </p>
                    ) : (
                      <p className="text-[12px] text-[#2D323B] font-bold mt-2 leading-relaxed">
                        → eBay掲載価格 <b>${Number(priceUsd).toFixed(2)}</b>（≒{formatJpy(Math.round(Number(priceUsd) * USD_JPY))}）＋ 送料 ${paidShipUsd.toFixed(2)} を別途請求
                        <span className="block text-[10px] font-normal text-gray-500">買い手の総額 ≒ ${(Number(priceUsd) + paidShipUsd).toFixed(2)}（送料込みと同じ）</span>
                      </p>
                    )
                  )}
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
                    📦 国際送料の目安 {formatJpy(liveLanded.shippingJpy)}（
                    {liveLanded.shippingMethod === "ems" ? "EMS・補償あり" : "エアパケット・追跡のみ"}／
                    {Number(weightInput) > 0 ? `入力${effWeightG}` : `概算${effWeightG}`}g）＝<b className="text-gray-500">購入者が負担</b>
                    {liveLanded.needsDutyPrepay && (
                      <span className="block text-amber-600 font-bold mt-0.5">
                        🛃 米国関税(前払い) {formatJpy(liveLanded.dutyJpy)}・$100超はZonosで関税を前払い＋指定郵便局から発送
                      </span>
                    )}
                    <span className="block mt-0.5">
                      ※ 損益分岐に入れるのは<b className="text-gray-500">関税{liveLanded.needsDutyPrepay ? "" : "(この価格は不要)"}＋送料にかかるeBay手数料</b>のみ。送料そのものは購入者負担です。
                    </span>
                  </div>
                )}
                {belowFloor && (
                  <div className="mt-1.5">
                    <p role="alert" className="text-[11px] text-[#2D323B] bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 leading-relaxed">
                      <span aria-hidden="true">⚠️ </span>損益分岐 ${floorUsd.toFixed(2)} を下回り、赤字の恐れがあります。
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
                {bestOffer && (
                  <div className="mt-2 space-y-1.5">
                    {/* 何%引きまで自動承諾するかをユーザーが指定（中古有在庫＝自分で値引き幅を決める）。 */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-gray-600">定価の</span>
                      <input
                        type="number"
                        min={0}
                        max={60}
                        value={offerDiscountPct}
                        onChange={(e) => setOfferDiscountPct(Math.min(60, Math.max(0, Math.round(Number(e.target.value) || 0))))}
                        className="w-16 h-8 px-2 rounded-lg border border-[#A98B5C]/40 text-[12px] text-center focus:outline-none focus:border-[#2D323B]"
                      />
                      <span className="text-[11px] text-gray-600">%引きまで自動承諾</span>
                    </div>
                    {listedPriceUsd > 0 && (
                      <p className="text-[10px] text-gray-500 leading-relaxed">
                        {/* 自動承諾/拒否はeBay出品価格(送料込みなら上乗せ後=listedPriceUsd)基準。送料別は shipFoldUsd=0 で従来どおり。 */}
                        ${(listedPriceUsd * (1 - offerDiscountPct / 100)).toFixed(2)}（{formatJpy(Math.round(listedPriceUsd * (1 - offerDiscountPct / 100) * USD_JPY))}）以上のオファーは<b>自動承諾</b>（{offerDiscountPct}%引きまで即売）
                        {(floorUsd + shipFoldUsd) > 0 && (
                          <>／ 損益分岐 ${(floorUsd + shipFoldUsd).toFixed(2)}（{formatJpy(Math.round((floorUsd + shipFoldUsd) * USD_JPY))}）未満は<b>自動拒否</b></>
                        )}
                      </p>
                    )}
                  </div>
                )}
              </div>

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
                          <b className="text-amber-700"> → ⚠️ 約{formatJpy(recoGapJpy)}不足（利益計算には反映済み。「大」の送料を上げると安心）</b>
                        )}
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
                    配送ポリシーが見つかりません。設定で「発送設定」を完了してください。
                  </p>
                )}
                <p className="text-[10px] text-gray-400 mt-0.5">送料は購入者負担。重さ・価格から最適サイズを自動選択（変更可）。</p>
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
                <p className="text-[10px] text-gray-400 mt-0.5">買い手に表示される発送の目安。初めは余裕をもって7日がおすすめ。</p>
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
                    カテゴリを自動判定できませんでした。タイトルを具体的にして開き直すか、時間をおいて再度お試しを。
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
                    <p className="text-[10px] text-gray-400 leading-relaxed">※必須だけ確認すればOK。他は検索に出やすい値を自動入力ずみ（必要なら下で編集）。</p>
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

              {/* 海外出品の不安をやわらげる一言 */}
              <p className="text-[11px] text-gray-600 bg-[#F5F7FA] border border-[#A98B5C]/25 rounded-lg px-3 py-2 leading-relaxed">
                🌏 英語の説明は自動入力ずみ。購入者とのやり取りも定型文でOK。売れたら<b>日本の郵便局から送るだけ</b>。
              </p>

              {/* 必須項目が未入力の時の案内（公開エラー#25002の予防） */}
              {!aspectsFilled && (
                <p role="alert" className="text-[11px] text-[#2D323B] bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <span aria-hidden="true">⚠️ </span>上の「商品の詳細（必須）」に未入力あり。候補から選ぶと出品できます。
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
                  eBayに出品中...（10〜20秒ほど）<br />
                  <span className="text-[12px] text-gray-400">この画面は閉じないで</span>
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
                  <b>📸 商品が届いたら</b>、実物の写真を撮って <b>eBayの出品に追加</b>を。実物写真があると<b>信頼されて売れやすく</b>なります（下の「eBayで確認」→ 写真の編集から）。
                </p>
              </div>
              {/* 前進CTA：出品の勢いを次の行動へ。連続出品(=売上の主因)とアプリ内回遊を切らさない。 */}
              <button
                onClick={() => router.push("/search")}
                className="w-full h-12 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23] mb-2"
              >
                続けてもう1品さがす →
              </button>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  onClick={() => router.push("/listings")}
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
                  あと<b className="text-gray-700">セラー登録（初回の1回だけ）</b>が済めば、ここから出品できます。
                </p>
              </div>

              {/* 復帰導線を主役に：なぜ必要か＋初回1回＋できたら即再開。自力で進めてもらう前提の前向きな案内。 */}
              <div className="bg-[#FFF7ED] border border-amber-200 rounded-xl px-3.5 py-3 mb-4 text-left">
                <h3 className="text-[13px] font-black text-amber-900 mb-1.5">セラー登録について（初回だけ）</h3>
                <ul className="text-[12px] text-amber-900 leading-relaxed list-disc pl-4 space-y-1">
                  <li><b>なぜ必要？</b> 売上を受け取るための本人確認で、eBay側の必須手続きです。</li>
                  <li><b>1回だけ</b>：一度登録すれば、次からはアプリのワンタップ出品でOK。</li>
                  <li><b>できたら即再開</b>：登録後、下の「登録できた・もう一度試す」を押せばそのまま出品に進めます。</li>
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
                    確認は数十秒おき。少し待ってからもう一度押してください。
                  </p>
                ) : !confirmErr ? (
                  <p className="mb-2 text-[11px] text-gray-400 leading-relaxed">
                    eBayから〈アカウントの準備ができました〉のメールが届いたら押してください。準備済みならそのまま出品に進めます。
                  </p>
                ) : null}
                {confirmErr && (
                  <p role="alert" className="mb-2 text-[11px] text-[#2D323B] leading-relaxed">
                    まだ登録が完了していません。eBayの〈アカウントの準備ができました〉メールが届いてから押してください。
                  </p>
                )}
                <button onClick={onClose} className="w-full h-10 mb-3 text-sm font-bold text-gray-500">あとで</button>

                {/* 二次導線（控えめ）：自力が難しければ他社サポートに頼める、という補助的な選択肢。 */}
                <div className="border-t border-[#A98B5C]/20 pt-3 text-left">
                  <p className="text-[11px] text-gray-400 leading-relaxed mb-1.5">
                    登録でつまずいたら、他社サービスのベテランに代行を頼むこともできます。
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
                        開いたら検索まどに下のワードを貼り付けて検索（このボタンで自動コピー）
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
              {result?.needsPlan ? (
                /* free(プラン未加入)＝まだ一度も出品できない人。「上限到達」ではなく「加入が必要」＋30日無料で背中を押す。 */
                <>
                  <h2 className="text-sm font-bold text-gray-800 mb-2">出品にはプラン加入が必要です</h2>
                  <p className="text-[12px] text-gray-600 leading-relaxed mb-1 px-2">
                    eBayへの出品はプランへのご加入が必要です。
                  </p>
                  <p className="text-[12px] text-gray-500 leading-relaxed mb-4">
                    <b className="text-[#2D323B]">ライトは30日無料</b>ではじめられます（月10件まで出品可）。
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
                    上のプランで同時出品をもっと増やせます（スタンダード50件／プロ100件）。
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
                  <li>少し時間をおいて<b>もう一度出品</b>（一時的な通信エラーの場合あり）</li>
                  <li>写真が暗い・小さいときは<b>別の写真</b>に差し替える</li>
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
                    <p className="text-[11px] text-gray-500 text-center mb-2">内容を確認して修正します。直ったら再度お試しを。</p>
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
