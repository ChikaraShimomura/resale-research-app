// 出品説明文を Claude(Haiku) でチェック・自然化する（AIベンダーは Anthropic に一本化）。
// 方針/トラブル回避の文を削らせないよう厳格に指示し、呼び出し側で必須句の残存も検証する。
// 失敗・キー無し・必須句欠落時は null を返し、呼び出し側で「作り込んだ定型文」にフォールバックさせる。
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// 校正タスクなので Haiku で十分。環境変数で上書き可。
const DESC_MODEL = process.env.DESC_MODEL ?? "claude-haiku-4-5";

export async function aiRefineDescription(draft: string): Promise<string | null> {
  if (!ANTHROPIC_API_KEY || !draft) return null;
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
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: DESC_MODEL,
        max_tokens: 1500,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    let text: string = d?.content?.[0]?.text ?? "";
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
