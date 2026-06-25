#!/usr/bin/env node
// scripts/used/fetch2ndStreet.mjs
// 【中古カタログ B: 2nd STREET 取得】Akamai Bot Manager 突破には実Chrome(channel:'chrome')＋headed＋住宅IPが要る
// （ヘッドレス/純fetchは Access Denied）。検索結果を構造化して返す。⚠️PC(GUIあり)限定＝Pixel/Termuxでは不可。
// ⚠️住宅IP・低頻度厳守。ログイン裏に入らない。画像はリンク参照のみ（再ホストしない）。robots/規約尊重。
//
// 取れる項目: 商品URL(/goods/detail/...) / goodsId / ブランド / 商品名 / サイズ / 状態(中古S〜D/新品/未使用) / 価格 / 画像URL。
// 使い方: node scripts/used/fetch2ndStreet.mjs "リーバイス 501"
import { chromium } from "playwright";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const strip = (s) => (s || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

// 検索結果HTML→商品配列。カードは class="js-favorite itemCard" 単位。
export function parse2ndStreet(html) {
  const items = [];
  const chunks = html.split(/class="js-favorite itemCard"/).slice(1);
  for (const c of chunks) {
    const path = (c.match(/href="(\/goods\/detail\/goodsId\/\d+\/shopsId\/\d+)"/) || [])[1];
    if (!path) continue;
    const id = (c.match(/goodsid="(\d+)"/i) || [])[1] || (path.match(/goodsId\/(\d+)/) || [])[1];
    const imageUrl = (c.match(/<img[^>]+src="(https:\/\/cdn[^"]+\.(?:jpg|jpeg|png|webp))"/i) || [])[1] || "";
    const brand = strip((c.match(/itemCard_brand">([\s\S]*?)<\/p>/) || [])[1]);
    const name = strip((c.match(/itemCard_name">([\s\S]*?)<\/p>/) || [])[1]);
    const size = strip((c.match(/itemCard_size">([\s\S]*?)<\/p>/) || [])[1]);
    const statusRaw = strip((c.match(/itemCard_status">([\s\S]*?)<\/p>/) || [])[1]); // "商品の状態 : 中古C"
    const condition = statusRaw.replace(/商品の状態\s*[:：]?\s*/, "").trim() || null; // 中古C / 新品 / 未使用 等
    const priceStr = (c.match(/itemCard_price[^"]*">\s*[¥￥]([\d,]+)/) || [])[1] || "";
    const price = priceStr ? Number(priceStr.replace(/,/g, "")) : null;
    items.push({ id, url: "https://www.2ndstreet.jp" + path, brand, name, size, condition, price, imageUrl, site: "2ndstreet" });
  }
  return items;
}

// 実Chrome(headed)を1つ起動し、複数キーワードを順に検索して構造化（ブラウザ再利用＝低頻度・効率）。
// onResult(keyword, items) が各キーワードで呼ばれる。gapMs はキーワード間の待ち。
export async function fetch2ndStreetMany(keywords, { gapMs = 4000, onResult } = {}) {
  const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--disable-blink-features=AutomationControlled"] });
  const out = {};
  try {
    const ctx = await browser.newContext({ userAgent: UA, locale: "ja-JP", timezoneId: "Asia/Tokyo", viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", { get: () => ["ja-JP", "ja", "en-US", "en"] });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    });
    const page = await ctx.newPage();
    for (const kw of keywords) {
      const url = `https://www.2ndstreet.jp/search?keyword=${encodeURIComponent(kw)}`;
      let items = [];
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        for (let i = 0; i < 14; i++) {
          await page.waitForTimeout(2200);
          const html = await page.content();
          if (/\/goods\/detail\/goodsId\//.test(html)) { items = parse2ndStreet(html); break; }
          if (/Access Denied|errors\.edgesuite\.net/i.test(html) && i >= 2) break;
        }
      } catch { /* skip this keyword */ }
      out[kw] = items;
      if (onResult) onResult(kw, items);
      await page.waitForTimeout(gapMs);
    }
    await browser.close();
  } catch (e) {
    try { await browser.close(); } catch { /* noop */ }
    throw e;
  }
  return out;
}

// 単発（1キーワード）。バッチは fetch2ndStreetMany を使うこと（ブラウザ再利用で速い）。
export async function fetch2ndStreet(keyword) {
  const r = await fetch2ndStreetMany([keyword], { gapMs: 0 });
  return r[keyword] || [];
}

// CLI
const isMain = process.argv[1]?.endsWith("fetch2ndStreet.mjs");
if (isMain) {
  const kw = process.argv[2] || "リーバイス 501";
  const items = await fetch2ndStreet(kw);
  console.log(`「${kw}」: ${items.length}件`);
  for (const it of items.slice(0, 12)) {
    console.log(`- [${it.condition || "?"}] ¥${it.price ?? "?"} | ${it.brand} ${it.name}${it.size ? " (" + it.size + ")" : ""}`);
    console.log(`    ${it.url}`);
  }
}
