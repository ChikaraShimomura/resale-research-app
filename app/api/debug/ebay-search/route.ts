import { getAppAccessToken } from "../../../lib/ebay/oauth";

// ⚠️ 一時的な相場精度の実測用ルート（解析が終わったら削除する）。
// eBay Browse API で「現在出品」を最大limit件返すだけの読み取り専用。簡易ゲート付き。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GATE = "rrx_3b8e1d6a2f9c47";

interface BrowseItem {
  title?: string;
  price?: { value?: string; currency?: string };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("k") !== GATE) return new Response("not found", { status: 404 });
  const q = (url.searchParams.get("q") || "").slice(0, 120);
  if (!q) return Response.json({ ok: false, error: "q required" }, { status: 400 });
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 24)));

  const token = await getAppAccessToken();
  if (!token) return Response.json({ ok: false, error: "no app token" });

  const params = new URLSearchParams({ q, limit: String(limit), fieldgroups: "COMPACT" });
  try {
    const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
      headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json().catch(() => ({}))) as { itemSummaries?: BrowseItem[]; total?: number };
    const items = (data.itemSummaries ?? []).map((it) => ({
      title: it.title ?? "",
      price: it.price?.value ?? null,
      cur: it.price?.currency ?? null,
    }));
    return Response.json({ ok: res.ok, q, total: data.total ?? 0, items });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message });
  }
}
