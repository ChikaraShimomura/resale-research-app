import { getAppAccessToken } from "../../../lib/ebay/oauth";

// ⚠️ 一時的な相場精度の再測定用ルート（解析後に削除）。eBay現在出品を最大limit件返す読み取り専用。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GATE = "rrx_5c2d8f1a9b3e60";

interface BrowseItem {
  title?: string;
  price?: { value?: string; currency?: string };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("k") !== GATE) return new Response("not found", { status: 404 });
  const q = (url.searchParams.get("q") || "").slice(0, 120);
  if (!q) return Response.json({ ok: false, error: "q required" }, { status: 400 });
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 5)));

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
