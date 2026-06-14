import { PlayCircle } from "lucide-react";

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
};

/**
 * 縦型(9:16)ガイド動画の埋め込みカード。
 * 既定はローカルMP4を再生。YouTubeに上げたら youTubeId を渡すだけで切替できる。
 */
export default function GuideVideo({
  title,
  src,
  youTubeId,
  poster,
  durationLabel,
  note,
}: GuideVideoProps) {
  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <PlayCircle size={20} className="text-[#BF0000] shrink-0" />
        <h2 className="text-[14px] font-black text-gray-800 leading-snug flex-1">{title}</h2>
        {durationLabel && (
          <span className="text-[11px] font-bold text-[#BF0000] bg-[#BF0000]/8 border border-[#BF0000]/20 rounded-full px-2.5 py-1 shrink-0">
            ▶ {durationLabel}
          </span>
        )}
      </div>

      <div className="mx-auto w-full max-w-[320px]">
        <div className="relative rounded-2xl overflow-hidden bg-black shadow-md" style={{ aspectRatio: "9 / 16" }}>
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
            <video
              className="absolute inset-0 w-full h-full object-contain"
              src={src}
              poster={poster}
              controls
              preload="metadata"
              playsInline
            />
          )}
        </div>
      </div>

      {note && <p className="text-[11.5px] text-gray-500 leading-relaxed text-center mt-3">{note}</p>}
      <p className="text-[10px] text-gray-400 text-center mt-2">音声：VOICEVOX：春日部つむぎ</p>
    </section>
  );
}
