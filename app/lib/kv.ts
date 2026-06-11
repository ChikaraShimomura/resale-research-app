import { createClient } from "@vercel/kv";

// 公開・読み取り専用パス用の KV クライアント。
// 読み取り専用トークンを使うことで、公開APIから万一漏れてもデータを書き換えられない。
// 読み取り専用トークン未設定の環境では通常トークンにフォールバック。
export const kvReadOnly = createClient({
  url: process.env.KV_REST_API_URL ?? "",
  token: process.env.KV_REST_API_READ_ONLY_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "",
});
