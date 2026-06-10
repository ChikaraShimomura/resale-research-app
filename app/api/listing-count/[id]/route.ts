// Upstash KV で永続化（サーバー再起動でリセットされない）
const KV_URL   = process.env.KV_REST_API_URL!;
const KV_TOKEN = process.env.KV_REST_API_TOKEN!;

async function kvIncr(key: string): Promise<number> {
  const res = await fetch(`${KV_URL}/incr/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const data = await res.json();
  return data.result ?? 0;
}

async function kvGetCount(key: string): Promise<number> {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const data = await res.json();
  return parseInt(data.result ?? "0", 10) || 0;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const count = await kvGetCount(`listing_count:${id}`);
  return Response.json({ count });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const count = await kvIncr(`listing_count:${id}`);
  return Response.json({ count });
}
