import { cookies } from "next/headers";
import { getValidAccessToken } from "../../../lib/ebay/tokens";
import { upsertInventoryLocation, type ShipFromAddress } from "../../../lib/ebay/sellApi";

// 発送元（在庫ロケーション）をeBayに登録する。下書き作成の前提。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const jar = await cookies();
  const conn = jar.get("rr_did")?.value;
  if (!conn) return Response.json({ ok: false, error: "device not identified" }, { status: 401 });

  const token = await getValidAccessToken(conn);
  if (!token) return Response.json({ ok: false, error: "eBay未連携です。先に連携してください。" }, { status: 401 });

  let body: Partial<ShipFromAddress>;
  try {
    body = (await req.json()) as Partial<ShipFromAddress>;
  } catch {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  // JSON literal null / 配列 / プリミティブはここで弾く（後続の body.xxx が TypeError→500 になるのを防ぐ）
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const addressLine1 = (body.addressLine1 ?? "").trim();
  const addressLine2 = (body.addressLine2 ?? "").trim();
  const city = (body.city ?? "").trim();
  const stateOrProvince = (body.stateOrProvince ?? "").trim();
  const postalCode = (body.postalCode ?? "").trim();
  if (!addressLine1 || !city || !stateOrProvince || !postalCode) {
    return Response.json({ ok: false, error: "住所の必須項目（番地・市区町村・都道府県・郵便番号）を入力してください。" }, { status: 400 });
  }

  const r = await upsertInventoryLocation(token, {
    addressLine1,
    ...(addressLine2 ? { addressLine2 } : {}),
    city,
    stateOrProvince,
    postalCode,
    country: "JP",
  });

  return Response.json({ ok: r.ok, error: r.error }, { status: r.ok ? 200 : 502 });
}
