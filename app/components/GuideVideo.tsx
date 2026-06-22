"use client";
import { useEffect, useRef, useState } from "react";
import { PlayCircle, Volume2 } from "lucide-react";

type GuideVideoProps = {
  /** カード見出し */
  title: string;
  /** ローカル動画パス（例: "/videos/ebay-seller-guide.mp4"）。youTubeId 未指定時に使用 */
  src?: string;
  /** YouTube（ショート可）の動画ID。指定するとYouTube埋め込みを優先 */
  youTubeId?: string;
  /** サムネイル画像（ローカル動画用） */
  poster?: string;
  /** 例: "1分50秒" */
  durationLabel?: string;
  /** 動画の下に出す一言 */
  note?: string;
  /** 画面内に入ったらミュートで自動再生し「音声をオン」ボタンを出す（ホーム用）。
   *  音付き自動再生はブラウザがブロックするため、ミュート自動再生＋焼き込み字幕で内容を伝える方式。 */
  autoplayInView?: boolean;
};

/**
 * 縦型(9:16)ガイド動画の埋め込みカード。
 * 既定はローカルMP4を再生。YouTubeに上げたら youTubeId を渡すだけで切替できる。
 * autoplayInView=true で「画面内ミュート自動再生＋音声オン」モード（ホームのファーストビュー用）。
 */
export default function GuideVideo({
  title,
  src,
  youTubeId,
  poster,
  durationLabel,
  note,
  autoplayInView,
}: GuideVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [showUnmute, setShowUnmute] = useState(false);

  // 画面内に入ったらミュート再生／外れたら一時停止（IntersectionObserver）。
  useEffect(() => {
    if (!autoplayInView || youTubeId) return;
    const v = videoRef.current;
    const w = wrapRef.current;
    if (!v || !w) return;
    v.muted = true; // ミュートでないと自動再生がブロックされる
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            v.play().then(() => setShowUnmute(v.muted)).catch(() => {});
          } else {
            v.pause();
          }
        }
      },
      { threshold: 0.5 }
    );
    io.observe(w);
    return () => io.disconnect();
  }, [autoplayInView, youTubeId]);

  const enableSound = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    setShowUnmute(false);
    v.play().catch(() => {});
  };

  return (
    <section className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <PlayCircle size={20} className="text-[#2D323B] shrink-0" />
        <h2 className="text-[14px] font-black text-gray-800 leading-snug flex-1">{title}</h2>
        {durationLabel && (
          <span className="text-[11px] font-bold text-[#2D323B] bg-[#2D323B]/8 border border-[#2D323B]/20 rounded-full px-2.5 py-1 shrink-0">
            ▶ {durationLabel}
          </span>
        )}
      </div>

      <div className="mx-auto w-full max-w-[320px]">
        <div ref={wrapRef} className="relative rounded-2xl overflow-hidden bg-black shadow-md" style={{ aspectRatio: "9 / 16" }}>
          {youTubeId ? (
            <iframe
              className="absolute inset-0 w-full h-full"
              src={`https://www.youtube-nocookie.com/embed/${youTubeId}?rel=0`}
              title={title}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : (
            <>
              <video
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-contain"
                src={src}
                poster={poster}
                controls
                preload="metadata"
                playsInline
              />
              {autoplayInView && showUnmute && (
                <button
                  type="button"
                  onClick={enableSound}
                  aria-label="音声をオンにする"
                  className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/30"
                >
                  <span className="w-16 h-16 rounded-full bg-[#2D323B]/90 ring-2 ring-white/70 flex items-center justify-center text-white">
                    <Volume2 size={28} />
                  </span>
                  <span className="text-[13px] font-bold text-white bg-black/55 px-3.5 py-1.5 rounded-full">
                    タップで音声を出す
                  </span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {note && <p className="text-[11.5px] text-gray-500 leading-relaxed text-center mt-3">{note}</p>}
      <p className="text-[10px] text-gray-400 text-center mt-2">音声：VOICEVOX：ずんだもん</p>
    </section>
  );
}
