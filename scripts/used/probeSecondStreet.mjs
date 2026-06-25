#!/usr/bin/env node
// scripts/used/probeSecondStreet.mjs
// 【中古カタログ P0・偵察】2nd STREET の検索結果ページを"自宅(住宅IP)"で取得できるか確認し、生HTMLを保存する。
// ※2nd STREETはAkamaiでデータセンター/海外IPを403で弾く。サーバー(Vercel/GitHub/クラウド)からは取れない＝必ず自宅PCで実行する。
//
// 使い方（自宅PCで）:
//   1) ブラウザで https://www.2ndstreet.jp を開き、古着を検索（例「リーバイス 501」）。
//   2) その「検索結果ページのURL」をコピー。
//   3) node scripts/used/probeSecondStreet.mjs "<コピーした検索結果URL>"
//   4) 出力(HTTPステータス)と、保存された scripts/used/_2ndst_dump.html を共有してください。
//      → それを見て本物のパーサー(商品名/価格/状態/画像/URL抽出)を書きます。
//
// 低頻度厳守・ログインの裏に入らない・robots/規約尊重。これは"読めるか/構造の確認"のための単発です。

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "_2ndst_dump.html");

const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) {
  console.error("使い方: node scripts/used/probeSecondStreet.mjs \"<2nd STREETの検索結果URL>\"");
  console.error("例:    node scripts/used/probeSecondStreet.mjs \"https://www.2ndstreet.jp/...(古着検索の結果URL)...\"");
  process.exit(1);
}

// 実ブラウザに近いヘッダ（Akamaiは UA だけでは通らないことが多い＝その場合は Playwright が要る、と判別できる）。
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

async function get(u, cookie) {
  const res = await fetch(u, {
    headers: cookie ? { ...HEADERS, Cookie: cookie } : HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const body = await res.text();
  return { status: res.status, ok: res.ok, body, setCookie, type: res.headers.get("content-type") || "" };
}

(async () => {
  try {
    // ① まずトップを叩いて Cookie をもらう（eBayと同じwarmupの作法。Akamai相手に効く場合がある）。
    console.log("① warmup: https://www.2ndstreet.jp/ を取得中…");
    let cookie = "";
    try {
      const top = await get("https://www.2ndstreet.jp/");
      console.log(`   warmup status=${top.status} (${top.type})`);
      // set-cookie の name=value 部分だけ素朴に連結（厳密でなくても可）。
      cookie = (top.setCookie.match(/[^;,\s]+=[^;,\s]+/g) || []).join("; ");
    } catch (e) {
      console.log(`   warmup失敗: ${e.message}（続行）`);
    }

    // ② 検索結果ページを取得。
    console.log(`② 検索結果ページ取得中: ${url}`);
    const r = await get(url, cookie);
    console.log(`   status=${r.status}  ok=${r.ok}  type=${r.type}  length=${r.body.length}`);

    if (r.status === 403 || /AkamaiGHost|Access Denied|Reference\s*#/i.test(r.body.slice(0, 800))) {
      console.log("\n🔴 Akamaiにブロックされました(403)。純node fetchでは通らない＝実ブラウザ(Playwright/Chrome)が必要、と判明。");
      console.log("   → 次は Playwright版の偵察を用意します（自宅PCの実Chromeで開く方式）。");
    }

    fs.writeFileSync(OUT, r.body, "utf8");
    console.log(`\n💾 生HTMLを保存: ${OUT}（${r.body.length}バイト）`);

    // 構造の手掛かりを軽く表示（商品/価格/状態らしき断片）。
    const hint = (re, label) => {
      const m = r.body.match(re);
      if (m) console.log(`   [${label}] ${m[0].slice(0, 120).replace(/\s+/g, " ")}`);
    };
    console.log("\n🔎 構造の手掛かり(あれば):");
    hint(/\/goods\/detail\/goodsId\/\d+\/shopsId\/\d+/i, "商品URL");
    hint(/[¥￥]\s?[\d,]+|[\d,]+\s?円/, "価格らしき");
    hint(/状態|コンディション|ランク[NSABCD]/, "状態らしき");
    hint(/<img[^>]+src=["'][^"']+\.(?:jpg|jpeg|png|webp)/i, "画像らしき");

    console.log("\n✅ この出力と _2ndst_dump.html を共有してください → 本物のパーサーを書きます。");
  } catch (e) {
    console.error("エラー:", e.message);
    console.error("（タイムアウト/接続不可なら、ブラウザでそのURLが開けるかも確認してください）");
    process.exit(1);
  }
})();
