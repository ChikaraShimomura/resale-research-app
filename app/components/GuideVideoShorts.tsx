import { PlayCircle } from "lucide-react";

type Short = {
  label: string;
  src: string;
  poster?: string;
  durationLabel?: string;
};

type GuideVideoShortsProps = {
  title: string;
  note?: string;
  shorts: Short[];
};

/**
 * STEPごとの短い動画を横スクロールで並べるカード。
 * 各動画は preload="none"（タップで読み込み）なので一覧表示が軽い。
 */
export default function GuideVideoShorts({ title, note, shorts }: GuideVideoShortsProps) {
  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-1">
        <PlayCircle size={20} className="text-[#BF0000] shrink-0" />
        <h2 className="text-[14px] font-black text-gray-800 leading-snug flex-1">{title}</h2>
      </div>
      {note && <p className="text-[11.5px] text-gray-500 leading-relaxed mb-3">{note}</p>}

      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory">
        {shorts.map((s, i) => (
          <div key={i} className="w-[150px] shrink-0 snap-start">
            <div className="relative rounded-xl overflow-hidden bg-black shadow-sm" style={{ aspectRatio: "9 / 16" }}>
              <video
                className="absolute inset-0 w-full h-full object-contain"
                src={s.src}
                poster={s.poster}
                controls
                preload="none"
                playsInline
              />
            </div>
            <div className="flex items-center justify-between gap-1 mt-1.5">
              <span className="text-[12px] font-bold text-gray-800 leading-tight">{s.label}</span>
              {s.durationLabel && (
                <span className="text-[10px] font-bold text-[#BF0000] shrink-0">{s.durationLabel}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
