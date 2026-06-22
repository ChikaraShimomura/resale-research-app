import webpush from "web-push";
import { kv } from "@vercel/kv";

// Web プッシュ通知のサーバー側ロジック。購読(subscription)を KV ハッシュ push_subs に保存し、
// 種類(sold/newdeal/weekly)ごとのユーザー設定(prefs)で出し分けて送る。手動ブロードキャストは全員へ。
// VAPID キーは env から（NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT）。未設定なら何もしない。

const PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || "";
const PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:chikara0323@gmail.com";

let configured = false;
function ensureVapid(): boolean {
  if (configured) return true;
  if (!PUBLIC || !PRIVATE) return false;
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
  configured = true;
  return true;
}

const SUBS_KEY = "push_subs"; // hash: endpoint -> StoredSub(JSON)

export type PushType = "sold" | "newdeal" | "weekly";
export interface PushPrefs { sold: boolean; newdeal: boolean; weekly: boolean }
export const DEFAULT_PREFS: PushPrefs = { sold: true, newdeal: true, weekly: true };

export interface WebPushSub { endpoint: string; keys: { p256dh: string; auth: string } }
interface StoredSub { actor: string; endpoint: string; keys: { p256dh: string; auth: string }; prefs: PushPrefs; ts: number }

interface PushPayload { title: string; body?: string; url?: string; tag?: string }

export async function saveSubscription(actor: string, sub: WebPushSub, prefs: PushPrefs): Promise<void> {
  if (!sub?.endpoint || !sub.keys?.p256dh) return;
  const rec: StoredSub = { actor, endpoint: sub.endpoint, keys: sub.keys, prefs: prefs || DEFAULT_PREFS, ts: Date.now() };
  try { await kv.hset(SUBS_KEY, { [sub.endpoint]: rec }); } catch { /* noop */ }
}

export async function updatePrefs(actor: string, endpoint: string, prefs: PushPrefs): Promise<void> {
  try {
    const cur = await kv.hget<StoredSub>(SUBS_KEY, endpoint);
    // 所有者チェック: その購読が呼出元(actor)のものでなければ何もしない（他人の通知設定を書き換えるIDORを防ぐ）。
    if (cur && cur.actor === actor) await kv.hset(SUBS_KEY, { [endpoint]: { ...cur, prefs, ts: Date.now() } });
  } catch { /* noop */ }
}

// actor を渡すと「本人の購読のときだけ」削除する（公開API＝ユーザー操作用のIDOR防止）。
// actor 省略時は無条件削除（sendOne の失効購読の内部掃除専用）。
export async function removeSubscription(endpoint: string, actor?: string): Promise<void> {
  try {
    if (actor) {
      const cur = await kv.hget<StoredSub>(SUBS_KEY, endpoint);
      if (!cur || cur.actor !== actor) return; // 他人の購読は解除しない
    }
    await kv.hdel(SUBS_KEY, endpoint);
  } catch { /* noop */ }
}

// この actor の購読が持つ prefs（設定UIの初期状態用）。無ければ null。
export async function getPrefsForActor(actor: string): Promise<PushPrefs | null> {
  try {
    const all = (await kv.hgetall<Record<string, StoredSub>>(SUBS_KEY)) ?? {};
    const mine = Object.values(all).find((r) => r?.actor === actor);
    return mine?.prefs ?? null;
  } catch {
    return null;
  }
}

async function sendOne(rec: StoredSub, payload: PushPayload): Promise<void> {
  try {
    await webpush.sendNotification({ endpoint: rec.endpoint, keys: rec.keys }, JSON.stringify(payload));
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) await removeSubscription(rec.endpoint); // 失効した購読は掃除
  }
}

// 特定アクター（本人の全デバイス）へ。type を有効にしている購読だけに送る。売却通知などに使う。
export async function sendToActor(actor: string, type: PushType, payload: PushPayload): Promise<void> {
  if (!ensureVapid()) return;
  try {
    const all = (await kv.hgetall<Record<string, StoredSub>>(SUBS_KEY)) ?? {};
    await Promise.all(
      Object.values(all)
        .filter((r) => r?.actor === actor && r?.prefs?.[type])
        .map((r) => sendOne(r, payload))
    );
  } catch { /* noop */ }
}

// 全購読者へ。type が "manual" なら設定に関わらず全員、それ以外は当該typeを有効にしている人だけ。
export async function broadcast(type: PushType | "manual", payload: PushPayload): Promise<number> {
  if (!ensureVapid()) return 0;
  try {
    const all = (await kv.hgetall<Record<string, StoredSub>>(SUBS_KEY)) ?? {};
    const targets = Object.values(all).filter((r) => r && (type === "manual" || r.prefs?.[type as PushType]));
    await Promise.all(targets.map((r) => sendOne(r, payload)));
    return targets.length;
  } catch {
    return 0;
  }
}
