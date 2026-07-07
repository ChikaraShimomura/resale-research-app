"use client";
import { useEffect, useRef, useState } from "react";
import { X, ImagePlus, ChevronDown } from "lucide-react";
import Spinner from "./Spinner";
import ReportableError from "./ReportableError";
import PhotoManager from "./PhotoManager";
import { USD_JPY } from "../lib/ebay/landedCost";
import { reportClientError, errToDetail } from "../lib/clientError";

type ErrInfo = { message: string; errorKind?: "known" | "unexpected"; errorDetail?: string };

// アップロード前にブラウザ側で画像をJPEG縮小する。
// 目的＝Vercelのリクエスト本文上限(約4.5MB)に iPhone の大きな写真（複数枚）で当たり、
//       関数に到達する前に 413 FUNCTION_PAYLOAD_TOO_LARGE で即失敗していたのを根治する。
// 長辺1600px（サーバ側のEPS縮小と整合）・各≤約480KB・EXIF向き保持。デコード不可なら原本のまま返す（サーバのsharpに委ねる）。
async function downscaleForUpload(file: File): Promise<Blob> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) { bmp.close?.(); return file; }
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const toBlob = (q: number) => new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", q));
  let q = 0.82;
  let blob = await toBlob(q);
  while (blob && blob.size > 480_000 && q > 0.45) {
    q -= 0.12;
    blob = await toBlob(q);
  }
  return blob ?? file;
}

// 出品中の「価格・数量」をアプリ内で編集するモーダル。
// eBay.comを開かずに直せる＝出品の管理がeBayサイト側へ移って詰む原因を作らない。
export default function EditListingModal({
  productId,
  title,
  onClose,
  onSaved,
}: {
  productId: string;
  title?: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [priceUsd, setPriceUsd] = useState(""); // 内部はUSD（eBay）。表示/入力は円。
  const [priceYen, setPriceYen] = useState(""); // 価格の円表示（priceUsd と同期）
  const [quantity, setQuantity] = useState("1");
  const [floorUsd, setFloorUsd] = useState(0); // 損益分岐(±0・USD)。手入力価格がこれ未満なら赤字＝警告＋承知チェック。
  const [acceptLoss, setAcceptLoss] = useState(false); // 「赤字承知で出す」確認
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ErrInfo | null>(null);
  const [done, setDone] = useState(false);
  const [files, setFiles] = useState<File[]>([]); // 追加する実物写真（保存時にまとめてEPS→出品へ）
  const [refImages, setRefImages] = useState<string[]>([]); // 撮影の参考用：自宅ワーカーが取得したカタログ画像
  const [images, setImages] = useState<string[]>([]); // 出品中の画像（並び替え/加工の対象・ステージング）
  const [initialImages, setInitialImages] = useState<string[]>([]); // 読込時の画像配列。保存時に変化があった時だけ書き込む。
  const [formTitle, setFormTitle] = useState(""); // 件名（タイトル）の編集
  const [formDesc, setFormDesc] = useState("");    // 説明文の編集
  const [initial, setInitial] = useState({ priceUsd: "", quantity: "1", title: "", desc: "", shipMode: "" as "" | "free" | "paid" }); // 読込時の値。保存時に「変わったものだけ」eBayへ書く。
  const [pendingShipMode, setPendingShipMode] = useState<"free" | "paid" | null>(null); // 送料の出し方の変更予約（保存時に反映）
  const [showAdvanced, setShowAdvanced] = useState(false); // 件名・説明＝詳細オプション（既定で閉じる）
  // 送料の出し方（送料込み/別）の現在状態と切替プレビュー。切替は保存時に反映（表示だけ即時反転）。
  const [ship, setShip] = useState<{ mode: "free" | "paid"; canFree: boolean; foldUsd: number; unfoldUsd: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null); // フォーカストラップ＆初期フォーカス用のダイアログ本体

  // Escで閉じる（保存中は実行を取りこぼさないため無視）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (saving) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  // モーダル表示中は背景(body)のスクロールをロック＝説明文/内容をスクロールしても後ろの画面が動かない。閉じたら元に戻す。
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

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
  }, [loading]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/ebay/list/edit?id=${encodeURIComponent(productId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j?.ok) {
          const pUsd = j.priceUsd != null ? String(j.priceUsd) : "";
          if (j.priceUsd != null) { setPriceUsd(pUsd); setPriceYen(Number(j.priceUsd) > 0 ? String(Math.round(Number(j.priceUsd) * USD_JPY)) : ""); }
          const qty = j.quantity != null ? String(j.quantity) : "1";
          if (j.quantity != null) setQuantity(qty);
          if (typeof j.floorUsd === "number") setFloorUsd(j.floorUsd);
          if (Array.isArray(j.refImages)) setRefImages(j.refImages);
          const imgs = Array.isArray(j.images) ? j.images : [];
          setImages(imgs); setInitialImages(imgs);
          const t = typeof j.title === "string" ? j.title : "";
          const dsc = typeof j.description === "string" ? j.description : "";
          setFormTitle(t); setFormDesc(dsc);
          if (j.ship) setShip(j.ship);
          // 読込時の値をスナップショット＝保存時に「変わった項目だけ」書き込むための基準。
          setInitial({ priceUsd: pUsd, quantity: qty, title: t, desc: dsc, shipMode: j.ship?.mode ?? "" });
        } else {
          setLoadError(j?.error || "出品情報を取得できませんでした。");
          if (j?.errorKind !== "known") reportClientError("ebay_list_edit_load", { action: "list_edit_load", endpoint: "/api/ebay/list/edit", status: 0, productId, detail: j?.errorDetail || j?.error || "(no detail)" });
        }
      })
      .catch((e) => { if (alive) setLoadError("通信エラーで出品情報を取得できませんでした。"); reportClientError("ebay_list_edit_load", { action: "list_edit_load", endpoint: "/api/ebay/list/edit", status: 0, productId, detail: `fetch例外: ${errToDetail(e)}` }); })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [productId]);

  // 失敗時に ErrInfo を throw して save() に集約表示させるヘルパ。
  const throwErr = (j: { error?: string; errorKind?: "known" | "unexpected"; errorDetail?: string } | null, fallback: string): never => {
    throw { message: j?.error || fallback, errorKind: j?.errorKind, errorDetail: j?.errorDetail } as ErrInfo;
  };

  // 追加する実物写真をEPSへ載せる（stage=1＝出品には書かない）。新URL配列を返す。反映は最後の写真配列書き込みで。
  const stageUploadPhotos = async (): Promise<string[]> => {
    const endpoint = "/api/ebay/list/photos";
    const fd = new FormData();
    fd.append("productId", productId);
    fd.append("stage", "1");
    const prepared = await Promise.all(files.map((f) => downscaleForUpload(f))); // 送信前にJPEG縮小（本文上限413対策）
    prepared.forEach((b, i) => { if (b instanceof File) fd.append("files", b, b.name); else fd.append("files", b, `photo-${i + 1}.jpg`); });
    const res = await fetch(endpoint, { method: "POST", body: fd });
    const text = await res.text();
    let j: { ok?: boolean; urls?: string[]; error?: string; errorKind?: "known" | "unexpected"; errorDetail?: string } | null = null;
    try { j = text ? JSON.parse(text) : null; } catch { /* 非JSON応答 */ }
    if (res.ok && j?.ok && Array.isArray(j.urls)) return j.urls;
    const detail = j?.errorDetail || j?.error || (text ? text.slice(0, 500) : `HTTP ${res.status}（本文なし）`);
    if (j?.errorKind !== "known") reportClientError("ebay_photos", { action: "photo_upload", endpoint, productId, status: res.status, detail });
    return throwErr({ error: j?.error || `写真の追加に失敗しました（コード ${res.status}）。`, errorKind: j?.errorKind || "unexpected", errorDetail: detail }, "写真の追加に失敗しました。");
  };

  // /api/ebay/list/edit へ1項目ぶんPOST（件名説明 / 送料 / 価格数量）。失敗は throw。
  const postEdit = async (payload: object, where: string, action: string): Promise<void> => {
    let j: { ok?: boolean; error?: string; errorKind?: "known" | "unexpected"; errorDetail?: string } | null = null;
    try {
      j = await fetch("/api/ebay/list/edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, ...payload }) }).then((r) => r.json());
    } catch (e) {
      const detail = errToDetail(e);
      reportClientError(where, { action, endpoint: "/api/ebay/list/edit", status: 0, productId, detail: `fetch例外: ${detail}` });
      return throwErr({ error: "通信エラーで更新できませんでした。", errorKind: "unexpected", errorDetail: detail }, "通信エラー");
    }
    if (j?.ok) return;
    if (j?.errorKind !== "known") reportClientError(where, { action, endpoint: "/api/ebay/list/edit", status: 0, productId, detail: j?.errorDetail || j?.error || "(no detail)" });
    return throwErr(j, "更新に失敗しました。");
  };

  // 写真配列を出品へ反映（並び替え/削除/加工/追加を最終配列でまとめて書く＝保存時に一度だけ）。
  const writeImages = async (imgs: string[]): Promise<void> => {
    let j: { ok?: boolean; error?: string; errorKind?: "known" | "unexpected"; errorDetail?: string; imageUrls?: string[] } | null = null;
    try {
      j = await fetch("/api/ebay/list/photo-edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, action: "order", imageUrls: imgs }) }).then((r) => r.json());
    } catch (e) {
      const detail = errToDetail(e);
      reportClientError("ebay_photos_edit", { action: "photo_order_save", endpoint: "/api/ebay/list/photo-edit", status: 0, productId, detail: `fetch例外: ${detail}` });
      return throwErr({ error: "通信エラーで写真を保存できませんでした。", errorKind: "unexpected", errorDetail: detail }, "通信エラー");
    }
    // 保存成功時は、サーバーが全EPS化した実配列で state を更新＝再度の並び替えで自前URLを再アップロードしない＋eBayと表示を一致させる。
    if (j?.ok) { if (Array.isArray(j.imageUrls) && j.imageUrls.length) setImages(j.imageUrls); return; }
    if (j?.errorKind !== "known") reportClientError("ebay_photos_edit", { action: "photo_order_save", endpoint: "/api/ebay/list/photo-edit", status: 0, productId, detail: j?.errorDetail || j?.error || "(no detail)" });
    return throwErr(j, "写真の保存に失敗しました。");
  };

  // 「保存」＝この画面の変更（写真・価格・数量・件名・説明・送料）を、押した時にまとめてeBayへ反映する。
  // 変わった項目だけ順に書く。送料は価格より先（送料切替が商品価格を再計算するため）。価格は最後＝入力した総額が最終権威。
  const save = async () => {
    // 追加写真がeBay上限(24枚)を超える時は、EPS往復させる前にここで止めて案内（黙って切り捨てない）。
    if (files.length) {
      const room = Math.max(0, 24 - images.length);
      if (files.length > room) {
        setSaveError({ message: room > 0 ? `写真は合計24枚までです。追加できるのはあと${room}枚。選択枚数を減らすか、上の写真を削除してください。` : "写真は最大24枚です。上の写真を削除してから追加してください。", errorKind: "known" });
        return;
      }
    }
    setSaving(true);
    setSaveError(null);
    try {
      let wrote = false; // 1つでもeBayへ書いたか。何も変えていない保存で「反映しました」と誤表示しないための判定。
      let finalImages = images;
      if (files.length) {
        const uploaded = await stageUploadPhotos();
        finalImages = [...images, ...uploaded].slice(0, 24);
        setImages(finalImages);
        setFiles([]);
      }
      if (JSON.stringify(finalImages) !== JSON.stringify(initialImages)) { await writeImages(finalImages); wrote = true; }
      // 件名・説明は「変わった項目だけ」送る＝件名だけ変えた時に未編集の説明文をhtml往復させて微改変しない。
      if (formTitle !== initial.title || formDesc !== initial.desc) {
        const cp: { title?: string; description?: string } = {};
        if (formTitle !== initial.title) cp.title = formTitle;
        if (formDesc !== initial.desc) cp.description = formDesc;
        await postEdit(cp, "ebay_edit_content", "content_save");
        wrote = true;
      }
      if (pendingShipMode && pendingShipMode !== initial.shipMode) { await postEdit({ shipMode: pendingShipMode }, "ebay_ship_mode", "ship_toggle"); wrote = true; }
      if (priceUsd !== initial.priceUsd || quantity !== initial.quantity) { await postEdit({ priceUsd, quantity: Number(quantity), acceptLoss }, "ebay_edit", "price_edit"); wrote = true; }
      if (wrote) {
        setDone(true);
        onSaved?.();
        setTimeout(onClose, 900);
      } else {
        onClose(); // 変更ゼロ＝何も書いていないので「反映しました」を出さずそのまま閉じる。
      }
    } catch (e) {
      const info = e as ErrInfo;
      setSaveError(info && info.message ? info : { message: "保存に失敗しました。", errorKind: "unexpected", errorDetail: errToDetail(e) });
    }
    setSaving(false);
  };

  // 送料の出し方の切替＝予約のみ（保存で反映）。表示は即時に反転する。
  const toggleShip = (mode: "free" | "paid") => {
    setPendingShipMode(mode);
    setShip((p) => (p ? { ...p, mode } : p));
  };

  const priceOk = Number(priceUsd) >= 0.01;
  const qtyOk = Number(quantity) >= 1 && Number(quantity) <= 30;
  // 損益分岐(±0)を下回る手入力＝赤字。承知チェックが無ければ保存不可（出品モーダルと同じ作法）。
  const belowFloor = floorUsd > 0 && Number(priceUsd) > 0 && Number(priceUsd) < floorUsd;
  useEffect(() => { if (!belowFloor) setAcceptLoss(false); }, [belowFloor]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="出品を編集"
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-[#A98B5C]/25 max-h-[88dvh] flex flex-col outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー＝スクロールしても常に見える固定。✕で必ず閉じられる。 */}
        <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-2.5 border-b border-[#A98B5C]/15 shrink-0">
          <div className="min-w-0">
            <h2 className="text-[15px] font-black text-gray-900">出品を編集</h2>
            {title && <p className="text-[11px] text-gray-400 truncate mt-0.5">{title}</p>}
          </div>
          <button onClick={onClose} aria-label="閉じる" className="w-9 h-9 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-100 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D323B]/40">
            <X size={18} />
          </button>
        </div>
        {/* 本文＝ここだけスクロール（内容が縦長でもヘッダーは残る・✕に届く）。
            ★flex-1 min-h-0 が必須：max-h+flex-col の中でこれが無いと子が縮まず内側スクロールが成立せず「モーダル全体が動く」。 */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3">

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-gray-400 text-[12px]">
            <Spinner size={16} /> 出品情報を読み込み中…
          </div>
        ) : loadError ? (
          <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[12px] px-3 py-2.5 leading-relaxed">
            {loadError}
          </div>
        ) : done ? (
          <div className="rounded-lg bg-green-50 border border-green-200 text-green-800 text-[13px] px-3 py-3 text-center font-bold">
            ✓ 反映しました
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="text-[12px] font-bold text-gray-700">価格（円）</span>
              <input
                type="text"
                inputMode="numeric"
                value={priceYen}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^\d]/g, "");
                  setPriceYen(raw);
                  const yen = Number(raw);
                  setPriceUsd(yen > 0 ? (yen / USD_JPY).toFixed(2) : ""); // 内部はUSDに換算（eBayは$建て）
                }}
                className="mt-1 w-full h-10 px-3 rounded-lg border border-[#A98B5C]/45 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D323B]/30 focus:border-[#2D323B]"
              />
              {Number(priceUsd) > 0 && <span className="block text-[10px] text-gray-400 mt-0.5">eBay掲載 ${Number(priceUsd).toFixed(2)}</span>}
            </label>
            <label className="block">
              <span className="text-[12px] font-bold text-gray-700">数量（在庫数・1〜30）</span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max="30"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="mt-1 w-full h-10 px-3 rounded-lg border border-[#A98B5C]/45 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D323B]/30 focus:border-[#2D323B]"
              />
              <span className="text-[10px] text-gray-400 mt-1 block"><span className="whitespace-nowrap">確保できる数だけに</span><wbr /><span className="whitespace-nowrap">（足りないと欠品キャンセルの原因）。</span></span>
            </label>

            {/* 送料の出し方（送料込み/別）の切替。出品中の商品にもワンタップで適用＝価格と配送ポリシーを同時更新。 */}
            {ship && (
              <div className="pt-3 mt-1 border-t border-[#A98B5C]/25">
                <span className="text-[12px] font-bold text-gray-700">送料の出し方</span>
                {ship.mode === "free" ? (
                  <>
                    <p className="text-[11px] text-emerald-600 mt-0.5 mb-2">送料込み（送料無料）</p>
                    <button
                      onClick={() => toggleShip("paid")}
                      className="w-full min-h-[44px] py-1.5 rounded-lg border border-[#2D323B] text-[#2D323B] text-sm font-bold flex flex-col items-center justify-center leading-tight"
                    >
                      <span>送料別に戻す</span>
                      {ship.unfoldUsd > 0 && <span className="text-[11px] font-normal opacity-80 tabular-nums whitespace-nowrap">価格 −約¥{Math.round(ship.unfoldUsd * 155).toLocaleString("ja-JP")}</span>}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] text-gray-500 mt-0.5 mb-2"><span className="whitespace-nowrap">送料別（購入者負担）。</span><wbr /><span className="whitespace-nowrap">送料無料の方が検索・転換に強い。</span></p>
                    <button
                      onClick={() => toggleShip("free")}
                      disabled={!ship.canFree}
                      className="w-full min-h-[44px] py-1.5 rounded-lg bg-violet-500 text-white text-sm font-bold disabled:opacity-50 flex flex-col items-center justify-center leading-tight"
                    >
                      <span>送料込み（送料無料）に切替</span>
                      {ship.foldUsd > 0 && <span className="text-[11px] font-normal opacity-90 tabular-nums whitespace-nowrap">価格 +約¥{Math.round(ship.foldUsd * 155).toLocaleString("ja-JP")}</span>}
                    </button>
                    {!ship.canFree && <p className="text-[10px] text-orange-600 mt-1 leading-relaxed"><span className="whitespace-nowrap">※eBayに「送料無料」の配送ポリシーが必要</span><wbr /><span className="whitespace-nowrap">（eBayで一度作れば切替可）。</span></p>}
                  </>
                )}
                {pendingShipMode && pendingShipMode !== initial.shipMode && <p className="text-[11px] text-[#A98B5C] font-bold mt-1">下の「保存」で反映します</p>}
              </div>
            )}

            {/* 写真の並び替え・メイン設定・削除・加工（回転/切り抜き/文字消去）。画像が取れた時だけ表示。 */}
            {images.length > 0 && (
              <div className="pt-3 mt-1 border-t border-[#A98B5C]/25">
                <span className="text-[12px] font-bold text-gray-700">写真（並び替え・加工）</span>
                <p className="text-[10px] text-gray-400 mt-0.5 mb-2 leading-relaxed"><span className="whitespace-nowrap">先頭がメイン写真。</span><wbr /><span className="whitespace-nowrap">並び替え・メイン設定・削除・加工(回転/切り抜き/文字消去)ができます。</span></p>
                <PhotoManager productId={productId} images={images} onImagesChange={setImages} />
              </div>
            )}

            <div className="pt-3 mt-1 border-t border-[#A98B5C]/25">
              <span className="text-[12px] font-bold text-gray-700">実物写真を追加</span>
              <p className="text-[10px] text-gray-400 mt-0.5 mb-2 leading-relaxed">
                <span className="whitespace-nowrap">実物写真を足すと売れやすい。</span><wbr />
                <span className="whitespace-nowrap">カタログ画像は残したまま追加</span><wbr />
                <span className="whitespace-nowrap">（最大6枚・1枚12MBまで・JPG/PNG等）。</span><wbr />
                <span className="whitespace-nowrap"><b className="text-gray-500">おすすめは正方形・長辺1600px以上。</b></span><wbr />
                <span className="whitespace-nowrap">縦長/横長でも自動で白フチを付けて</span><wbr />
                <span className="whitespace-nowrap">正方形フレームに収めます。</span><wbr />
                <span className="whitespace-nowrap">eBay側で触ると管理が外れるので、</span><wbr />
                <span className="whitespace-nowrap">写真変更はここから。</span>
              </p>
              {refImages.length > 0 && (
                <div className="mb-2">
                  <span className="text-[11px] font-bold text-gray-600">📷 撮影の参考（カタログ写真 {refImages.length}枚）</span>
                  <p className="text-[10px] text-gray-400 mt-0.5 mb-1.5 leading-relaxed"><span className="whitespace-nowrap">このアングルを参考に実物を撮ると伝わりやすい</span><wbr /><span className="whitespace-nowrap">（※参考用・eBayには載せません）。</span></p>
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {refImages.map((u, i) => (
                      <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="shrink-0">
                        <img src={u} alt={`参考${i + 1}`} loading="lazy" className="w-14 h-14 rounded-md object-cover border border-[#A98B5C]/35 bg-gray-50" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/bmp,image/tiff"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 6))}
                className="block w-full text-[11px] text-gray-600 file:mr-2 file:h-8 file:px-3 file:rounded-lg file:border-0 file:bg-gray-100 file:text-gray-700 file:text-[11px] file:font-bold"
              />
              {files.length > 0 && (
                <p className="text-[11px] text-[#A98B5C] font-bold mt-1 leading-relaxed">
                  <ImagePlus size={12} className="inline -mt-0.5 mr-0.5" />
                  <span className="whitespace-nowrap">{files.length}枚 選択中</span><wbr /><span className="whitespace-nowrap">（下の「保存」で追加されます）</span>
                </p>
              )}
            </div>

            {/* 件名・説明文の編集＝詳細オプション（既定で閉じる・必要な人だけ開く）。在庫＋公開オファーに反映。 */}
            <div className="pt-3 mt-1 border-t border-[#A98B5C]/25">
              <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="w-full flex items-center justify-between text-[12px] font-bold text-gray-700">
                <span>件名・説明文を編集（任意）</span>
                <ChevronDown size={16} className={`text-gray-400 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
              </button>
              {showAdvanced && (
                <div className="mt-2 space-y-2">
                  <label className="block">
                    <span className="text-[11px] font-bold text-gray-600">件名（英語・80字まで）</span>
                    <input type="text" maxLength={80} value={formTitle} onChange={(e) => setFormTitle(e.target.value)} className="mt-1 w-full h-10 px-3 rounded-lg border border-[#A98B5C]/45 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D323B]/30 focus:border-[#2D323B]" />
                    <span className="block text-[10px] text-gray-400 mt-0.5 text-right tabular-nums">{formTitle.length}/80</span>
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-bold text-gray-600">説明文</span>
                    <textarea rows={6} maxLength={4000} value={formDesc} onChange={(e) => setFormDesc(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-[#A98B5C]/45 text-sm leading-relaxed overscroll-contain focus:outline-none focus:ring-2 focus:ring-[#2D323B]/30 focus:border-[#2D323B]" />
                    <span className="block text-[10px] text-gray-400 mt-0.5">改行はそのまま反映。英語推奨。下の「保存」で反映されます。</span>
                  </label>
                </div>
              )}
            </div>

            {/* 最下部の主アクション＝入力した「価格・数量」を保存。送料/写真はそれぞれの操作で即時適用されるため、ここは価格・数量のみ反映。 */}
            {belowFloor && (
              <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2">
                <p role="alert" className="text-[11px] text-[#2D323B] leading-relaxed">
                  <span aria-hidden="true">⚠️ </span><span className="whitespace-nowrap">損益分岐 ¥{Math.round(floorUsd * USD_JPY).toLocaleString("ja-JP")} を下回り、</span><b>赤字の恐れ</b>があります。
                </p>
                <label className="flex items-start gap-2 mt-1.5 cursor-pointer">
                  <input type="checkbox" checked={acceptLoss} onChange={(e) => setAcceptLoss(e.target.checked)} className="accent-[#2D323B] w-4 h-4 mt-0.5 shrink-0" />
                  <span className="text-[11px] text-[#2D323B] leading-relaxed">赤字の可能性を承知の上で、この価格にする</span>
                </label>
              </div>
            )}

            {saveError && <ReportableError message={saveError.message} errorKind={saveError.errorKind} errorDetail={saveError.errorDetail} where="ebay_edit" context={{ productId }} className="mt-1" />}

            {/* 「保存」＝この画面の変更（写真・価格・数量・件名・説明・送料）を押した時にまとめてeBayへ反映する主アクション。 */}
            <div className="pt-3 mt-1 border-t border-[#A98B5C]/25">
              <button
                onClick={save}
                disabled={saving || !priceOk || !qtyOk || formTitle.trim().length < 1 || (belowFloor && !acceptLoss)}
                className="w-full h-11 rounded-lg bg-[#2D323B] text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <Spinner size={14} /> 保存中…
                  </>
                ) : (
                  "保存"
                )}
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
