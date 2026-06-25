# 中古品 利益カタログ 設計図（eBay起点 → 中古照合）

> 方針転換のメモ。輸出ラボを「楽天新品×自動出品」から「**中古品の利益リサーチに特化したカタログ**」へ作り替える。
> グレー（中古サイトのスクレイプ）は承知の上。住宅IP・低頻度・ログイン裏に入らない・画像は再ホストせずリンクのみ。

---

## 0. コンセプト（一言）
**「eBayで“実際に売れてる(STR)”商品を、2nd STREET/ハードオフ/メルカリの“中古”で見つけて、送料・関税後の純利益が出るかを判定して並べる、日本語の中古輸出リサーチ。」**

- 自動出品は**廃止**（出品/連携/発送/管理）。リサーチに集中＝保守が激減。
- カタログの主役は「1点の出品」ではなく **“儲かる型番(モデル)”** ＋ 実物リンク/通知（← 1点物の共食い回避。下記§4が核心）。

---

## 1. エンジンの向きを逆転：eBay起点
旧：楽天(新品) → eBay照合。
新：**eBay売れ筋 → 中古サイトで照合**。

```
① eBay sold 発掘   売れてる型番＋落札相場＋STR＋競合   （既存 ebaySoldWorker discover を流用）
        ↓ seed=「儲かる型番」
② 中古サイト照合   型番/キーワードで 2ndST/ハードオフ/メルカリ を住宅IPワーカーで検索
        ↓ 候補（価格・状態・URL・画像URL・在庫=1点）
③ 同一判定＋状態   落札画像 × 中古候補画像 で同一商品か＋状態ランク   （既存 画像AIマッチャ流用）
        ↓
④ 利益判定        中古価格 → eBay相場(状態込み) → 送料関税後の純利益＋STR   （既存 profitCore/landedCost 流用）
        ↓
⑤ カタログ化      「儲かる型番」DB ＋ 直近の実物リンク ＋ 新着通知
```
②でスクレイプ量が「eBayで売れてる型番ぶん」に絞れる＝無差別に中古全件を取らない（負荷も規約リスクも軽い）。

---

## 2. コードの棚卸し（残す / 転用 / 消す）

### ✅ 残す（ほぼそのまま）
- `app/lib/ebay/profitCore.mjs` / `landedCostCore.mjs` … 利益計算（送料・関税・手数料）
- `scripts/ebaySoldWorker.mjs` の **discover**（eBay売れ筋発掘。出力先を「型番DB」へ）
- refresh内の **画像AIマッチャ**（isImageMatch / Haiku→Sonnet）… 同一商品判定
- `ebayCompetition()` / `sellThroughPct()`（STR=売れやすさ）
- **住宅IPワーカー基盤**（Pixel/Termux・`termux-run.sh`・死活/売切検知）
- 配信・UI：`/api/products`・`ProductCard`・`SortSelect`・検索/絞り込み・paywall/マスク・KV基盤

### ♻️ 転用（中身を中古向けに差し替え）
- `scripts/refresh.mjs` の「楽天マッチ」ブロック → **「中古サイト照合」** に差し替え
  （`fetchRakutenPage` → `fetchUsed(site, query)`、`source.site: rakuten` → `{ second_street | hardoff | mercari }`）
- `ProfitProduct.source` … 中古ソース対応（`site` / `condition`(状態ランク) / `url` / `inStock`(=1点)）
- `ebay_sold_seed` … 「型番＋相場＋STR＋競合」を持つ **儲かる型番(modelKey)** へ
- 画像 … 中古候補画像は**再ホストしない＝リンクのみ**（galleryWorkerの“保存”は中古では使わない）

### ❌ 消す（自動出品まわり一式＝保守を軽くする）
- ルート：`app/api/ebay/list/*`(prepare/publish/optimize/edit/photos/stop/reconcile/auto-stop)・`orders/*`・`deals`・`setup-policies`・`create-location`・`connect/callback/disconnect`
- UI：`EbayListingModal`・`MyListings`・`EditListingModal`・`EbayPolicySetup`・`EbayLocationSetup`・`/grow`・`HomeHub`の出品導線
- per-user の **eBay Sell連携OAuth/トークン/ポリシー/発送元**
- ※**残す**：eBay **app token**（Browse=落札相場/競合）。これはリサーチに必須。消すのは per-user の Sell 連携のみ。

---

## 3. 中古サイトの叩き方（住宅IPワーカー）
- 既存 `termux-run.sh` に **「中古照合worker」** を追加（Pixel/Termux常駐）。
- 入力＝「儲かる型番」seed（①由来）。各型番で検索 → 候補抽出（価格/状態/URL/画像URL/在庫）。
- サイト別：
  - **2nd STREET**＝Akamai → **実ブラウザ(Playwright等)＋低頻度**。`/goods/detail/goodsId/{}/shopsId/{}` 規則的。状態ランク N>S>A>B>C>D。
  - **ハードオフ ネットモール(オフモール)**＝category駆動URL。オーディオ/楽器/カメラ/レトロが厚い。
  - **メルカリ**＝一番うるさい → **最小頻度・最後に追加**。C2C。
- 厳守：robots/規約尊重・**ログインの裏に入らない**・技術ブロックを無理に突破しない・**画像はリンクのみ**・低頻度。
- 頻度：型番DBは日次。実物リンクは**鮮度優先で短サイクル**（売切れ検知＝既存の死活検知を転用）。

---

## 4. 【核心】1点物の扱い ＝ 共食い回避設計
中古は1点もの → 「この出品が利益商品」だと**100人見ても買えるのは1人**＝カタログ崩壊。
**解＝カタログの主役を「出品」でなく「儲かる型番(モデル)」にする。**

- 型番カード例：`Pioneer SX-780 / eBay相場$250 / STR◯% / 競合◯件 / 想定利益率◯% / 出現頻度 週◯件`
- そこに「**今出てる実物（例）**」を数件リンク＋「**新着で出たら通知**」。
- 効果：
  1. **共食いしない**（型番情報はみんなで共有・1点の取り合いにならない）
  2. **規約が軽い**（在庫の再配布でなく“型番×相場の知見＋外部リンク”＝価格比較寄り）
  3. **本当に役立つ**（何を探せばいいかが分かる＝リサーチの本質）

---

## 5. データモデル（KV・案）
- `used_model:{modelKey}` = `{ title, category, ebayPrice(状態別), str, competition, profitRate, frequency, recentListings[] }`
- `used_listing:{id}` = `{ site, url, price, condition, imageUrl(link), modelKey, seenAt, soldOut }`
- 既存 `profitable_products` を **型番DB** に置換 or 並走（移行は段階的に）。

---

## 6. 利用のさせ方（UX）
- 一覧＝**儲かる型番カタログ**（絞り込み：カテゴリ/利益率/STR/競合/出現頻度）。
- 型番ページ：eBay相場・STR・競合・**状態別の利益**・直近実物リンク・通知ボタン。
- free＝マスク（型番名/利益率だけ）→ 課金で相場・利益・実物リンク・通知を開放。
- 価格：月¥500〜2,000（既存プラン流用）。旗印＝「リサーチ特化なのに管理ツールの1/5」。

---

## 7. リスク・運用（承知の上）
- **グレー**：住宅IP・低頻度・ログイン裏NG・画像リンクのみ・robots尊重。メルカリは最小。事業化前に各規約を住宅IPで一次確認＋専門家チェック。
- **鮮度**：1点物=売切れ早い → 死活検知必須（既存転用）。
- **精度**：状態で相場が振れる → **状態ランク込みの幅**で利益を出す（断定しない）。
- **規模**：ニッチ。集客はX週次ドロップ＋note/YouTube。

---

## 8. 作業順（フェーズ）
- **P0**：パイプラインの向き転換。①discoverの出力を「型番DB」へ ②`refresh.mjs`の楽天ブロックを「中古照合」に差し替え。**まず 2nd STREET 1サイト × 1カテゴリ(古着) で1本通す**（実証）。
- **P1**：中古照合worker（住宅IP・Playwright・売切れ検知）。
- **P2**：型番カタログUI（既存`ProductCard`/一覧を型番DB表示へ・実物リンク・売切れ落とし）。
- **P3**：自動出品まわり削除（保守を軽く）。
- **P4**：ハードオフ追加 → メルカリ(最小)。新着通知。集客(X週次ドロップ)。

> 起点は **P0 の「2nd STREET × 古着 × eBay相場照合を1本通す」**。ここが回れば、横展開（カテゴリ/サイト）は同じ型の繰り返し。
