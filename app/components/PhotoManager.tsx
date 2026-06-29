"use client";
import { useRef, useState } from "react";
import { ArrowUp, ArrowDown, Star, Trash2, Wand2, RotateCcw, RotateCw, Crop, Eraser, ArrowLeft } from "lucide-react";
import Spinner from "./Spinner";
import { epsSizedUrl } from "../lib/ebay/epsUrl";

type Op = "rotate90" | "rotate-90" | "crop" | "textremove";
type CropRect = { x: number; y: number; w: number; h: number };

// 出品中の写真を「並び替え・メイン設定・削除・加工(回転/トリミング/文字消去)」する。
// 反映は即時（/api/ebay/list/photo-edit）。先頭=メイン画像。加工はサーバーでEPS再ホスト→配列の同じ位置に差し替え。
export default function PhotoManager({ productId, images, onImagesChange }: {
  productId: string;
  images: string[];
  onImagesChange: (imgs: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<number | null>(null); // 加工中の画像index
  const [cropMode, setCropMode] = useState(false);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const post = async (payload: object): Promise<boolean> => {
    setBusy(true); setErr(null);
    try {
      const j = await fetch("/api/ebay/list/photo-edit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, ...payload }),
      }).then((r) => r.json());
      if (j?.ok && Array.isArray(j.imageUrls)) { onImagesChange(j.imageUrls); setBusy(false); return true; }
      setErr(j?.error || "操作に失敗しました。"); setBusy(false); return false;
    } catch { setErr("通信エラーで操作に失敗しました。"); setBusy(false); return false; }
  };

  const setOrder = (next: string[]) => post({ action: "order", imageUrls: next });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= images.length) return;
    const next = images.slice(); [next[i], next[j]] = [next[j], next[i]]; setOrder(next);
  };
  const makeMain = (i: number) => { if (i === 0) return; const next = images.slice(); const [m] = next.splice(i, 1); next.unshift(m); setOrder(next); };
  const del = (i: number) => {
    if (images.length <= 1) { setErr("写真は最低1枚必要です。"); return; }
    if (typeof window !== "undefined" && !window.confirm("この写真を出品から削除します。よろしいですか？")) return;
    const next = images.slice(); next.splice(i, 1); setOrder(next);
  };
  const transform = async (op: Op, cropArg?: CropRect) => {
    if (edit == null) return;
    const ok = await post({ action: "transform", imageUrl: images[edit], op, crop: cropArg });
    if (ok) { setCropMode(false); setCrop(null); }
  };

  // クロップのドラッグ（pointer events＝タッチ/マウス両対応）。座標は表示画像に対する割合(0〜1)で保持。
  const onDown = (e: React.PointerEvent) => {
    if (!cropMode) return;
    const el = imgRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    dragStart.current = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    setCrop({ x: dragStart.current.x, y: dragStart.current.y, w: 0, h: 0 });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!cropMode || !dragStart.current) return;
    const el = imgRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const cy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const s = dragStart.current;
    setCrop({ x: Math.min(s.x, cx), y: Math.min(s.y, cy), w: Math.abs(cx - s.x), h: Math.abs(cy - s.y) });
  };
  const onUp = () => { dragStart.current = null; };

  // ── 加工パネル（1枚を回転/切り抜き/文字消去） ──
  if (edit != null && images[edit]) {
    const c = crop;
    return (
      <div>
        <button type="button" onClick={() => { setEdit(null); setCropMode(false); setCrop(null); setErr(null); }} className="inline-flex items-center gap-1 text-[12px] font-bold text-gray-600 mb-2"><ArrowLeft size={14} /> 写真一覧へ戻る</button>
        {/* 通常時=正方形フレーム(白背景)でeBayでの見え方を表示／切り抜き時=元比率にして枠の座標を元画像に正しく対応させる。 */}
        <div className={`relative w-full rounded-lg overflow-hidden border border-[#A98B5C]/25 ${cropMode ? "bg-gray-50" : "bg-white aspect-square"}`} style={{ touchAction: cropMode ? "none" : "auto" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imgRef} src={epsSizedUrl(images[edit], 1600)} alt="加工対象" className={`select-none ${cropMode ? "block w-full h-auto" : "w-full h-full object-contain"}`} draggable={false} />
          {cropMode && (
            <div className="absolute inset-0 cursor-crosshair" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
              {c && c.w > 0 && c.h > 0 && (
                <div className="absolute border-2 border-[#2D323B] bg-[#2D323B]/10" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }} />
              )}
            </div>
          )}
          {busy && <div className="absolute inset-0 bg-white/60 flex items-center justify-center"><Spinner size={20} /></div>}
        </div>
        {!cropMode && <p className="text-[10px] text-gray-400 mt-1 leading-snug">白い余白＝eBayの正方形フレーム。縦長/横長でも全体が収まります（保存時に確定）。</p>}
        {cropMode ? (
          <div className="mt-2">
            <p className="text-[11px] text-gray-500 mb-1.5">画像の上をドラッグして、残す範囲を四角で囲ってください。</p>
            <div className="flex gap-2">
              <button type="button" disabled={busy || !(c && c.w > 0.02 && c.h > 0.02)} onClick={() => transform("crop", c!)} className="flex-1 h-10 rounded-lg bg-[#2D323B] text-white text-[13px] font-bold disabled:opacity-50">この範囲で切り抜く</button>
              <button type="button" disabled={busy} onClick={() => { setCropMode(false); setCrop(null); }} className="h-10 px-4 rounded-lg border border-gray-300 text-gray-600 text-[13px] font-bold">やめる</button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2 mt-2">
            <button type="button" disabled={busy} onClick={() => transform("rotate-90")} className="flex flex-col items-center justify-center gap-0.5 h-14 rounded-lg border border-[#A98B5C]/35 bg-white text-gray-600 text-[10px] font-bold disabled:opacity-50 leading-none"><RotateCcw size={16} /><span>左に回転</span></button>
            <button type="button" disabled={busy} onClick={() => transform("rotate90")} className="flex flex-col items-center justify-center gap-0.5 h-14 rounded-lg border border-[#A98B5C]/35 bg-white text-gray-600 text-[10px] font-bold disabled:opacity-50 leading-none"><RotateCw size={16} /><span>右に回転</span></button>
            <button type="button" disabled={busy} onClick={() => { setCropMode(true); setCrop(null); }} className="flex flex-col items-center justify-center gap-0.5 h-14 rounded-lg border border-[#A98B5C]/35 bg-white text-gray-600 text-[10px] font-bold disabled:opacity-50 leading-none"><Crop size={16} /><span>切り抜き</span></button>
            <button type="button" disabled={busy} onClick={() => transform("textremove")} className="flex flex-col items-center justify-center gap-0.5 h-14 rounded-lg border border-[#A98B5C]/35 bg-white text-gray-600 text-[10px] font-bold disabled:opacity-50 leading-none"><Eraser size={16} /><span>文字消去</span></button>
          </div>
        )}
        {err && <p className="text-[11px] text-rose-600 font-bold mt-1.5">{err}</p>}
      </div>
    );
  }

  // ── 写真一覧（並び替え/メイン/削除/加工） ──
  return (
    <div>
      <ol className="space-y-1.5">
        {images.map((url, i) => (
          <li key={url + i} className="flex items-center gap-2 bg-gray-50 rounded-lg p-1.5">
            <div className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={epsSizedUrl(url, 300)} alt={`写真${i + 1}`} className="w-12 h-12 object-cover rounded-md border border-[#A98B5C]/25 bg-white" />
              {i === 0 && <span className="absolute -top-1 -left-1 text-[8px] font-bold bg-[#2D323B] text-white px-1 rounded">メイン</span>}
            </div>
            <div className="flex items-center gap-1 ml-auto">
              <button type="button" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label="前へ" className="w-7 h-7 flex items-center justify-center rounded-md border border-gray-200 text-gray-500 disabled:opacity-30 active:bg-gray-100"><ArrowUp size={14} /></button>
              <button type="button" disabled={busy || i === images.length - 1} onClick={() => move(i, 1)} aria-label="後へ" className="w-7 h-7 flex items-center justify-center rounded-md border border-gray-200 text-gray-500 disabled:opacity-30 active:bg-gray-100"><ArrowDown size={14} /></button>
              <button type="button" disabled={busy || i === 0} onClick={() => makeMain(i)} aria-label="メイン写真にする" className="w-7 h-7 flex items-center justify-center rounded-md border border-gray-200 text-[#A98B5C] disabled:opacity-30 active:bg-gray-100"><Star size={14} /></button>
              <button type="button" disabled={busy} onClick={() => setEdit(i)} aria-label="加工" className="w-7 h-7 flex items-center justify-center rounded-md border border-[#2D323B]/30 bg-[#2D323B]/5 text-[#2D323B] active:bg-[#2D323B]/10"><Wand2 size={14} /></button>
              <button type="button" disabled={busy || images.length <= 1} onClick={() => del(i)} aria-label="削除" className="w-7 h-7 flex items-center justify-center rounded-md border border-gray-200 text-gray-400 disabled:opacity-30 active:bg-gray-100"><Trash2 size={14} /></button>
            </div>
          </li>
        ))}
      </ol>
      {busy && <p className="text-[11px] text-gray-400 mt-1.5 flex items-center gap-1"><Spinner size={12} /> 反映中…</p>}
      {err && <p className="text-[11px] text-rose-600 font-bold mt-1.5">{err}</p>}
    </div>
  );
}
