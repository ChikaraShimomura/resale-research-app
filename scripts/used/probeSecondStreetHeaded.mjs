#!/usr/bin/env node
// scripts/used/probeSecondStreetHeaded.mjs
// 【2nd STREET 突破試行(headed + 実Chrome指紋)】Akamai Bot Manager はヘッドレスを弾く(Access Denied)が、
// 実ブラウザ(channel:'chrome')＋headed＋住宅IP＋軽ステルスなら通る可能性がある。検索結果の描画後HTMLを保存し構造を確認。
// 使い方: node scripts/used/probeSecondStreetHeaded.mjs "リーバイス 501"
import { chromium } from "playwright";
import fs from "node:fs";

const kw = process.argv[2] || "リーバイス 501";
const url = `https://www.2ndstreet.jp/search?keyword=${encodeURIComponent(kw)}`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function tryLaunch(opts, label) {
  console.log(`\n=== 試行: ${label} ===`);
  let browser;
  try {
    browser = await chromium.launch(opts);
  } catch (e) {
    console.log(`  launch失敗: ${e.message.slice(0, 100)}`);
    return null;
  }
  try {
    const ctx = await browser.newContext({
      userAgent: UA,
      locale: "ja-JP",
      timezoneId: "Asia/Tokyo",
      viewport: { width: 1280, height: 900 },
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", { get: () => ["ja-JP", "ja", "en-US", "en"] });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    let html = "", ok = false;
    for (let i = 0; i < 16; i++) {
      await page.waitForTimeout(2500);
      html = await page.content();
      const denied = /Access Denied|errors\.edgesuite\.net|You don't have permission/i.test(html);
      const interstitial = /bm-verify|_sec\/verify|interstitial/i.test(html);
      const hasProduct = /\/goods\/detail\/goodsId\//.test(html);
      console.log(`  待機${i + 1}: len=${html.length} denied=${denied} interstitial=${interstitial} product=${hasProduct} url=${page.url().slice(0, 55)}`);
      if (hasProduct) { ok = true; break; }
      if (denied && i >= 2) break; // 明確に拒否されたら早期終了
    }
    fs.writeFileSync("scripts/used/_2ndst_headed_dump.html", html);
    const links = [...new Set([...html.matchAll(/\/goods\/detail\/goodsId\/\d+\/shopsId\/\d+/g)].map((m) => m[0]))];
    console.log(`  💾 保存: _2ndst_headed_dump.html (${html.length}B) 突破=${ok} 商品URL=${links.length}件`);
    if (links.length) console.log("  例:", links.slice(0, 3).join("  "));
    // 価格の手掛かり
    const pm = [...html.matchAll(/[¥￥]\s?([\d,]{3,})|([\d,]{3,})\s*円/g)].slice(0, 3).map((m) => m[0]);
    if (pm.length) console.log("  価格断片:", pm.join(" / "));
    await browser.close();
    return ok ? html : null;
  } catch (e) {
    console.log(`  エラー: ${e.message.slice(0, 120)}`);
    try { await browser.close(); } catch { /* noop */ }
    return null;
  }
}

// ① 実Chrome(channel:'chrome')headed → ② 実Chrome headless=new → ③ bundled chromium headed の順で試す。
let html = await tryLaunch({ headless: false, channel: "chrome", args: ["--disable-blink-features=AutomationControlled"] }, "実Chrome headed");
if (!html) html = await tryLaunch({ headless: false, args: ["--disable-blink-features=AutomationControlled"] }, "bundled chromium headed");
console.log(html ? "\n✅ 突破成功" : "\n❌ 全試行で突破できず");
