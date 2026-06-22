// 有料化後の「正直な」訴求コピーを一元化（サーバー/メタ/OG/SNSで共通利用）。
// 方針: ①「登録不要」は使わない（ログイン必須になったため事実に反する）
//       ②「無料」は PAYWALL_ENABLED に連動（有料化後は「30日無料でお試し（月¥500〜）」に寄せる）
import { PAYWALL_ENABLED } from "./plans";

// meta description / 紹介文（やや長め）
export const META_DESC = PAYWALL_ENABLED
  ? "eBay輸出で利益率が高い商品を自動でリストアップし、写真だけでほぼ自動のeBay出品まで。まずは30日無料でお試し（その後 月¥500〜）。"
  : "eBay輸出で利益率が高い商品を自動でリストアップ。日本の商品を海外に輸出して副収入を得たい方向けのリサーチ＆出品ツール。";

// OGP画像のバッジ（短い）
export const OG_BADGE = PAYWALL_ENABLED ? "30日無料でお試し" : "利益リサーチ＆自動出品";

// 一言キャッチ（プレス等）
export const PITCH_ONELINER = PAYWALL_ENABLED
  ? "eBay輸出で「利益が出やすい商品」をリサーチ＆ほぼ自動で出品できるツール（30日無料／月¥500〜）"
  : "eBay輸出で「利益が出やすい商品」を見つけるリサーチ＆出品ツール";
