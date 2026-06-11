// eBay の per-connection トークンを AES-256-GCM で暗号化して KV に保存する。サーバー専用。
// 必要な env: EBAY_TOKEN_ENC_KEY (32バイト鍵 / hex64文字 または base64)
import { kv } from "@vercel/kv";
import crypto from "node:crypto";
import { refreshAccessToken } from "./oauth";

const ENC_KEY = process.env.EBAY_TOKEN_ENC_KEY;

function getKey(): Buffer | null {
  if (!ENC_KEY) return null;
  try {
    const buf = ENC_KEY.length === 64 ? Buffer.from(ENC_KEY, "hex") : Buffer.from(ENC_KEY, "base64");
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

function encrypt(plain: string): string | null {
  const key = getKey();
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decrypt(payload: string): string | null {
  const key = getKey();
  if (!key) return null;
  try {
    const raw = Buffer.from(payload, "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export interface EbayTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number; // epoch ms
  refreshExpiresAt: number; // epoch ms
  scopes: string;
}

const KEY = (conn: string) => `ebay_token:${conn}`;

export function tokenEncryptionReady(): boolean {
  return getKey() !== null;
}

export async function saveTokens(conn: string, t: EbayTokens): Promise<boolean> {
  const enc = encrypt(JSON.stringify(t));
  if (!enc) return false;
  try {
    await kv.set(KEY(conn), enc);
    return true;
  } catch {
    return false;
  }
}

export async function loadTokens(conn: string): Promise<EbayTokens | null> {
  try {
    const enc = await kv.get<string>(KEY(conn));
    if (!enc) return null;
    const dec = decrypt(enc);
    return dec ? (JSON.parse(dec) as EbayTokens) : null;
  } catch {
    return null;
  }
}

export async function deleteTokens(conn: string): Promise<void> {
  try {
    await kv.del(KEY(conn));
  } catch {
    /* noop */
  }
}

// 有効なアクセストークンを返す（期限切れ間際なら refresh して保存し直す）
export async function getValidAccessToken(conn: string): Promise<string | null> {
  const t = await loadTokens(conn);
  if (!t) return null;
  if (Date.now() < t.accessExpiresAt - 60_000) return t.accessToken;

  const r = await refreshAccessToken(t.refreshToken);
  if (!r?.access_token) return null;
  const updated: EbayTokens = {
    ...t,
    accessToken: r.access_token,
    accessExpiresAt: Date.now() + (r.expires_in - 60) * 1000,
  };
  await saveTokens(conn, updated);
  return updated.accessToken;
}
