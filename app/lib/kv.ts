import { createClient } from "@vercel/kv";

// 公開・読み取り専用パス用の KV クライアント。
// 読み取り専用トークンを使うことで、公開APIから万一漏れてもデータを書き換えられない。
// 読み取り専用トークン未設定の環境では通常トークンにフォールバック。
// 空文字トークンは ?? をすり抜け読み取りパス全体を無言で空にするため、|| で falsy 弾き＋trim する。
const roToken = process.env.KV_REST_API_READ_ONLY_TOKEN?.trim();
const rwToken = process.env.KV_REST_API_TOKEN?.trim();
export const kvReadOnly = createClient({
  url: process.env.KV_REST_API_URL?.trim() ?? "",
  token: (roToken || rwToken) ?? "",
});
