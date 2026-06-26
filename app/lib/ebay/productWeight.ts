// 出品時(prepare)に、その商品だけ梱包済み重量(g)を推定してKVキャッシュする。
// ＝カタログ全件を先に取りに行かず「実際に出す品だけ」に課金を絞る最小コスト方式（ユーザー指示2026-06-27）。
// Haikuの知識ベース（Web検索なし＝低コスト・低レイテンシ）。自信が低い/失敗時はカテゴリ概算にフォールバック。
// 重量は不変なので一度引けば以後はキャッシュ無料。prepare は元々 ANTHROPIC_API_KEY を使う（説明文校正）ので追加の鍵は不要。
import { kv } from "@vercel/kv";
import { estimateWeightG } from "./landedCost";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const WEIGHT_MODEL = process.env.WEIGHT_MODEL ?? "claude-haiku-4-5";
const WEIGHT_KEY = (id: string) => `weight:${id}`;
const WEIGHT_TTL = 365 * 24 * 60 * 60; // 重量は不変。1年キャッシュ。

interface WeightInput {
  id?: string;
  category?: string;
  coreKeyword?: string;
  title?: string;
  brand?: string;
  name?: string;
}

// 梱包済み重量(g)を返す。cache → AI(知識のみ) → カテゴリ概算 の順。AIが走った時だけ結果をキャッシュ
// （鍵無し/通信失敗は一過性なのでキャッシュせず次回再試行。低自信や異常値は概算へ落として再呼び出しを避けるためキャッシュ）。
export async function estimateProductWeightG(product: WeightInput): Promise<number> {
  const id = product.id || "";
  const fallback = estimateWeightG(product.category);
  if (id) {
    try {
      const c = await kv.get<number>(WEIGHT_KEY(id));
      if (typeof c === "number" && c > 0) return c;
    } catch { /* noop */ }
  }
  if (!ANTHROPIC_API_KEY) return fallback; // 鍵無し＝常に概算（キャッシュしない）
  const label = [product.brand, product.coreKeyword, product.name, product.title].filter(Boolean).join(" ").slice(0, 160);
  const prompt = `Estimate the SHIPPING weight in grams (including typical retail box and protective packaging) of this used product for an international parcel.\nProduct: "${label}" (category: ${product.category ?? "unknown"}).\nReply with ONLY a JSON object: {"grams": <integer>, "confidence": "high"|"med"|"low"}. If you are not reasonably sure of the exact model, use "low" and a sensible generic guess. No prose.`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: WEIGHT_MODEL, max_tokens: 60, temperature: 0, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return fallback; // 一過性＝キャッシュしない
    const d = await r.json();
    const text: string = (d?.content?.[0]?.text ?? "").replace(/```[a-z]*|```/gi, "").trim();
    const m = text.match(/\{[\s\S]*\}/);
    const parsed = m ? (JSON.parse(m[0]) as { grams?: number; confidence?: string }) : {};
    const g = Math.round(Number(parsed.grams) || 0);
    // 低自信 or 常識外(10g未満/30kg超)はカテゴリ概算へ。AIは走ったので結果(概算でも)をキャッシュして再呼び出しを防ぐ。
    const finalG = parsed.confidence !== "low" && g >= 10 && g <= 30000 ? g : fallback;
    if (id) { try { await kv.set(WEIGHT_KEY(id), finalG, { ex: WEIGHT_TTL }); } catch { /* noop */ } }
    return finalG;
  } catch {
    return fallback; // タイムアウト等＝キャッシュしない（次回再試行）
  }
}
