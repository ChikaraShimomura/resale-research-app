"use client";
import { useEffect, useState } from "react";
import { X, ImagePlus } from "lucide-react";
import Spinner from "./Spinner";
import ReportableError from "./ReportableError";

type ErrInfo = { message: string; errorKind?: "known" | "unexpected"; errorDetail?: string };

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
  const [priceUsd, setPriceUsd] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ErrInfo | null>(null);
  const [done, setDone] = useState(false);
  const [files, setFiles] = useState<File[]>([]); // 追加する実物写真
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<ErrInfo | null>(null);
  const [photoDone, setPhotoDone] = useState<string | null>(null);
  const [refImages, setRefImages] = useState<string[]>([]); // 撮影の参考用：自宅ワーカーが取得した楽天ギャラリー
  // 送料の出し方（送料込み/別）の現在状態と切替プレビュー。
  const [ship, setShip] = useState<{ mode: "free" | "paid"; canFree: boolean; foldUsd: number; unfoldUsd: number } | null>(null);
  const [shipBusy, setShipBusy] = useState(false);
  const [shipMsg, setShipMsg] = useState<string | null>(null);
  const [shipErr, setShipErr] = useState<ErrInfo | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/ebay/list/edit?id=${encodeURIComponent(productId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j?.ok) {
          if (j.priceUsd != null) setPriceUsd(String(j.priceUsd));
          if (j.quantity != null) setQuantity(String(j.quantity));
          if (Array.isArray(j.refImages)) setRefImages(j.refImages);
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
        body: JSON.stringify({ productId, priceUsd, quantity: Number(quantity) }),
      }).then((r) => r.json());
      if (j?.ok) {
        setDone(true);
        onSaved?.();
        setTimeout(onClose, 900);
      } else {
        setSaveError({ message: j?.error || "更新に失敗しました。", errorKind: j?.errorKind, errorDetail: j?.errorDetail });
      }
    } catch {
      setSaveError({ message: "通信エラーで更新できませんでした。", errorKind: "unexpected" });
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
      }
    } catch {
      setShipErr({ message: "通信エラーで切替できませんでした。", errorKind: "unexpected" });
    }
    setShipBusy(false);
  };

  const uploadPhotos = async () => {
    if (!files.length) return;
    setUploading(true);
    setPhotoError(null);
    setPhotoDone(null);
    try {
      const fd = new FormData();
      fd.append("productId", productId);
      files.forEach((f) => fd.append("files", f));
      const j = await fetch("/api/ebay/list/photos", { method: "POST", body: fd }).then((r) => r.json());
      if (j?.ok) {
        setPhotoDone(`実物写真を${j.added}枚 追加しました（出品に反映済み）`);
        setFiles([]);
        onSaved?.();
      } else {
        setPhotoError({ message: j?.error || "写真の追加に失敗しました。", errorKind: j?.errorKind, errorDetail: j?.errorDetail });
      }
    } catch {
      setPhotoError({ message: "通信エラーで写真を追加できませんでした。", errorKind: "unexpected" });
    }
    setUploading(false);
  };

  const priceOk = Number(priceUsd) >= 0.01;
  const qtyOk = Number(quantity) >= 1 && Number(quantity) <= 30;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-[#A98B5C]/25 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-black text-gray-900">出品を編集</h2>
            {title && <p className="text-[11px] text-gray-400 truncate mt-0.5">{title}</p>}
          </div>
          <button onClick={onClose} aria-label="閉じる" className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-100 shrink-0">
            <X size={18} />
          </button>
        </div>

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
              <span className="text-[12px] font-bold text-gray-700">価格（USD）</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={priceUsd}
                onChange={(e) => setPriceUsd(e.target.value)}
                className="mt-1 w-full h-10 px-3 rounded-lg border border-[#A98B5C]/45 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D323B]/30 focus:border-[#2D323B]"
              />
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
              <span className="text-[10px] text-gray-400 mt-1 block">確保できる数だけにしてください（数が足りないと欠品キャンセルの原因になります）。</span>
            </label>

            {saveError && <ReportableError message={saveError.message} errorKind={saveError.errorKind} errorDetail={saveError.errorDetail} where="ebay_edit" context={{ productId }} className="mt-1" />}

            <button
              onClick={save}
              disabled={saving || !priceOk || !qtyOk}
              className="w-full h-11 rounded-lg bg-[#2D323B] text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Spinner size={14} /> 反映中…
                </>
              ) : (
                "この内容で更新"
              )}
            </button>

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
                      className="w-full h-10 rounded-lg border border-[#2D323B] text-[#2D323B] text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {shipBusy ? <><Spinner size={14} /> 切替中…</> : `送料別に戻す${ship.unfoldUsd > 0 ? `（価格 −$${ship.unfoldUsd.toFixed(2)}）` : ""}`}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] text-gray-500 mt-0.5 mb-2">現在：送料別（購入者が送料を負担）。送料無料の方が検索・転換に強いです。</p>
                    <button
                      onClick={() => toggleShip("free")}
                      disabled={shipBusy || !ship.canFree}
                      className="w-full h-10 rounded-lg bg-violet-500 text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {shipBusy ? <><Spinner size={14} /> 切替中…</> : `送料込み（送料無料）に切替${ship.foldUsd > 0 ? `（価格 +$${ship.foldUsd.toFixed(2)}）` : ""}`}
                    </button>
                    {!ship.canFree && <p className="text-[10px] text-orange-600 mt-1 leading-relaxed">※eBayに「送料無料」の配送ポリシーが必要です（eBayで一度作成すれば切替できます）。</p>}
                  </>
                )}
                {shipErr && <ReportableError message={shipErr.message} errorKind={shipErr.errorKind} errorDetail={shipErr.errorDetail} where="ebay_ship_mode" context={{ productId }} className="mt-1" />}
                {shipMsg && <p className="text-[12px] text-emerald-600 mt-1">✓ {shipMsg}</p>}
              </div>
            )}

            <div className="pt-3 mt-1 border-t border-[#A98B5C]/25">
              <span className="text-[12px] font-bold text-gray-700">実物写真を追加</span>
              <p className="text-[10px] text-gray-400 mt-0.5 mb-2 leading-relaxed">
                実物の写真を足すと売れやすくなります。楽天の画像は残したままeBayに移して追加します（最大6枚・1枚12MBまで・JPG/PNG等）。eBay側で触ると出品の管理が外れるので、写真の変更はここから。
              </p>
              {refImages.length > 0 && (
                <div className="mb-2">
                  <span className="text-[11px] font-bold text-gray-600">📷 撮影の参考（楽天の商品写真 {refImages.length}枚）</span>
                  <p className="text-[10px] text-gray-400 mt-0.5 mb-1.5 leading-relaxed">このアングルを参考に実物を撮ると伝わりやすいです（※参考用。これはeBayには載せません）。</p>
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
          </div>
        )}
      </div>
    </div>
  );
}
