#!/usr/bin/env node
// scripts/rakutenGallery.mjs — 楽天商品ページのギャラリー画像URLを取得して参考用にDLする【ローカル専用ツール】。
//
// 用途: 自分が出品する商品の「撮影の参考」に、楽天商品ページのギャラリー全画像(APIの3枚より多い)を見たい時。
// 重要:
//  - これは【あなたのPC(住宅IP)で手動実行する】ツール。クラウド(Vercel/GitHub=データセンターIP)は楽天に弾かれるので不可。
//  - 楽天のサイト規約上、自動取得はグレー。あくまで【少数・低速・個人の撮影参考用】に。eBayへの転載はNG(著作権)。
//  - 公開リポにはpushしない想定(.gitignore に scripts/rakutenGallery.mjs と rakuten-ref/ を追加推奨)。
//
// 使い方: node scripts/rakutenGallery.mjs "https://item.rakuten.co.jp/<shop>/<code>/" [--no-download]

import { mkdirSync, writeFileSync } from "fs";

const url = process.argv[2];
const noDownload = process.argv.includes("--no-download");
if (!url || !/item\.rakuten\.co\.jp/.test(url)) {
  console.error('使い方: node scripts/rakutenGallery.mjs "https://item.rakuten.co.jp/<shop>/<code>/"');
  process.exit(1);
}
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const parts = url.replace(/^https?:\/\//, "").replace(/\/+$/, "").split("/");
const shop = (parts[1] || "").toLowerCase();
const code = (parts[2] || "").toLowerCase();
if (!shop || !code) { console.error("URLから shop/code を取得できません:", url); process.exit(1); }

const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja-JP,ja;q=0.9" }, signal: AbortSignal.timeout(25000) });
const html = await res.text();
console.log(`取得: status ${res.status} / HTML ${html.length}B / shop=${shop} code=${code}`);
if (res.status !== 200 || html.length < 5000) {
  console.error("ページ取得に失敗(またはブロック)。住宅IPで再試行、URLを確認してください。");
  process.exit(1);
}

// 楽天画像URLを広く拾い、indexOfで "{shop}/cabinet/...jpg" を切り出す(動的正規表現を避け堅牢に)。
const re = /https?:\/\/(?:thumbnail\.image\.rakuten\.co\.jp\/@0_mall\/|image\.rakuten\.co\.jp\/|tshop\.r10s\.jp\/|shop\.r10s\.jp\/)[^\s"'<>\)]+?\.(?:jpe?g|png|gif)/gi;
const needle = shop + "/cabinet/";
const seen = new Map();
for (const u of html.match(re) || []) {
  const i = u.toLowerCase().indexOf(needle);
  if (i < 0) continue;
  const path = u.slice(i).replace(/\?.*$/, ""); // {shop}/cabinet/.../file.jpg
  const key = path.toLowerCase();
  if (!seen.has(key)) seen.set(key, "https://image.rakuten.co.jp/" + path);
}
const urls = [...seen.values()];

// 一次絞り: ファイル名に商品コードを含む = この商品のギャラリー(コード命名の店)
let gallery = urls.filter((u) => u.toLowerCase().includes(code));
let fallback = false;
if (gallery.length < 2) {
  // フォールバック: コード命名でない店 → jpgのみ＋装飾フォルダ除外の最善努力(要目視)
  fallback = true;
  const JUNK = /\/(campaign|service|soy|banner|common|btn|icon|logo|footer|header|cp_|review|card|gakuwari|saikyo|victory|deal|thanks)/i;
  gallery = urls.filter((u) => /\.jpe?g$/i.test(u) && !JUNK.test(u));
}
// 並べ替え: _a1 / コードそのもの → _1.._N 数値順
const score = (u) => { const f = u.toLowerCase(); if (f.includes(code + "_a1")) return -2; if (f.endsWith("/" + code + ".jpg")) return -1; const n = f.match(new RegExp(code + "_(\d+)\."))?.[1]; return n ? Number(n) : 500; };
gallery.sort((a, b) => score(a) - score(b));

console.log(`\n楽天画像URL総数: ${urls.length} / ギャラリー候補: ${gallery.length}枚${fallback ? " (フォールバック=コード命名でない店・要目視)" : ""}\n`);
const dir = `rakuten-ref/${code}`;
if (!noDownload) mkdirSync(dir, { recursive: true });
let saved = 0;
for (let i = 0; i < gallery.length; i++) {
  const u = gallery[i];
  let status = "(list)";
  if (!noDownload) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
      if (r.status === 200) {
        const ext = (u.match(/\.(jpe?g|png|gif)$/i)?.[1] || "jpg").toLowerCase();
        writeFileSync(`${dir}/${String(i + 1).padStart(2, "0")}.${ext}`, Buffer.from(await r.arrayBuffer()));
        saved++; status = "OK";
      } else status = "x" + r.status;
    } catch { status = "ERR"; }
    await sleep(500);
  }
  console.log(`${String(i + 1).padStart(2, "0")} ${status}  ${u}`);
}
console.log(`\n完了: ${noDownload ? gallery.length + "件を一覧表示" : saved + "枚を " + dir + "/ に保存"}。参考用のみ・eBay転載NG。`);
