"use client";
import { useRef, useState } from "react";
import { ArrowUp, ArrowDown, Star, Trash2, Wand2, RotateCcw, RotateCw, Crop, Eraser, ArrowLeft } from "lucide-react";
import Spinner from "./Spinner";
import { epsSizedUrl } from "../lib/ebay/epsUrl";
import { reportClientError, errToDetail } from "../lib/clientError";

type Op = "rotate90" | "rotate-90" | "crop" | "textremove";
type CropRect = { x: number; y: number; w: number; h: number };

// 出品中の写真を「並び替え・メイン設定・削除・加工(回転/トリミング/文字消去)」する。先頭=メイン画像。
// staged=true（既定）：この画面の変更は「保存」を押すまでeBayに反映しない。並び替え/削除/メインはローカル配列のみ更新し、
//   加工(回転/切り抜き/文字消去)はサーバーでEPS再ホストするが出品には書かず新URLを配列に差し替えるだけ（stage:true）。
//   → 最後の「保存」で写真配列ごとeBayへ書く（写真も価格も同じタイミングで有効化）。
// staged=false：従来どおり各操作を即時に出品へ反映する（他画面から使う場合の後方互換）。
export default function PhotoManager({ productId, images, onImagesChange, staged = true }: {
  productId: string;
  images: string[];
  onImagesChange: (imgs: string[]) => void;
  staged?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<number | null>(null); // 加工中の画像index
  const [cropMode, setCropMode] = useState(false);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ mode: "move" | "tl" | "tr" | "bl" | "br"; sx: number; sy: number; orig: CropRect } | null>(null);

  const post = async (payload: object): Promise<boolean> => {
    setBusy(true); setErr(null);
    const p = payload as { action?: string; op?: string };
    const opDetail = p.op ? ` op=${p.op}` : "";
    try {
      const j = await fetch("/api/ebay/list/photo-edit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, ...payload }),
      }).then((r) => r.json());
      if (j?.ok && Array.isArray(j.imageUrls)) { onImagesChange(j.imageUrls); setBusy(false); return true; }
      if (j?.errorKind !== "known") reportClientError("ebay_photos_edit", { action: "photo_edit", endpoint: "/api/ebay/list/photo-edit", status: 0, productId, detail: `${p.action ?? ""}${opDetail} ${j?.errorDetail || j?.error || "(no detail)"}`.trim() });
      setErr(j?.error || "操作に失敗しました。"); setBusy(false); return false;
    } catch (e) {
      reportClientError("ebay_photos_edit", { action: "photo_edit", endpoint: "/api/ebay/list/photo-edit", status: 0, productId, detail: `fetch例外: ${errToDetail(e)} ${p.action ?? ""}${opDetail}`.trim() });
      setErr("通信エラーで操作に失敗しました。"); setBusy(false); return false;
    }
  };

  // staged：並び替え/削除/メインは即時に出品へ書かず、ローカル配列だけ更新（保存時にまとめて反映）。
  const setOrder = (next: string[]): Promise<boolean> => {
    if (staged) { onImagesChange(next); return Promise.resolve(true); }
    return post({ action: "order", imageUrls: next });
  };
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
    // クライアントが今表示している配列(=正)とindexを送る＝サーバーで取り直し/突合しない（順番・枚数のズレで詰まらない）。
    // staged時は stage:true＝加工画像をEPSに載せて新URLを配列に差し替えるだけ（出品への書き込みは保存時）。
    const ok = await post({ action: "transform", imageUrls: images, index: edit, op, crop: cropArg, stage: staged });
    if (ok) { setCropMode(false); setCrop(null); }
  };

  // ── 切り抜き：eBay風（四隅ハンドルでリサイズ＋枠内ドラッグで移動）。座標は表示画像に対する割合(0〜1)。──
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const MIN = 0.12; // 枠の最小サイズ(割合)＝小さすぎる切り抜き(低画質/500px割れ)を防ぐ
  const ptFrac = (e: React.PointerEvent) => {
    const r = imgRef.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };
  const startDrag = (mode: "move" | "tl" | "tr" | "bl" | "br") => (e: React.PointerEvent) => {
    if (!crop || !imgRef.current) return;
    e.stopPropagation();
    const p = ptFrac(e);
    dragRef.current = { mode, sx: p.x, sy: p.y, orig: crop };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onCropMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    const p = ptFrac(e);
    const dx = p.x - d.sx, dy = p.y - d.sy;
    const o = d.orig;
    if (d.mode === "move") {
      setCrop({ x: clamp01(Math.min(o.x + dx, 1 - o.w)), y: clamp01(Math.min(o.y + dy, 1 - o.h)), w: o.w, h: o.h });
      return;
    }
    // 四隅リサイズ：対角を固定して反対の辺を動かす。最小サイズMINを保つ。
    let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
    if (d.mode.includes("l")) x1 = Math.min(clamp01(o.x + dx), x2 - MIN);
    if (d.mode.includes("r")) x2 = Math.max(clamp01(o.x + o.w + dx), x1 + MIN);
    if (d.mode.includes("t")) y1 = Math.min(clamp01(o.y + dy), y2 - MIN);
    if (d.mode.includes("b")) y2 = Math.max(clamp01(o.y + o.h + dy), y1 + MIN);
    setCrop({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  };
  const onCropUp = () => { dragRef.current = null; };

  // 切り抜き開始時の初期枠＝中央90%（四隅ハンドルが画像内に見えるよう少し内側に）。
  const initCrop = (): CropRect => ({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });

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
          {cropMode && c && (
            // 切り抜き枠：外側を暗く(box-shadow)＋三分割グリッド＋四隅ハンドル。枠内ドラッグで移動、四隅でリサイズ。
            <div
              className="absolute border border-white"
              style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%`, boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)", touchAction: "none", cursor: "move" }}
              onPointerDown={startDrag("move")}
              onPointerMove={onCropMove}
              onPointerUp={onCropUp}
            >
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute left-0 right-0 top-1/3 border-t border-white/50" />
                <div className="absolute left-0 right-0 top-2/3 border-t border-white/50" />
                <div className="absolute top-0 bottom-0 left-1/3 border-l border-white/50" />
                <div className="absolute top-0 bottom-0 left-2/3 border-l border-white/50" />
              </div>
              {(["tl", "tr", "bl", "br"] as const).map((cn) => (
                <div
                  key={cn}
                  onPointerDown={startDrag(cn)}
                  onPointerMove={onCropMove}
                  onPointerUp={onCropUp}
                  className="absolute w-5 h-5 rounded-full bg-white border-2 border-[#2D323B] shadow"
                  style={{
                    left: cn.includes("l") ? "0%" : "100%",
                    top: cn.includes("t") ? "0%" : "100%",
                    transform: "translate(-50%,-50%)",
                    touchAction: "none",
                    cursor: cn === "tl" || cn === "br" ? "nwse-resize" : "nesw-resize",
                  }}
                />
              ))}
            </div>
          )}
          {busy && <div className="absolute inset-0 bg-white/60 flex items-center justify-center"><Spinner size={20} /></div>}
        </div>
        {!cropMode && <p className="text-[10px] text-gray-400 mt-1 leading-snug">白い余白＝eBayの正方形フレーム。縦長/横長でも全体が収まります（保存時に確定）。</p>}
        {cropMode ? (
          <div className="mt-2">
            <p className="text-[11px] text-gray-500 mb-1.5">四隅の○をドラッグで枠を調整、枠の中をドラッグで移動。三分割グリッドを目安に。保存時にeBayの正方形フレーム(白フチ)に収めます。</p>
            <div className="flex gap-2">
              <button type="button" disabled={busy || !(c && c.w > 0.02 && c.h > 0.02)} onClick={() => transform("crop", c!)} className="flex-1 h-10 rounded-lg bg-[#2D323B] text-white text-[13px] font-bold disabled:opacity-50">この範囲で切り抜く</button>
              <button type="button" disabled={busy} onClick={() => { setCropMode(false); setCrop(null); }} className="h-10 px-4 rounded-lg border border-gray-300 text-gray-600 text-[13px] font-bold">やめる</button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2 mt-2">
            <button type="button" disabled={busy} onClick={() => transform("rotate-90")} className="flex flex-col items-center justify-center gap-0.5 h-14 rounded-lg border border-[#A98B5C]/35 bg-white text-gray-600 text-[10px] font-bold disabled:opacity-50 leading-none"><RotateCcw size={16} /><span>左に回転</span></button>
            <button type="button" disabled={busy} onClick={() => transform("rotate90")} className="flex flex-col items-center justify-center gap-0.5 h-14 rounded-lg border border-[#A98B5C]/35 bg-white text-gray-600 text-[10px] font-bold disabled:opacity-50 leading-none"><RotateCw size={16} /><span>右に回転</span></button>
            <button type="button" disabled={busy} onClick={() => { setCropMode(true); setCrop(initCrop()); }} className="flex flex-col items-center justify-center gap-0.5 h-14 rounded-lg border border-[#A98B5C]/35 bg-white text-gray-600 text-[10px] font-bold disabled:opacity-50 leading-none"><Crop size={16} /><span>切り抜き</span></button>
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
