#!/usr/bin/env node
// scripts/used/fetchHardoff.mjs
// 【中古カタログ P0】ハードオフ ネットモール(オフモール)の検索結果を取得し、商品を構造化して返す。
// ハードオフはサーバー描画(Akamaiチャレンジ無し・純fetchで200/実HTML)なので、住宅IPからの素のfetchで取れる。
// 取れる項目: 商品URL(/product/{id}/) / ブランド / 商品名 / 型番(item-code) / 価格 / 状態ランク(N>S>A>B>C>D) / 画像URL。
// ⚠️住宅IP・低頻度厳守。ログイン裏に入らない。画像は"リンク(URL)"として持つだけ＝再ホストしない。
//
// 使い方: node scripts/used/fetchHardoff.mjs "Pioneer アンプ"

import { upscaleImageflux } from "../../app/lib/imagefluxUpscale.mjs"; // 検索サムネ(w=231)→原寸級(1280px)。カタログに焼く前に原寸化する。

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const stripTags = (s) => (s || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").trim();

// 検索結果HTMLから商品カードを構造化する。カードは class="itemcolmn_item" 単位。
export function parseHardoff(html) {
  const items = [];
  // 各カードチャンク（次のカード or 一覧の終わりまで）に分割。
  const chunks = html.split(/class="itemcolmn_item/).slice(1);
  for (const c of chunks) {
    const url = (c.match(/href="(https:\/\/netmall\.hardoff\.co\.jp\/product\/(\d+)\/)"/) || [])[1];
    if (!url) continue;
    const id = (c.match(/\/product\/(\d+)\//) || [])[1];
    // 検索カードの画像は imageFlux の小サムネ(w=231等)。カタログ/psnapに焼く前に原寸級(1280px)へ書き換える＝出品マスターのボケ/#25002を源流で断つ。
    const imageUrl = upscaleImageflux((c.match(/<img[^>]+src="(https:\/\/[^"]+(?:imageflux|imageflux\.jp|media\.hardoff)[^"]+\.(?:jpg|jpeg|png|webp))"/i) || [])[1] || "");
    const brand = stripTags((c.match(/class="item-brand-name"[^>]*>([\s\S]*?)<\/div>/) || [])[1]);
    const name = stripTags((c.match(/class="item-name"[^>]*>([\s\S]*?)<\/div>/) || [])[1]);
    const code = stripTags((c.match(/class="item-code"[^>]*>([\s\S]*?)<\/div>/) || [])[1]); // 型番(eBay照合に強い)
    const priceStr = (c.match(/class="font-en item-price-en"[^>]*>\s*([\d,]+)/) || [])[1] || "";
    const price = priceStr ? Number(priceStr.replace(/,/g, "")) : null;
    // 状態ランク：実マークアップは <img src=".../rank/icon-rank-{size}-{rank}.svg" alt="{rank}">。
    //   ※先頭の {size} は表示サイズ記号(s=small)で状態ではない。本当のランクは2つ目の文字＝altと一致(例 icon-rank-s-b alt="b" ＝ Bランク)。
    //   旧実装は先頭の s を拾って全件Sになっていた不具合。altを優先し、無ければ icon-rank-{size}-{rank} の2文字目を採用。
    //   ジャンク品はランクが無く icon-tag-junk が付く＝condition="JUNK"。ジャンクはeBay輸出では別物(未確認/部品取り)なので明示区別。
    const rank = (
      (c.match(/\/rank\/icon-rank-[a-z]-([a-z])\.svg/i) || [])[1] ||
      (c.match(/<img[^>]*\bsrc="[^"]*\/rank\/[^"]*"[^>]*\balt="([a-z])"/i) || [])[1] ||
      ""
    ).toUpperCase();
    const isJunk = /icon-tag-junk|alt="ジャンク品"/.test(c);
    const condition = rank || (isJunk ? "JUNK" : null);
    items.push({ id, url, brand, name, code, price, condition, isJunk, imageUrl, site: "hardoff" });
  }
  return items;
}

// キーワードでハードオフ検索→構造化。pageは1始まり。
export async function fetchHardoff(keyword, { page = 1 } = {}) {
  if (!keyword) return [];
  const u = `https://netmall.hardoff.co.jp/search/?q=${encodeURIComponent(keyword)}${page > 1 ? `&page=${page}` : ""}`;
  const res = await fetch(u, {
    headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8", Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return parseHardoff(html);
}

// CLI：node scripts/used/fetchHardoff.mjs "keyword"
const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("fetchHardoff.mjs");
if (isMain) {
  const kw = process.argv[2];
  if (!kw) { console.error('使い方: node scripts/used/fetchHardoff.mjs "Pioneer アンプ"'); process.exit(1); }
  const items = await fetchHardoff(kw);
  console.log(`「${kw}」: ${items.length}件`);
  for (const it of items.slice(0, 12)) {
    console.log(`- [${it.condition || "?"}] ¥${it.price ?? "?"} | ${it.brand} ${it.name} (${it.code || "型番なし"})`);
    console.log(`    ${it.url}`);
  }
}
