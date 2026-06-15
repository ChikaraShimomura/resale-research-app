// 出品説明文を Gemini(無料枠) でチェック・自然化する。
// 方針/トラブル回避の文を削らせないよう厳格に指示し、呼び出し側で必須句の残存も検証する。
// 失敗・キー無し・必須句欠落時は null を返し、呼び出し側で「作り込んだ定型文」にフォールバックさせる。
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// 無料枠の都合で 2.0-flash は枠ゼロ化されたため 2.5-flash に移行（環境変数で上書き可）。
// 2.5系は思考モデルなので thinkingConfig.thinkingBudget:0 で思考を無効化しないと出力が空になりうる。
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

export async function geminiRefineDescription(draft: string): Promise<string | null> {
  if (!GEMINI_API_KEY || !draft) return null;
  const prompt = `You are proofreading an eBay listing description written by a Japanese seller who ships internationally. Improve clarity, grammar, and natural English so it reads like a trustworthy, professional eBay listing.

STRICT RULES:
- Output English only. Keep it concise (under about 1800 characters).
- Keep the Q&A structure and the 【 ... 】 section headers.
- Keep EVERY existing fact and policy. Do NOT remove or weaken any of: authenticity, ships from Japan with tracking, delivery time, that customs/import duties are the buyer's responsibility, packaging, returns / eBay Money Back Guarantee, "contact me before opening a case", the no-warranty / contact-the-manufacturer note, and any region/voltage/import notes.
- Do NOT invent new claims (no warranty, no specific specs, no measurements, no prices, no condition that is not already stated).
- Do NOT change the product title on the first line.
Return ONLY the improved description text. No preamble, no explanations, no code fences.

--- DRAFT ---
${draft}`;
  try {
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1400, temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } },
    };
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) }
    );
    if (!r.ok) return null;
    const d = await r.json();
    let text: string = d?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    text = text.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/i, "").trim();
    return text.length > 150 ? text : null;
  } catch {
    return null;
  }
}

// AIが必須の方針/トラブル回避文を削っていないか検証。欠落していたら定型にフォールバックさせる。
export function keepsKeyClauses(s: string): boolean {
  const t = (s || "").toLowerCase();
  return (
    /(customs|import|dut)/.test(t) &&
    /return/.test(t) &&
    /manufacturer/.test(t) &&
    /(tracking|track)/.test(t) &&
    /(case|before opening)/.test(t)
  );
}
