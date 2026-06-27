// 出品時(prepare)に、その商品の eBay Item Specifics(aspects) を自動補完する。
// eBayカテゴリの必須/推奨 aspects(名前+候補値) と 商品コンテキスト(ブランド/型番/カテゴリ/状態) を Haiku に渡し、
// 「その型番の正しい値」を埋める（例: Dreamcast→Platform "Sega Dreamcast" / Region "NTSC-J (Japan)" / Year 1998）。
// ＝eBay.aiが自動提案するのと同じ Item Specifics を、出品前にこちらで先に埋めて検索可視性を上げる。
//
// 安全方針：
//  - 確実な値(Brand/MPN=型番)は呼び出し側(prepare)が決定論で上書きする＝AIには推測させない。
//  - SELECTION_ONLY(候補あり&自由入力不可)は候補に一致した値だけ採用（誤った自由入力を弾く）。
//  - 鍵無し/失敗/不明は「空」を返す＝呼び出し側の決定論既定にフォールバック（出品は壊れない）。
//  - 商品×aspectセットでKVキャッシュ（重量推定と同じ最小コスト方式・prepare は元々 ANTHROPIC_API_KEY を使う）。
import { kv } from "@vercel/kv";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ASPECT_MODEL = process.env.ASPECT_MODEL ?? "claude-haiku-4-5";
const ASPECT_TTL = 30 * 24 * 60 * 60; // 30日（aspectは概ね不変。版が変われば別キャッシュ）

export interface AspectSlot {
  name: string;
  values: string[]; // 候補（SELECTION時）。空なら自由入力。
  free: boolean; // true=自由入力可
}
export interface AspectContext {
  id?: string;
  brand?: string;
  model?: string; // 型番
  title?: string;
  category?: string;
  condition?: string;
}

// 安定ハッシュ（aspectセットが変わればキャッシュを分ける）。
function hashish(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// aspect名→値。AIが自信を持って埋められたものだけ返す（不明は省略＝呼び出し側の既定が残る）。
export async function aiFillAspects(ctx: AspectContext, slots: AspectSlot[]): Promise<Record<string, string>> {
  if (!ANTHROPIC_API_KEY || !slots.length) return {};
  const id = ctx.id || "";
  const key = id ? `aspectfill:v1:${id}:${hashish(slots.map((s) => s.name).join("|"))}` : "";
  if (key) {
    try {
      const c = await kv.get<Record<string, string>>(key);
      if (c && typeof c === "object") return c;
    } catch { /* noop */ }
  }
  const lines = slots
    .map((s) => {
      const opts = s.values.length
        ? ` — choose EXACTLY ONE of: ${s.values.slice(0, 30).join(" | ")}`
        : s.free
          ? " — free text (short, accurate)"
          : "";
      return `- ${s.name}${opts}`;
    })
    .join("\n");
  const prompt = `You fill eBay "Item Specifics" for a USED product sourced from Japan and exported worldwide.
Product: brand="${ctx.brand || ""}", model/part-number="${ctx.model || ""}", title="${ctx.title || ""}", category="${ctx.category || ""}", condition="${ctx.condition || ""}".
Use your knowledge of THIS exact model to fill each item specific below with its correct value.

Aspects:
${lines}

Rules:
- When a list of choices is given, return EXACTLY one of those strings, copied verbatim. If none truly fit, omit that aspect.
- For free-text aspects: a short accurate value. Examples: a year like "1998"; a region like "NTSC-J (Japan)"; a measurement with unit; a platform/series name in English.
- Items bought new in Japan are typically region "Japan" / "NTSC-J (Japan)".
- OMIT any aspect you are not reasonably sure about. Do NOT guess wildly — leaving blank is better than wrong.
- Reply with ONLY a JSON object mapping the aspect name to its value. No prose, no markdown.`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: ASPECT_MODEL, max_tokens: 500, temperature: 0, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return {}; // 一過性＝キャッシュしない
    const d = await r.json();
    const text: string = (d?.content?.[0]?.text ?? "").replace(/```[a-z]*|```/gi, "").trim();
    const m = text.match(/\{[\s\S]*\}/);
    const parsed = m ? (JSON.parse(m[0]) as Record<string, unknown>) : {};
    const bySlot = new Map(slots.map((s) => [s.name, s]));
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const slot = bySlot.get(k);
      if (!slot) continue;
      const val = String(v ?? "").trim();
      if (!val || val.length > 80 || /^(n\/?a|unknown|none|不明)$/i.test(val)) continue;
      if (slot.values.length && !slot.free) {
        const hit = slot.values.find((o) => o.toLowerCase() === val.toLowerCase());
        if (hit) out[k] = hit; // SELECTION_ONLY は候補一致のみ採用
      } else {
        out[k] = val; // 自由入力
      }
    }
    if (key) { try { await kv.set(key, out, { ex: ASPECT_TTL }); } catch { /* noop */ } }
    return out;
  } catch {
    return {}; // タイムアウト等＝キャッシュしない（次回再試行）
  }
}

// coreKeyword("BRAND MODEL") からブランドと型番を分離。型番＝英数字+ハイフンで数字を含むトークン（最後のそれ）。
// build側で psnap に brand/code を別保存していればそれを優先。旧psnapは coreKeyword から推定。
export function splitBrandModel(
  coreKeyword: string,
  storedBrand?: string,
  storedCode?: string
): { brand: string; model: string } {
  if ((storedBrand && storedBrand.trim()) || (storedCode && storedCode.trim())) {
    return { brand: (storedBrand || "").trim(), model: (storedCode || "").trim() };
  }
  const ck = (coreKeyword || "").trim();
  if (!ck) return { brand: "", model: "" };
  const tokens = ck.split(/\s+/);
  let modelIdx = -1;
  for (let i = 0; i < tokens.length; i++) if (/[A-Za-z0-9][A-Za-z0-9-]*\d/.test(tokens[i])) modelIdx = i;
  if (modelIdx >= 0) return { brand: tokens.slice(0, modelIdx).join(" "), model: tokens.slice(modelIdx).join(" ") };
  return { brand: tokens[0] || "", model: tokens.slice(1).join(" ") };
}
