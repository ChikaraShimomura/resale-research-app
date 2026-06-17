// 処理中を示す軽量スピナー（グルグル）。色は border-current で親の文字色を継承する。
export default function Spinner({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="読み込み中"
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent align-[-0.125em] ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
