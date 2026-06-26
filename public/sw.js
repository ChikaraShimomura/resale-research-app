// 輸出ラボ Service Worker。役割は2つ：
//  ① 軽いオフライン耐性（一度見たページはネット不通でも表示）。動的データ(/api/*)はキャッシュしない＝常に最新。
//  ② Web プッシュ通知の受信・クリック処理（再訪を促すリテンション施策の受け皿）。
// ⚠️ 中古モデルへ移行：旧キャッシュ(yl-v1)には旧 /search(新品商材)ページが残るため、版を上げて activate で必ず破棄する。
const CACHE = "yl-v2";

self.addEventListener("install", () => {
  self.skipWaiting(); // すぐ新SWを有効化
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// ナビゲーション(ページ遷移)だけ「ネット優先・失敗時に直近キャッシュ」。API/POST/外部は触らない＝鮮度を壊さない。
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return; // 外部(楽天/eBay/CDN)はそのまま
  if (url.pathname.startsWith("/api/")) return;     // 動的データはキャッシュしない

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone()).catch(() => {});
          return res;
        } catch {
          const cached = await caches.match(req);
          return cached || (await caches.match("/catalog")) || Response.error();
        }
      })()
    );
  }
});

// プッシュ受信 → 通知を表示。payload は {title, body, url, tag}。
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || "輸出ラボ";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/catalog" },
    tag: data.tag, // 同じtagは1つにまとめる（通知の氾濫を防ぐ）
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// 通知クリック → 既存タブがあれば前面化、無ければ開く。
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/catalog";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if (c.url.includes(target) && "focus" in c) return c.focus();
      }
      return self.clients.openWindow(target);
    })()
  );
});
