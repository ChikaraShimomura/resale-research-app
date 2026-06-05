// インメモリカウンター（サーバー再起動でリセット。本番はDBに変更）
const counts = new Map<string, number>();

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return Response.json({ count: counts.get(id) ?? 0 });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const next = (counts.get(id) ?? 0) + 1;
  counts.set(id, next);
  return Response.json({ count: next });
}
