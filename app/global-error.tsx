"use client";
// ルートレイアウト自体で例外が出た時の最終防衛線（html/bodyを自前で描く必要がある）。
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ja">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#F5F7FA" }}>
        <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ maxWidth: 380, width: "100%", background: "#fff", border: "1px solid rgba(169,139,92,0.25)", borderRadius: 16, padding: 24, textAlign: "center" }}>
            <p style={{ fontSize: 28, margin: "0 0 8px" }}>⚠️</p>
            <h1 style={{ fontSize: 14, fontWeight: 800, color: "#1f2937", margin: "0 0 4px" }}>一時的なエラーが発生しました</h1>
            <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 20px" }}>少し時間をおいて、もう一度お試しください。</p>
            <button onClick={() => reset()} style={{ height: 44, padding: "0 24px", background: "#2D323B", color: "#fff", fontWeight: 700, fontSize: 14, border: "none", borderRadius: 12 }}>
              もう一度
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
