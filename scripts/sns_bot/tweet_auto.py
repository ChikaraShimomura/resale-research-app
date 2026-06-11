"""
輸出ラボ 自動投稿 - 毎時15分（24本/日）

2パターンローテーション:
  偶数時間 → Pattern A: 商品紹介「これ輸出したら稼げるってさ」
  奇数時間 → Pattern B: トレンド便乗「〇〇が××だってさ」
"""
import os
import re
import sys
import json
import time
import random
import smtplib
import tweepy
import requests
import anthropic
import xml.etree.ElementTree as ET
from datetime import datetime
from email.mime.text import MIMEText
from urllib.parse import quote
import pytz

JST = pytz.timezone('Asia/Tokyo')
SITE_URL = "https://www.yushutsu-fukugyo.com"

def send_alert_email(subject: str, body: str):
    gmail_user = os.environ.get("GMAIL_USERNAME", "")
    gmail_pass = os.environ.get("GMAIL_APP_PASSWORD", "")
    if not gmail_user or not gmail_pass:
        return
    try:
        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"] = f"輸出ラボBot <{gmail_user}>"
        msg["To"] = "chikara0323@gmail.com"
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
            smtp.login(gmail_user, gmail_pass)
            smtp.send_message(msg)
        print("  通知メール送信完了")
    except Exception as e:
        print(f"  メール送信失敗: {e}")
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


# ── 商品ページURL（Xカード用） ────────────────────────────────
# メディアを直接アップロードせず /product/{id} を投稿することで、
# X が summary_large_image カードを描画する。
#   → 画像が鮮明（og:image は高解像度）かつ画像クリックでサイトへ遷移する。
def product_url(product: dict | None) -> str:
    if product and product.get("id"):
        return f"{SITE_URL}/product/{quote(str(product['id']), safe='')}"
    return SITE_SEARCH_URL


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

【口調・トーン（重要）】
このBotのもう一つの投稿パターンと口調を揃えること。タメ口で、煽り気味で、
「〜だってさ」「〜じゃん」「〜だけで稼げるよ」のようなカジュアルで挑発的な語り口。
お手本の雰囲気↓
「○○が△△だってさ／そんなことしてるより、副業で稼げばいいじゃん／楽天で仕入れてeBayで売るだけで月10万稼げるよ」

【投稿スタイル】
- 冒頭は必ず「これ輸出したら稼げるってさ」で始める
- 上の口調のまま、商品の具体的な利益率や金額を1つ入れる
- 「楽天で買ってeBayで売るだけ」的なシンプルさ・手軽さを煽る
- 読んだ人が「やってみたい」と思うように

【絶対ルール】
- URLもハッシュタグも絵文字も含めない
- 本文のみ出力（前置き不要）
- Twitterウェイト100以内（日本語1文字=2、英数字=1）
- 読みやすいように適度に改行する（2〜3行に分け、文の区切りで改行・1か所くらい空行を入れる）

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
# news_item は呼び出し側でトレンドtop10からランダムに1件選んで渡す（毎回違う話題にするため）。
def generate_pattern_b(news_item: str, ai_client: anthropic.Anthropic) -> str | None:
    if not news_item:
        return None

    prompt = f"""以下の芸能・有名人ニュースをもとに、Twitterへの投稿本文を生成してください。

【今日の話題】
{news_item}

【投稿テンプレート（このまま使うこと）】
〇〇が××だってさ

そんなことしてるより、副業で稼げばいいじゃん
楽天で仕入れてeBayで売るだけで月10万稼げるよ

【ルール】
- 1行目は上の話題をもとに「（有名人名）が（出来事）だってさ」の形式にする
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
# url は商品ページURL（Xカード化）。本文末尾に置くとXがカードを描画する。
def build_tweet_a(body: str, url: str) -> str:
    return body + f"\n\n{url}"


def build_tweet_b(body: str, url: str) -> str:
    return body + f"\n\n{url}"


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
    # メディアアップロード(OAuth1/v1.1)は廃止。商品ページURLのXカードで画像を表示する。

    now = datetime.now(JST)
    is_pattern_a = (now.hour % 2 == 0)
    pattern_name = "A（商品紹介）" if is_pattern_a else "B（トレンド便乗）"

    print(f"輸出ラボ 自動投稿 開始")
    print(f"  {now.strftime('%-H:%M')} / Pattern {pattern_name}")

    products = fetch_products()
    product  = pick_product(products)
    print(f"  商品: {product['title'][:30] if product else 'なし'}")

    # 投稿する商品ページURL（Xカードでサムネを鮮明に＋画像クリックでサイトへ）
    card_url = product_url(product)
    tweet_text = None

    if is_pattern_a:
        if not product:
            print("商品なし - スキップ")
            send_alert_email(
                "⚠️ 輸出ラボBot 商品データなし",
                f"商品データがKVに存在しないため、自動投稿をスキップしました。\n\nrefresh.ymlが正常に完了しているか確認してください。\nhttps://github.com/ChikaraShimomura/resale-research-app/actions/workflows/refresh.yml\n\n実行時刻: {now.strftime('%Y-%m-%d %H:%M')} JST"
            )
            return

        for attempt in range(1, 4):
            print(f"  AI生成 {attempt}/3...")
            body = generate_pattern_a(product, ai_client)
            if body:
                tweet_text = trim_to_fit(build_tweet_a(body, card_url))
                if tw_len(tweet_text) <= MAX_CHARS:
                    break

    else:
        news_items = fetch_celebrity_news()
        print(f"  ニュース: {len(news_items)}件")

        if not news_items:
            print("ニュースなし - スキップ")
            return

        # トレンドtop10からランダムに1件選ぶ（毎回同じ話題にならないように）
        chosen = random.choice(news_items[:10])
        print(f"  選択トレンド: {chosen[:40]}")

        for attempt in range(1, 4):
            print(f"  AI生成 {attempt}/3...")
            body = generate_pattern_b(chosen, ai_client)
            if body:
                tweet_text = trim_to_fit(build_tweet_b(body, card_url))
                if tw_len(tweet_text) <= MAX_CHARS:
                    break

    if not tweet_text:
        print("投稿文生成失敗 - スキップ")
        return

    # 3回生成しても280超なら投稿せずスキップ（API 403でCI失敗するのを防ぐ）
    if tw_len(tweet_text) > MAX_CHARS:
        print(f"文字数オーバー({tw_len(tweet_text)}w) - スキップ")
        send_alert_email(
            "⚠️ 輸出ラボBot 文字数オーバー",
            f"3回生成しても{MAX_CHARS}超({tw_len(tweet_text)}w)のため投稿をスキップしました。\n\n{tweet_text}"
        )
        return

    print(f"\n投稿内容 ({tw_len(tweet_text)}w):\n{tweet_text}\n")

    for attempt in range(1, 4):
        try:
            response = twitter_client.create_tweet(text=tweet_text)
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
