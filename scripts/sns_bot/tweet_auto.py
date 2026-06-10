"""
輸出ラボ 自動投稿 - 毎時15分（24本/日）

2パターンローテーション:
  偶数時間 → Pattern A: 商品紹介「これ輸出したら稼げるってさ」
  奇数時間 → Pattern B: トレンド便乗「〇〇が××だってさ」
"""
import os
import re
import sys
import io
import json
import random
import tweepy
import requests
import anthropic
import xml.etree.ElementTree as ET
from datetime import datetime
import pytz

JST = pytz.timezone('Asia/Tokyo')
SITE_URL = "https://www.yushutsu-fukugyo.com"
SITE_SEARCH_URL = "https://www.yushutsu-fukugyo.com/search"
MAX_CHARS = 280

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
}

_URL_RE = re.compile(r'https?://\S+')


# ── Twitter文字数カウント ─────────────────────────────────────
def tw_len(text: str) -> int:
    text = _URL_RE.sub("A" * 23, text)
    count = 0
    for ch in text:
        cp = ord(ch)
        if any([
            0x2E80 <= cp <= 0x303F, 0x3040 <= cp <= 0x31BF,
            0x3200 <= cp <= 0x33FF, 0x3400 <= cp <= 0x4DBF,
            0x4E00 <= cp <= 0x9FFF, 0xF900 <= cp <= 0xFAFF,
        ]) or cp > 0xFFFF:
            count += 2
        else:
            count += 1
    return count


# ── 輸出ラボ商品をKVから取得 ──────────────────────────────────
def fetch_products() -> list:
    kv_url   = os.environ.get("KV_REST_API_URL", "")
    kv_token = os.environ.get("KV_REST_API_TOKEN", "")
    if not kv_url or not kv_token:
        print("  KV環境変数未設定 - 商品取得スキップ")
        return []
    try:
        resp = requests.get(
            f"{kv_url}/get/profitable_products",
            headers={"Authorization": f"Bearer {kv_token}"},
            timeout=10,
        )
        data = resp.json()
        raw = data.get("result")
        if not raw:
            return []
        products = json.loads(raw)
        good = [p for p in products if p.get("realProfitRate", 0) >= 30 and p.get("imageUrl")]
        return good if good else products
    except Exception as e:
        print(f"  商品取得エラー: {e}")
        return []


def pick_product(products: list) -> dict | None:
    if not products:
        return None
    top = sorted(products, key=lambda p: p.get("realProfitRate", 0), reverse=True)[:20]
    return random.choice(top)


# ── 画像のダウンロード ────────────────────────────────────────
def download_image(url: str) -> bytes | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        return resp.content
    except Exception as e:
        print(f"  画像DLエラー: {e}")
        return None


# ── Twitter メディアアップロード（v1.1） ──────────────────────
def upload_media(api_v1: tweepy.API, image_bytes: bytes, filename: str = "image.jpg") -> str | None:
    try:
        media = api_v1.media_upload(filename=filename, file=io.BytesIO(image_bytes))
        return str(media.media_id)
    except Exception as e:
        print(f"  メディアアップロードエラー: {e}")
        return None


# ── RSS取得 ──────────────────────────────────────────────────
def _fetch_rss_items(url: str, limit: int = 5) -> list:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        items = []
        for item in root.findall(".//item")[:limit]:
            title = item.find("title")
            if title is not None and title.text:
                t = title.text.split(" - ")[0].strip()
                if len(t) > 5:
                    items.append(t)
        return items
    except Exception:
        return []


def _gnews(query: str) -> str:
    return f"https://news.google.com/rss/search?q={query.replace(' ', '+')}&hl=ja&gl=JP&ceid=JP:ja"


# ── トレンドニュース収集（有名人・芸能）─────────────────────
def fetch_celebrity_news() -> list:
    queries = [
        "芸能人 発言 炎上", "有名人 結婚 離婚 話題",
        "芸能人 スキャンダル 騒動", "人気アイドル ニュース",
        "有名人 SNS 話題", "芸能人 引退 復帰",
        "スポーツ選手 発言 話題", "人気俳優 女優 ニュース",
    ]
    seen, result = set(), []
    for q in queries:
        for t in _fetch_rss_items(_gnews(q), 3):
            if t not in seen:
                seen.add(t)
                result.append(t)
    return result[:15]


# ── Pattern A: 商品紹介ツイート生成 ──────────────────────────
def generate_pattern_a(product: dict, ai_client: anthropic.Anthropic) -> str | None:
    title       = product.get("title", "")
    profit_rate = product.get("realProfitRate", 0)
    avg_price   = product.get("realAvgPrice", 0)
    src_price   = product.get("source", {}).get("price", 0)

    prompt = f"""以下の商品情報をもとに、Twitterへの投稿本文を生成してください。

商品名: {title}
楽天仕入れ価格: {src_price:,}円
eBay平均落札価格: {avg_price:,}円
利益率: {profit_rate}%

【投稿スタイル】
- 冒頭は必ず「これ輸出したら稼げるってさ」で始める
- 商品の具体的な利益率や金額を入れる
- 「楽天で買ってeBayで売るだけ」的なシンプルさを強調
- 読んだ人が「やってみたい」と思うような内容

【絶対ルール】
- URLもハッシュタグも絵文字も含めない
- 本文のみ出力（前置き不要）
- Twitterウェイト100以内（日本語1文字=2、英数字=1）
- 最大4行

本文のみ出力してください。"""

    try:
        msg = ai_client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}]
        )
        return msg.content[0].text.strip()
    except Exception as e:
        print(f"  AI生成エラー(A): {e}")
        return None


# ── Pattern B: トレンド便乗ツイート生成 ──────────────────────
def generate_pattern_b(news_items: list, ai_client: anthropic.Anthropic) -> str | None:
    if not news_items:
        return None

    news_text = "\n".join(f"・{n}" for n in news_items[:8])

    prompt = f"""以下の芸能・有名人ニュースの中から1つ選んで、Twitterへの投稿本文を生成してください。

【今日のニュース】
{news_text}

【投稿テンプレート（このまま使うこと）】
〇〇が××だってさ

そんなことしてるより、副業で稼げばいいじゃん
楽天で仕入れてeBayで売るだけで月10万稼げるよ

【ルール】
- 1行目はニュースをもとに「（有名人名）が（出来事）だってさ」の形式にする
- 2行目以降はテンプレートのまま使う（変えない）
- URLもハッシュタグも絵文字も含めない
- 本文のみ出力（前置き不要）
- Twitterウェイト120以内（日本語1文字=2）

本文のみ出力してください。"""

    try:
        msg = ai_client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}]
        )
        return msg.content[0].text.strip()
    except Exception as e:
        print(f"  AI生成エラー(B): {e}")
        return None


# ── ツイート組み立て ──────────────────────────────────────────
def build_tweet_a(body: str) -> str:
    footer = f"\n{SITE_SEARCH_URL}\n#輸出副業 #eBay転売 #楽天せどり"
    return body + footer


def build_tweet_b(body: str) -> str:
    footer = f"\n{SITE_SEARCH_URL}\n#輸出副業 #eBay転売"
    return body + footer


def trim_to_fit(text: str, limit: int = MAX_CHARS) -> str:
    if tw_len(text) <= limit:
        return text
    lines = text.split("\n")
    while lines and tw_len("\n".join(lines)) > limit:
        for i in range(len(lines) - 3, 0, -1):
            if lines[i].strip():
                lines.pop(i)
                break
        else:
            break
    return "\n".join(lines).strip()


# ── メイン ────────────────────────────────────────────────────
def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY 未設定 - スキップ")
        sys.exit(0)

    ai_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    twitter_client = tweepy.Client(
        consumer_key=os.environ["TWITTER_API_KEY"],
        consumer_secret=os.environ["TWITTER_API_SECRET"],
        access_token=os.environ["TWITTER_ACCESS_TOKEN"],
        access_token_secret=os.environ["TWITTER_ACCESS_TOKEN_SECRET"],
    )

    auth = tweepy.OAuth1UserHandler(
        os.environ["TWITTER_API_KEY"],
        os.environ["TWITTER_API_SECRET"],
        os.environ["TWITTER_ACCESS_TOKEN"],
        os.environ["TWITTER_ACCESS_TOKEN_SECRET"],
    )
    api_v1 = tweepy.API(auth)

    now = datetime.now(JST)
    is_pattern_a = (now.hour % 2 == 0)
    pattern_name = "A（商品紹介）" if is_pattern_a else "B（トレンド便乗）"

    print(f"輸出ラボ 自動投稿 開始")
    print(f"  {now.strftime('%-H:%M')} / Pattern {pattern_name}")

    products = fetch_products()
    product  = pick_product(products)
    print(f"  商品: {product['title'][:30] if product else 'なし'}")

    tweet_text = None
    media_id   = None

    if is_pattern_a:
        if not product:
            print("商品なし - スキップ")
            return

        for attempt in range(1, 4):
            print(f"  AI生成 {attempt}/3...")
            body = generate_pattern_a(product, ai_client)
            if body:
                tweet_text = trim_to_fit(build_tweet_a(body))
                if tw_len(tweet_text) <= MAX_CHARS:
                    break

        if product.get("imageUrl"):
            img_bytes = download_image(product["imageUrl"])
            if img_bytes:
                media_id = upload_media(api_v1, img_bytes)
                print(f"  画像アップロード: {'成功' if media_id else '失敗'}")

    else:
        news_items = fetch_celebrity_news()
        print(f"  ニュース: {len(news_items)}件")

        if not news_items:
            print("ニュースなし - スキップ")
            return

        for attempt in range(1, 4):
            print(f"  AI生成 {attempt}/3...")
            body = generate_pattern_b(news_items, ai_client)
            if body:
                tweet_text = trim_to_fit(build_tweet_b(body))
                if tw_len(tweet_text) <= MAX_CHARS:
                    break

        if product and product.get("imageUrl"):
            img_bytes = download_image(product["imageUrl"])
            if img_bytes:
                media_id = upload_media(api_v1, img_bytes)
                print(f"  画像アップロード: {'成功' if media_id else '失敗'}")

    if not tweet_text:
        print("投稿文生成失敗 - スキップ")
        return

    print(f"\n投稿内容 ({tw_len(tweet_text)}w):\n{tweet_text}\n")

    import time
    for attempt in range(1, 4):
        try:
            kwargs = {"text": tweet_text}
            if media_id:
                kwargs["media_ids"] = [media_id]
            response = twitter_client.create_tweet(**kwargs)
            print(f"ツイート成功: ID={response.data['id']}")
            break
        except tweepy.errors.TwitterServerError as e:
            print(f"サーバーエラー ({attempt}/3): {e} - 10秒後リトライ")
            if attempt < 3:
                time.sleep(10)
            else:
                raise
        except Exception as e:
            print(f"エラー: {type(e).__name__}: {e}")
            raise


if __name__ == "__main__":
    main()
