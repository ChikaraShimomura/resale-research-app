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
  const [files, setFiles] = useState<File[]>([]); // 追加する実物写真
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<ErrInfo | null>(null);
  const [photoDone, setPhotoDone] = useState<string | null>(null);
  const [refImages, setRefImages] = useState<string[]>([]); // 撮影の参考用：自宅ワーカーが取得したカタログ画像
  const [images, setImages] = useState<string[]>([]); // 出品中の画像（並び替え/加工の対象）
  const [formTitle, setFormTitle] = useState(""); // 件名（タイトル）の編集
  const [formDesc, setFormDesc] = useState("");    // 説明文の編集
  const [showAdvanced, setShowAdvanced] = useState(false); // 件名・説明＝詳細オプション（既定で閉じる）
  const [savingContent, setSavingContent] = useState(false);
  const [contentErr, setContentErr] = useState<ErrInfo | null>(null);
  const [contentDone, setContentDone] = useState(false);
  // 送料の出し方（送料込み/別）の現在状態と切替プレビュー。
  const [ship, setShip] = useState<{ mode: "free" | "paid"; canFree: boolean; foldUsd: number; unfoldUsd: number } | null>(null);
  const [shipBusy, setShipBusy] = useState(false);
  const [shipMsg, setShipMsg] = useState<string | null>(null);
  const [shipErr, setShipErr] = useState<ErrInfo | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null); // フォーカストラップ＆初期フォーカス用のダイアログ本体

  // Escで閉じる（保存/アップロード中は実行を取りこぼさないため無視）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (saving || uploading || shipBusy) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, uploading, shipBusy, onClose]);

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
          if (j.priceUsd != null) { setPriceUsd(String(j.priceUsd)); setPriceYen(Number(j.priceUsd) > 0 ? String(Math.round(Number(j.priceUsd) * USD_JPY)) : ""); }
          if (j.quantity != null) setQuantity(String(j.quantity));
          if (typeof j.floorUsd === "number") setFloorUsd(j.floorUsd);
          if (Array.isArray(j.refImages)) setRefImages(j.refImages);
          if (Array.isArray(j.images)) setImages(j.images);
          if (typeof j.title === "string") setFormTitle(j.title);
          if (typeof j.description === "string") setFormDesc(j.description);
          if (j.ship) setShip(j.ship);
        } else {
          setLoadError(j?.error || "出品情報を取得できませんでした。");
        }
      })
      .catch(() => alive && setLoadError("通信エラーで出品情報を取得できませんでした。"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [productId]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const j = await fetch("/api/ebay/list/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, priceUsd, quantity: Number(quantity), acceptLoss }),
      }).then((r) => r.json());
      if (j?.ok) {
        setDone(true);
        onSaved?.();
        setTimeout(onClose, 900);
      } else {
        setSaveError({ message: j?.error || "更新に失敗しました。", errorKind: j?.errorKind, errorDetail: j?.errorDetail });
        if (j?.errorKind !== "known") reportClientError("ebay_edit", { action: "price_edit", endpoint: "/api/ebay/list/edit", productId, detail: j?.errorDetail || j?.error || "(no detail)" });
      }
    } catch (e) {
      const detail = errToDetail(e);
      setSaveError({ message: "通信エラーで更新できませんでした。", errorKind: "unexpected", errorDetail: detail });
      reportClientError("ebay_edit", { action: "price_edit", endpoint: "/api/ebay/list/edit", productId, detail: `fetch例外: ${detail}` });
    }
    setSaving(false);
  };

  // 送料の出し方を切替（送料込み⇄送料別）。価格と配送ポリシーをサーバー側で同時更新する。
  const toggleShip = async (mode: "free" | "paid") => {
    setShipBusy(true); setShipMsg(null); setShipErr(null);
    try {
      const j = await fetch("/api/ebay/list/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, shipMode: mode }),
      }).then((r) => r.json());
      if (j?.ok) {
        if (j.priceUsd != null) setPriceUsd(String(j.priceUsd));
        setShip((p) => (p ? { ...p, mode } : p)); // 表示状態を反転（プレビュー額は次回開き直しで正確化）
        setShipMsg(mode === "free" ? "送料込み（送料無料）に切替えました" : "送料別に戻しました");
        onSaved?.();
      } else {
        setShipErr({ message: j?.error || "送料の切替に失敗しました。", errorKind: j?.errorKind, errorDetail: j?.errorDetail });
        if (j?.errorKind !== "known") reportClientError("ebay_ship_mode", { action: "ship_toggle", endpoint: "/api/ebay/list/edit", productId, detail: j?.errorDetail || j?.error || "(no detail)" });
      }
    } catch (e) {
      const detail = errToDetail(e);
      setShipErr({ message: "通信エラーで切替できませんでした。", errorKind: "unexpected", errorDetail: detail });
      reportClientError("ebay_ship_mode", { action: "ship_toggle", endpoint: "/api/ebay/list/edit", productId, detail: `fetch例外: ${detail}` });
    }
    setShipBusy(false);
  };

  const uploadPhotos = async () => {
    if (!files.length) return;
    setUploading(true);
    setPhotoError(null);
    setPhotoDone(null);
    const endpoint = "/api/ebay/list/photos";
    const ctx = { action: "photo_upload", endpoint, productId, fileCount: files.length };
    try {
      const fd = new FormData();
      fd.append("productId", productId);
      // 送信前にJPEG縮小（本文上限413対策）。縮小不可だった原本はそのまま送る。
      const prepared = await Promise.all(files.map((f) => downscaleForUpload(f)));
      prepared.forEach((b, i) => {
        if (b instanceof File) fd.append("files", b, b.name);
        else fd.append("files", b, `photo-${i + 1}.jpg`);
      });
      const res = await fetch(endpoint, { method: "POST", body: fd });
      // .json()直結だと非JSON応答(500のHTML/タイムアウト)で例外になり原因を失う→ status+本文を必ず捉える。
      const text = await res.text();
      let j: { ok?: boolean; added?: number; error?: string; errorKind?: "known" | "unexpected"; errorDetail?: string } | null = null;
      try { j = text ? JSON.parse(text) : null; } catch { /* 非JSON応答 */ }
      if (res.ok && j?.ok) {
        setPhotoDone(`実物写真を${j.added}枚 追加しました（出品に反映済み）`);
        setFiles([]);
        // 追加後の最新画像配列を取り直して写真管理(並び替え/加工)に反映。
        try {
          const r = await fetch(`/api/ebay/list/edit?id=${encodeURIComponent(productId)}`, { cache: "no-store" }).then((x) => x.json());
          if (r?.ok && Array.isArray(r.images)) setImages(r.images);
        } catch { /* noop */ }
        onSaved?.();
      } else {
        const detail = j?.errorDetail || j?.error || (text ? text.slice(0, 500) : `HTTP ${res.status}（本文なし）`);
        setPhotoError({
          message: j?.error || `写真の追加に失敗しました（コード ${res.status}）。`,
          errorKind: j?.errorKind || "unexpected",
          errorDetail: detail,
        });
        if (j?.errorKind !== "known") reportClientError("ebay_photos", { ...ctx, status: res.status, detail });
      }
    } catch (e) {
      const detail = errToDetail(e);
      setPhotoError({ message: "通信エラーで写真を追加できませんでした。", errorKind: "unexpected", errorDetail: detail });
      reportClientError("ebay_photos", { ...ctx, status: 0, detail: `fetch例外: ${detail}` });
    }
    setUploading(false);
  };

  // 件名・説明文を保存（在庫アイテム＋公開オファーの両方に反映）。
  const saveContent = async () => {
    setSavingContent(true); setContentErr(null); setContentDone(false);
    try {
      const j = await fetch("/api/ebay/list/edit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, title: formTitle, description: formDesc }),
      }).then((r) => r.json());
      if (j?.ok) { setContentDone(true); onSaved?.(); }
      else setContentErr({ message: j?.error || "更新に失敗しました。", errorKind: j?.errorKind, errorDetail: j?.errorDetail });
    } catch { setContentErr({ message: "通信エラーで更新できませんでした。", errorKind: "unexpected" }); }
    setSavingContent(false);
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
        {/* 本文＝ここだけスクロール（内容が縦長でもヘッダーは残る・✕に届く） */}
        <div className="overflow-y-auto px-4 py-3">

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
                    <p className="text-[11px] text-emerald-600 mt-0.5 mb-2">現在：送料込み（送料無料で出品中）</p>
                    <button
                      onClick={() => toggleShip("paid")}
                      disabled={shipBusy}
                      className="w-full min-h-[44px] py-1.5 rounded-lg border border-[#2D323B] text-[#2D323B] text-sm font-bold disabled:opacity-50 flex flex-col items-center justify-center leading-tight"
                    >
                      {shipBusy ? (
                        <span className="inline-flex items-center gap-2"><Spinner size={14} /> 切替中…</span>
                      ) : (
                        <>
                          <span>送料別に戻す</span>
                          {ship.unfoldUsd > 0 && <span className="text-[11px] font-normal opacity-80 tabular-nums whitespace-nowrap">価格 −約¥{Math.round(ship.unfoldUsd * 155).toLocaleString("ja-JP")}</span>}
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] text-gray-500 mt-0.5 mb-2"><span className="whitespace-nowrap">現在：送料別（購入者負担）。</span><wbr /><span className="whitespace-nowrap">送料無料の方が検索・転換に強い。</span></p>
                    <button
                      onClick={() => toggleShip("free")}
                      disabled={shipBusy || !ship.canFree}
                      className="w-full min-h-[44px] py-1.5 rounded-lg bg-violet-500 text-white text-sm font-bold disabled:opacity-50 flex flex-col items-center justify-center leading-tight"
                    >
                      {shipBusy ? (
                        <span className="inline-flex items-center gap-2"><Spinner size={14} /> 切替中…</span>
                      ) : (
                        <>
                          <span>送料込み（送料無料）に切替</span>
                          {ship.foldUsd > 0 && <span className="text-[11px] font-normal opacity-90 tabular-nums whitespace-nowrap">価格 +約¥{Math.round(ship.foldUsd * 155).toLocaleString("ja-JP")}</span>}
                        </>
                      )}
                    </button>
                    {!ship.canFree && <p className="text-[10px] text-orange-600 mt-1 leading-relaxed"><span className="whitespace-nowrap">※eBayに「送料無料」の配送ポリシーが必要</span><wbr /><span className="whitespace-nowrap">（eBayで一度作れば切替可）。</span></p>}
                  </>
                )}
                {shipErr && <ReportableError message={shipErr.message} errorKind={shipErr.errorKind} errorDetail={shipErr.errorDetail} where="ebay_ship_mode" context={{ productId }} className="mt-1" />}
                {shipMsg && <p className="text-[12px] text-emerald-600 mt-1">✓ {shipMsg}</p>}
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
                onChange={(e) => { setFiles(Array.from(e.target.files ?? []).slice(0, 6)); setPhotoDone(null); setPhotoError(null); }}
                className="block w-full text-[11px] text-gray-600 file:mr-2 file:h-8 file:px-3 file:rounded-lg file:border-0 file:bg-gray-100 file:text-gray-700 file:text-[11px] file:font-bold"
              />
              {files.length > 0 && <p className="text-[11px] text-gray-500 mt-1">{files.length}枚 選択中</p>}
              {photoError && <ReportableError message={photoError.message} errorKind={photoError.errorKind} errorDetail={photoError.errorDetail} where="ebay_photos" context={{ productId }} className="mt-1" />}
              {photoDone && <p className="text-[12px] text-emerald-600 mt-1 leading-relaxed">✓ {photoDone}</p>}
              <button
                onClick={uploadPhotos}
                disabled={uploading || files.length === 0}
                className="mt-2 w-full h-10 rounded-lg border border-[#2D323B] text-[#2D323B] text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {uploading ? (
                  <>
                    <Spinner size={14} /> アップロード中…（少し時間がかかります）
                  </>
                ) : (
                  <>
                    <ImagePlus size={15} /> 実物写真を追加
                  </>
                )}
              </button>
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
                    <input type="text" maxLength={80} value={formTitle} onChange={(e) => { setFormTitle(e.target.value); setContentDone(false); }} className="mt-1 w-full h-10 px-3 rounded-lg border border-[#A98B5C]/45 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D323B]/30 focus:border-[#2D323B]" />
                    <span className="block text-[10px] text-gray-400 mt-0.5 text-right tabular-nums">{formTitle.length}/80</span>
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-bold text-gray-600">説明文</span>
                    <textarea rows={6} maxLength={4000} value={formDesc} onChange={(e) => { setFormDesc(e.target.value); setContentDone(false); }} className="mt-1 w-full px-3 py-2 rounded-lg border border-[#A98B5C]/45 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#2D323B]/30 focus:border-[#2D323B]" />
                    <span className="block text-[10px] text-gray-400 mt-0.5">改行はそのまま反映。英語推奨。</span>
                  </label>
                  {contentErr && <ReportableError message={contentErr.message} errorKind={contentErr.errorKind} errorDetail={contentErr.errorDetail} where="ebay_edit_content" context={{ productId }} className="mt-1" />}
                  {contentDone && <p className="text-[12px] text-emerald-600">✓ 件名・説明を反映しました</p>}
                  <button type="button" onClick={saveContent} disabled={savingContent || formTitle.trim().length < 1} className="w-full h-10 rounded-lg border border-[#2D323B] text-[#2D323B] text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2">
                    {savingContent ? (<><Spinner size={14} /> 保存中…</>) : ("件名・説明を保存")}
                  </button>
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

            <div className="pt-3 mt-1 border-t border-[#A98B5C]/25">
              <button
                onClick={save}
                disabled={saving || !priceOk || !qtyOk || (belowFloor && !acceptLoss)}
                className="w-full h-11 rounded-lg bg-[#2D323B] text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <Spinner size={14} /> 保存中…
                  </>
                ) : (
                  "価格・数量を保存"
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
