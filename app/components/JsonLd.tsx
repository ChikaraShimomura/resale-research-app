import { headers } from "next/headers";

// schema.org 構造化データ(JSON-LD)を CSP nonce 付きで出力するサーバーコンポーネント。
// `<` を < にエスケープして </script> 注入（スクレイピング由来のタイトル等）を防ぐ。
export default async function JsonLd({ data }: { data: Record<string, unknown> }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      // ブラウザがnonce属性を隠すためhydration不一致になるが内容は不変なので抑制
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
