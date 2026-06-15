"""
輸出ラボ 自動投稿 - 外部cronから workflow_dispatch でトリガー

3タイプ運用:
  ① recruit  副業誘致(初心者)         … 偶数時間のローテーション
  ② pro      eBay輸出経験者への認知    … 奇数時間のローテーション
  ③ newitem  新商品の追加告知          … 新着商品を検知したら最優先(フォロワー増)

新着検知: KVに「既出の商品ID」(tweet_seen_pids)を保存し、refresh(6時間ごと)で
新しく入った商品が出たら ③ を投稿。初回は既存カタログを基準として記録するだけ
(全件を“新着”として誤爆しない)。
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
from datetime import datetime
from email.mime.text import MIMEText
from urllib.parse import quote
import pytz

JST = pytz.timezone('Asia/Tokyo')
SITE_URL = "https://www.yushutsu-fukugyo.com"
SITE_SEARCH_URL = "https://www.yushutsu-fukugyo.com/search"
MAX_CHARS = 280

SEEN_KEY = "tweet_seen_pids"   # KVに保存する既出商品IDのリスト
SEEN_CAP = 1200                # 保存上限(古いものから切り捨て)

_URL_RE = re.compile(r'https?://\S+')


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


# ── KV (Upstash REST) 読み書き ────────────────────────────────
def _kv_env():
    return os.environ.get("KV_REST_API_URL", ""), os.environ.get("KV_REST_API_TOKEN", "")


def kv_get_raw(key: str):
    kv_url, kv_token = _kv_env()
    if not kv_url or not kv_token:
        return None
    try:
        resp = requests.get(
            f"{kv_url}/get/{key}",
            headers={"Authorization": f"Bearer {kv_token}"},
            timeout=10,
        )
        return resp.json().get("result")
    except Exception as e:
        print(f"  KV取得エラー({key}): {e}")
        return None


def kv_set_raw(key: str, value: str) -> bool:
    kv_url, kv_token = _kv_env()
    if not kv_url or not kv_token:
        return False
    try:
        resp = requests.post(
            f"{kv_url}/set/{key}",
            headers={"Authorization": f"Bearer {kv_token}"},
            data=value.encode("utf-8"),
            timeout=10,
        )
        return resp.ok
    except Exception as e:
        print(f"  KV保存エラー({key}): {e}")
        return False


def load_seen() -> list:
    raw = kv_get_raw(SEEN_KEY)
    if not raw:
        return []
    try:
        v = json.loads(raw)
        return [str(x) for x in v] if isinstance(v, list) else []
    except Exception:
        return []


def save_seen(ids: list):
    kv_set_raw(SEEN_KEY, json.dumps(ids[-SEEN_CAP:], ensure_ascii=False))


def merge_seen(seen: list, current_ids: list) -> list:
    s, sset = list(seen), set(seen)
    for i in current_ids:
        if i not in sset:
            s.append(i)
            sset.add(i)
    return s[-SEEN_CAP:]


# ── 輸出ラボ商品をKVから取得 ──────────────────────────────────
def fetch_products() -> list:
    raw = kv_get_raw("profitable_products")
    if not raw:
        print("  商品データなし(KV)")
        return []
    try:
        products = json.loads(raw)
        good = [p for p in products if p.get("realProfitRate", 0) >= 30 and p.get("imageUrl")]
        return good if good else products
    except Exception as e:
        print(f"  商品パースエラー: {e}")
        return []


def pick_product(products: list) -> dict | None:
    if not products:
        return None
    top = sorted(products, key=lambda p: p.get("realProfitRate", 0), reverse=True)[:20]
    return random.choice(top)


# ── 商品ページURL（Xカード用） ────────────────────────────────
# メディアを直接アップロードせず /product/{id} を投稿することで、
# X が summary_large_image カードを描画する（画像が鮮明・クリックでサイトへ）。
def product_url(product: dict | None) -> str:
    if product and product.get("id"):
        return f"{SITE_URL}/product/{quote(str(product['id']), safe='')}"
    return SITE_SEARCH_URL


# ── 3タイプの設計（ワークフロー yushutsu-x-copy の最終版を反映）──
TYPES = {
    "recruit": {
        "label": "副業誘致(初心者)",
        "hashtags": ["#副業", "#eBay輸出"],
        "voice": (
            "やさしく背中をそっと押す先輩の口調。専門用語(越境EC/出品上限等)は使わない。"
            "まず『難しそう・英語が無理・怖い』という不安に共感し、それを溶かす形で強みを1〜2点だけ自然に織り込む"
            "(完全無料/写真だけほぼ自動出品で英語ほぼ不要/手数料・送料を引いた手取りで利益が分かる/パスワードを渡さない安全設計 のいずれか)。"
            "円安と日本商品の海外人気は前向きな追い風として軽く添える。文末は柔らかく。絵文字なし。"
        ),
        "must": [
            "輸出=難しそう/英語が無理/怖い、という不安を溶かす一言",
            "完全無料・初期費用ゼロ・スマホのスキマ時間で始められること",
            "強みを1〜2点だけ(利益率順に自動発見/手取りまで自動計算/写真だけほぼ自動出品で英語ほぼ不要 のいずれか)",
            "小さく試せて自分にもできそう、と思える締め",
        ],
        "avoid": [
            "『必ず』『確実』『誰でも◯円稼げる』などの収入断定・保証",
            "『簡単』『即金』『すぐ稼げる』『ほったらかし』などの手軽さ煽り",
            "無在庫転売や『仕入れずに売れる』系の訴求",
            "公式(eBay/楽天)を装う表現",
            "表示利益を確定利益のように見せる断定",
        ],
        "samples": [
            "輸出は英語が要りそうで難しそう…と思ってた私へ。でも{商品名}は楽天{楽天価格}→eBay{eBay相場}。写真1枚でほぼ自動出品、手取りで利益も分かる。完全無料、スマホでまず1品から試せます。",
            "海外に売るなんて自分には無理、と決めつけてた。でも{商品名}が利益率{利益率%}で候補に並んで驚いた。英語タイトルは自動、パスワードも渡さない設計。初期費用ゼロ、まず1品から。やってみたい気持ちが少し動きました。",
        ],
    },
    "pro": {
        "label": "eBay輸出経験者への認知",
        "hashtags": ["#eBay輸出", "#越境EC", "#物販副業"],
        "voice": (
            "現役eBayセラー同士のピア目線。同業の“あるある”をフックに落ち着いた口調で。教える上から目線・初心者煽りは絶対にしない。"
            "『〜しませんか』『〜要らないかも』など軽い問いかけ/独り言ベースで距離を詰める。"
            "専門用語(Terapeak/実利/出品上限/13.25%+¥47/最安〜中央値/PWA)はそのまま使ってよい——通じる相手という合図。"
            "誇張・絵文字・感嘆符連打なし。利益は『想定』『目安』の温度感。完全無料は一度触れる程度で連呼しない。"
            "締めは押し売りせず『置いときます』程度の軽さ。"
        ),
        "must": [
            "現役eBayセラーの実作業の悩み(リサーチ時間/実利計算/値付け/出品作業/出品上限 のいずれか)をフックにする",
            "実利(realProfit)=eBay手数料13.25%+¥47・国内送料・楽天ポイント還元まで引いた手取りで利益率順に並ぶこと",
            "相場はeBayの現行の最安〜中央値ベース(高く出して寝かせるより早く回す値付け)",
            "完全無料・PWAでホーム追加できること(月額リサーチツールの固定費対比)",
        ],
        "avoid": [
            "必ず/確実/誰でも◯円などの収入断定・誇大表現",
            "簡単/すぐ/即金などの手軽さ煽り",
            "無在庫転売をにおわせる表現",
            "公式/eBay公認を装う表現",
            "初心者を見下す・煽るトーン",
            "『売れた商品を自動検知』など実売確定の断定(実態は出品者数による飽和サイン)",
        ],
        "samples": [
            "リサーチに何時間溶かしてますか。Terapeakで相場を叩いて楽天と往復、手数料13.25%+¥47と国内送料を毎回手計算…。そこを全部引いた“実利”で利益率順に並べました。粗利でなく手取りで見たい人向け。無料で置いときます。",
            "高く出して寝かせるより早く回したい派へ。相場はeBay現行の最安〜中央値ベースなので、回す前提の値が一目で分かる。例:{商品名} 楽天{楽天価格}→相場{eBay相場}・想定利益率{利益率%}。無料・ホーム追加でスキマ時間に。",
        ],
    },
    "newitem": {
        "label": "新商品告知(フォロワー増)",
        "hashtags": ["#eBay輸出", "#物販副業", "#輸出ラボ"],
        "voice": (
            "速報感とお得感のある軽快なトーン。冒頭に『本日の新着』『いま追加』『速報』など“今このタイミング”が伝わる一言を置く。"
            "商品名・利益率・楽天価格・eBay相場を、ニュース速報のように短くテンポよく。1〜2文+数字提示が基本形。"
            "利益率や相場は必ず『想定/目安』とわかる書き方にし、『稼げる』『確実』『必ず』は不可。"
            "eBay相場は『現行の最安値ベースの想定売値』と伝わる表現で。最後は『6時間ごとに新着→フォローしてチェック』へ自然に誘導。絵文字なし。"
        ),
        "must": [
            "『本日の新着』『いま追加』『速報』など速報感を出す冒頭の一言",
            "商品名(具体名)",
            "想定利益率(%)を“目安/想定”とわかる形で",
            "楽天の仕入れ価格 と eBayの想定売値(現行の最安値ベースの相場)",
            "6時間ごとに新着が出るのでフォローして毎日チェック、という誘導",
        ],
        "avoid": [
            "『稼げる』『必ず』『確実』『誰でも◯円』などの収入の断定・保証",
            "『即金』『不労所得』『ノーリスク』など誇大表現",
            "『無在庫』『仕入れずに売れる』系の訴求",
            "表示利益を確定利益のように見せること(必ず“想定/目安”とわかるように)",
            "eBay/楽天の公式サービスであるかのような表現",
        ],
        "samples": [
            "【本日の新着・利益商品】{商品名}\n楽天{楽天価格} → eBay想定売値{eBay相場}、想定利益率およそ{利益率%}(手数料・送料・ポイント還元まで引いた手取りベース)。\n新着は6時間ごと。フォローして毎日チェックを。",
            "速報、新着候補:{商品名}\n楽天{楽天価格}→eBay想定売値{eBay相場}、手取り想定でおよそ{利益率%}。\n※あくまで想定で相場や状態で変わります。毎日6時間ごとに新着。見逃したくない方はフォローを。",
        ],
    },
}


def _fill(text: str, product: dict) -> str:
    src = product.get("source", {}).get("price", 0)
    avg = product.get("realAvgPrice", 0)
    rate = product.get("realProfitRate", 0)
    return (
        text.replace("{商品名}", product.get("title", ""))
            .replace("{楽天価格}", f"{src:,}円")
            .replace("{eBay相場}", f"{avg:,}円")
            .replace("{利益率%}", f"{rate}%")
    )


# ── 投稿本文生成（タイプ別） ──────────────────────────────────
def generate_body(product: dict, tkey: str, ai_client: anthropic.Anthropic) -> str | None:
    cfg = TYPES[tkey]
    src = product.get("source", {}).get("price", 0)
    must = "\n".join(f"- {m}" for m in cfg["must"])
    avoid = "\n".join(f"- {a}" for a in cfg["avoid"])
    # お手本は商品名が長いと冗長になるため、表示用に商品名を短縮（実際の商品名は上の見出しで渡す）
    title = product.get("title", "")
    sample_prod = dict(product)
    sample_prod["title"] = (title[:28] + "…") if len(title) > 30 else title
    samples = "\n\n".join(_fill(s, sample_prod) for s in cfg["samples"])
    body_limit = body_limit_for(tkey)

    prompt = f"""以下の商品情報をもとに、X(Twitter)の投稿本文を生成してください。

商品名: {product.get('title', '')}
楽天仕入れ価格: {src:,}円
eBay想定売値(相場・現行の最安〜中央値ベース): {product.get('realAvgPrice', 0):,}円
想定利益率: {product.get('realProfitRate', 0)}%

【投稿タイプ】{cfg['label']}

【口調・方針】
{cfg['voice']}

【必ず触れる】
{must}

【禁止】
{avoid}

【お手本（雰囲気を真似る／そのままコピーはしない）】
{samples}

【絶対ルール】
- 本文のみ出力（前置き・説明・「見出し:」のような注釈は不要）
- URL・ハッシュタグ・絵文字は含めない（こちらで付けます）
- 本文はTwitterウェイト{body_limit}以内（日本語1字=2・英数字=1）。ハッシュタグとURLはこちらで付けます
- 数字（利益率・価格）は上の商品情報のものを使う。利益率・相場は「想定/目安」とわかる書き方にする
- 適度に改行して読みやすく

本文のみ出力してください。"""

    try:
        msg = ai_client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=320,
            messages=[{"role": "user", "content": prompt}],
        )
        body = msg.content[0].text.strip()
        # 念のため：誤って付いたURLは除去（末尾でこちらが付け直す）
        return _URL_RE.sub("", body).strip()
    except Exception as e:
        print(f"  AI生成エラー({tkey}): {e}")
        return None


# ── ツイート組み立て（本文 + ハッシュタグ + 商品URLでXカード化）──
def build_tweet(body: str, tkey: str, url: str) -> str:
    tags = " ".join(TYPES[tkey]["hashtags"])
    return f"{body}\n\n{tags}\n{url}"


def body_limit_for(tkey: str) -> int:
    # 本文ウェイト上限 = 280 - URL(23) - ハッシュタグ - 区切り(約4)。URLとタグは必ず残す。
    return MAX_CHARS - 23 - tw_len(" ".join(TYPES[tkey]["hashtags"])) - 4


def cap_body(body: str, limit: int) -> str:
    if tw_len(body) <= limit:
        return body
    out = ""
    for ch in body:
        if tw_len(out + ch + "…") > limit:
            break
        out += ch
    return out.rstrip() + "…"


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

    now = datetime.now(JST)
    print("輸出ラボ 自動投稿 開始")

    products = fetch_products()
    if not products:
        print("商品なし - スキップ")
        send_alert_email(
            "⚠️ 輸出ラボBot 商品データなし",
            "商品データがKVに存在しないため、自動投稿をスキップしました。\n"
            "refresh.yml が正常に完了しているか確認してください。\n"
            "https://github.com/ChikaraShimomura/resale-research-app/actions/workflows/refresh.yml\n\n"
            f"実行時刻: {now.strftime('%Y-%m-%d %H:%M')} JST",
        )
        return

    current_ids = [str(p["id"]) for p in products if p.get("id")]
    seen = load_seen()
    seen_set = set(seen)
    first_run = len(seen) == 0
    new_products = [p for p in products if str(p.get("id")) not in seen_set]

    # タイプ選択: 新着があれば ③newitem を最優先。無ければ時間帯で ①recruit / ②pro。
    mark_seen = False
    if (not first_run) and new_products:
        tkey = "newitem"
        product = max(new_products, key=lambda p: p.get("realProfitRate", 0))
        mark_seen = True
    else:
        tkey = "recruit" if now.hour % 2 == 0 else "pro"
        product = pick_product(products)
        if first_run:
            # 初回は既存カタログを基準として記録（全件“新着”誤爆を防ぐ）
            save_seen(current_ids)

    print(f"  {now.strftime('%-H:%M')} / type={tkey}（{TYPES[tkey]['label']}）/ 新着={len(new_products)}件")
    print(f"  商品: {product['title'][:30] if product else 'なし'}")

    card_url = product_url(product)
    tweet_text = None
    for attempt in range(1, 4):
        print(f"  AI生成 {attempt}/3...")
        body = generate_body(product, tkey, ai_client)
        if body:
            body = cap_body(body, body_limit_for(tkey))
            cand = build_tweet(body, tkey, card_url)
            if tw_len(cand) <= MAX_CHARS:
                tweet_text = cand
                break

    if not tweet_text:
        print("投稿文生成失敗 - スキップ")
        return

    if tw_len(tweet_text) > MAX_CHARS:
        print(f"文字数オーバー({tw_len(tweet_text)}w) - スキップ")
        send_alert_email(
            "⚠️ 輸出ラボBot 文字数オーバー",
            f"3回生成しても{MAX_CHARS}超({tw_len(tweet_text)}w)のため投稿をスキップしました。\n\n{tweet_text}",
        )
        return

    print(f"\n投稿内容 ({tw_len(tweet_text)}w):\n{tweet_text}\n")

    for attempt in range(1, 4):
        try:
            response = twitter_client.create_tweet(text=tweet_text)
            print(f"ツイート成功: ID={response.data['id']}")
            # 新着告知が成功したら、今回のカタログ全IDを既出として記録（次の新着検知の基準）
            if mark_seen:
                save_seen(merge_seen(seen, current_ids))
                print("  既出ID更新（新着検知の基準を更新）")
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
