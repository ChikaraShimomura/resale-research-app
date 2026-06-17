#!/usr/bin/env node
// scripts/push_broadcast.mjs — 全購読者へ手動でプッシュ通知を送る（アップデート/キャンペーン告知用）。
// KV の push_subs を読み、web-push で送信。失効した購読(404/410)は掃除する。
// env: KV_REST_API_URL/KV_REST_API_TOKEN, VAPID(NEXT_PUBLIC_VAPID_PUBLIC_KEY or VAPID_PUBLIC_KEY)/VAPID_PRIVATE_KEY/VAPID_SUBJECT,
//      PUSH_TITLE, PUSH_BODY, PUSH_URL。
import webpush from "web-push";

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY;
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:chikara0323@gmail.com";
const TITLE = process.env.PUSH_TITLE || "輸出ラボ";
const BODY = process.env.PUSH_BODY || "";
const URL_ = process.env.PUSH_URL || "/search";

if (!PUBLIC || !PRIVATE) { console.error("VAPID 鍵が未設定です（VAPID_PRIVATE_KEY / VAPID 公開鍵）"); process.exit(1); }
webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);

async function readSubs() {
  const res = await fetch(`${KV_URL}/hgetall/push_subs`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  const arr = (await res.json()).result;
  const subs = [];
  if (Array.isArray(arr)) {
    for (let i = 1; i < arr.length; i += 2) {
      let v = arr[i];
      try { v = typeof v === "string" ? JSON.parse(v) : v; } catch { continue; }
      if (v && v.endpoint && v.keys) subs.push(v);
    }
  }
  return subs;
}

(async () => {
  const subs = await readSubs();
  console.log(`購読数: ${subs.length}`);
  const payload = JSON.stringify({ title: TITLE, body: BODY, url: URL_, tag: "manual" });
  let ok = 0, gone = 0, err = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload);
      ok++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        gone++;
        await fetch(`${KV_URL}/hdel/push_subs/${encodeURIComponent(s.endpoint)}`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN}` } }).catch(() => {});
      } else { err++; }
    }
  }
  console.log(`送信OK: ${ok} / 失効削除: ${gone} / その他失敗: ${err}`);
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
