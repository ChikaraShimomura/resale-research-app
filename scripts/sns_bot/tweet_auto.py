"""
輸出ラボ 自動投稿 - 外部cronから workflow_dispatch でトリガー

3タイプ運用:
  ① recruit  副業誘致(初心者)
  ② pro      eBay輸出経験者への認知
  ③ newitem  新商品の追加告知(新着検知で最優先・フォロワー増)

リーチ最適化(2026年のXアルゴリズム/実測に基づく):
  - 本文に外部URLを入れない(無課金アカでリンク付き投稿はエンゲージ率がほぼ0%に崩落するため)。
    商品画像をXへネイティブ直アップし、URLは「最初の自己リプライ」に分離する。
  - 末尾に問いかけ/保存CTAを入れ、いいね(軽)でなく返信・ブックマーク(重)を狙う。
  - ハッシュタグは基本0個(2026年のXはタグで伸びない)。たまに1個だけニッチタグで界隈発見。
  - 頻度はbot側で自動制御: JSTピーク時間帯のみ・1日上限・最小間隔(外部cronの頻度に依存せず安全化)。
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
from io import BytesIO
from datetime import datetime
from email.mime.text import MIMEText
from urllib.parse import quote
import pytz

JST = pytz.timezone('Asia/Tokyo')
SITE_URL = "https://www.yushutsu-fukugyo.com"
SITE_SEARCH_URL = "https://www.yushutsu-fukugyo.com/search"
MAX_CHARS = 280

SEEN_KEY = "tweet_seen_pids"     # 既出商品ID(新着検知用)
SEEN_CAP = 1200
LOG_KEY = "tweet_post_log"       # 直近投稿のepoch秒リスト(頻度制御用)
LASTTYPE_KEY = "tweet_last_type" # 直近のタイプ(連投回避)

# 頻度制御(リーチ最適化): JSTのピーク時間帯のみ・1日上限・最小間隔
PEAK_HOURS_JST = {7, 8, 12, 18, 19, 20, 21, 22}
DAILY_CAP = 8
MIN_GAP_MIN = 50

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
        resp = requests.get(f"{kv_url}/get/{key}", headers={"Authorization": f"Bearer {kv_token}"}, timeout=10)
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


def _load_list(key: str) -> list:
    raw = kv_get_raw(key)
    if not raw:
        return []
    try:
        v = json.loads(raw)
        return v if isinstance(v, list) else []
    except Exception:
        return []


def load_seen() -> list:
    return [str(x) for x in _load_list(SEEN_KEY)]


def save_seen(ids: list):
    kv_set_raw(SEEN_KEY, json.dumps(ids[-SEEN_CAP:], ensure_ascii=False))


def merge_seen(seen: list, current_ids: list) -> list:
    s, sset = list(seen), set(seen)
    for i in current_ids:
        if i not in sset:
            s.append(i)
            sset.add(i)
    return s[-SEEN_CAP:]


# ── 商品取得 ──────────────────────────────────────────────────
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


def product_url(product: dict | None) -> str:
    if product and product.get("id"):
        return f"{SITE_URL}/product/{quote(str(product['id']), safe='')}"
    return SITE_SEARCH_URL


# ── 3タイプの設計(ワークフロー yushutsu-x-copy の最終版) ──
TYPES = {
    "recruit": {
        "label": "副業誘致(初心者)",
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
        ],
        "avoid": [
            "『必ず』『確実』『誰でも◯円稼げる』などの収入断定・保証",
            "『簡単』『即金』『すぐ稼げる』『ほったらかし』などの手軽さ煽り",
            "無在庫転売や『仕入れずに売れる』系の訴求",
            "公式(eBay/楽天)を装う表現",
            "表示利益を確定利益のように見せる断定",
        ],
        "samples": [
            "輸出は英語が要りそうで難しそう…と思ってた私へ。でも{商品名}は楽天{楽天価格}→eBay{eBay相場}。写真1枚でほぼ自動出品、手取りで利益も分かる。完全無料、スマホでまず1品から。あなたは何から始めてみたい？",
            "海外に売るなんて自分には無理、と決めつけてた。でも{商品名}が利益率{利益率%}で候補に並んで驚いた。英語タイトルは自動、初期費用ゼロ。まず1品から。気になった人は保存しておくと後で見返せます。",
        ],
    },
    "pro": {
        "label": "eBay輸出経験者への認知",
        "voice": (
            "現役eBayセラー同士のピア目線。同業の“あるある”をフックに落ち着いた口調で。教える上から目線・初心者煽りは絶対にしない。"
            "『〜しませんか』『〜要らないかも』など軽い問いかけ/独り言ベースで距離を詰める。"
            "専門用語(Terapeak/実利/出品上限/13.25%+¥47/最安〜中央値/PWA)はそのまま使ってよい——通じる相手という合図。"
            "誇張・絵文字・感嘆符連打なし。利益は『想定』『目安』の温度感。"
        ),
        "must": [
            "現役eBayセラーの実作業の悩み(リサーチ時間/実利計算/値付け/出品作業/出品上限 のいずれか)をフックにする",
            "実利(realProfit)=eBay手数料13.25%+¥47・国内送料・楽天ポイント還元まで引いた手取りで利益率順に並ぶこと",
            "相場はeBayの現行の最安〜中央値ベース(高く出して寝かせるより早く回す値付け)",
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
            "リサーチに何時間溶かしてますか。Terapeakで相場を叩いて楽天と往復、手数料13.25%+¥47と国内送料を毎回手計算…。そこを全部引いた“実利”で利益率順に並べました。粗利でなく手取り派、どう思います？",
            "高く出して寝かせるより早く回したい派へ。相場はeBay現行の最安〜中央値ベース。例:{商品名} 楽天{楽天価格}→相場{eBay相場}・想定利益率{利益率%}。あなたなら、この回転をどう値付けしますか？",
        ],
    },
    "newitem": {
        "label": "新商品告知(フォロワー増)",
        "voice": (
            "速報感とお得感のある軽快なトーン。冒頭に『本日の新着』『いま追加』『速報』など“今このタイミング”が伝わる一言を置く。"
            "商品名・利益率・楽天価格・eBay相場を、ニュース速報のように短くテンポよく。"
            "利益率や相場は必ず『想定/目安』とわかる書き方にし、『稼げる』『確実』『必ず』は不可。"
            "eBay相場は『現行の最安値ベースの想定売値』と伝わる表現で。絵文字なし。"
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
            "【本日の新着・利益商品】{商品名}\n楽天{楽天価格} → eBay想定売値{eBay相場}、想定利益率およそ{利益率%}(手数料・送料・ポイント還元まで引いた手取りベース)。\n海外でいくらで売れると思いますか？新着は6時間ごと、フォローで毎日チェックを。",
            "速報、新着候補:{商品名}\n楽天{楽天価格}→eBay想定売値{eBay相場}、手取り想定でおよそ{利益率%}。\n※あくまで想定で相場や状態で変わります。気になる人は保存を。新着は毎日6時間ごとに更新。",
        ],
    },
}

# ハッシュタグは基本0個(2026年のXはタグ照合でなくAIが本文の意味を読むため、タグでは伸びない)。
# たまに1個だけ、界隈の検索/フォローからのゆるい発見用にニッチタグを付ける(固定使い回し回避でプールから選ぶ)。
TAG_POOLS = {
    "recruit": ["#eBay輸出", "#副業"],
    "pro": ["#eBay輸出", "#越境EC"],
    "newitem": ["#eBay輸出", "#輸出ラボ"],
}
TAG_PROBABILITY = 0.25  # 1投稿あたりタグを1個付ける確率(残り約75%は0個)

# URLは本文に入れず「最初の自己リプ」に置く。リード文も毎回ランダムで散らす。
REPLY_LEADS = [
    "▼ 相場・利益の詳細（楽天→eBay）はこちら",
    "この商品の相場・利益を見る →",
    "楽天→eBayの相場・利益はこちら ↓",
    "詳しい相場・利益（手取りベース）はこちら ↓",
]


def pick_tags(tkey: str) -> list:
    # 基本0個。たまに(約25%)だけニッチタグ1本。
    if random.random() < TAG_PROBABILITY:
        return [random.choice(TAG_POOLS.get(tkey, ["#eBay輸出"]))]
    return []


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


def cap_body(body: str, limit: int) -> str:
    if tw_len(body) <= limit:
        return body
    out = ""
    for ch in body:
        if tw_len(out + ch + "…") > limit:
            break
        out += ch
    return out.rstrip() + "…"


# ── 投稿本文生成(タイプ別・URLなし・問いかけ/保存CTA入り) ──
def generate_body(product: dict, tkey: str, ai_client: anthropic.Anthropic, body_limit: int) -> str | None:
    cfg = TYPES[tkey]
    src = product.get("source", {}).get("price", 0)
    must = "\n".join(f"- {m}" for m in cfg["must"])
    avoid = "\n".join(f"- {a}" for a in cfg["avoid"])
    # お手本は商品名が長いと冗長になるため表示用に短縮(実際の商品名は見出しで渡す)
    title = product.get("title", "")
    sample_prod = dict(product)
    sample_prod["title"] = (title[:28] + "…") if len(title) > 30 else title
    samples = "\n\n".join(_fill(s, sample_prod) for s in cfg["samples"])

    prompt = f"""以下の商品情報をもとに、X(Twitter)の投稿本文を生成してください。

商品名: {title}
楽天仕入れ価格: {src:,}円
eBay想定売値(相場・現行の最安〜中央値ベース): {product.get('realAvgPrice', 0):,}円
想定利益率: {product.get('realProfitRate', 0)}%

【投稿タイプ】{cfg['label']}

【口調・方針】
{cfg['voice']}

【必ず触れる】
{must}

【エンゲージの工夫(重要)】
- 末尾に「軽い問いかけ(読み手が思わず返信したくなる一言)」か「気になる人は保存を、のような一言」を、押し付けずに自然に1つ入れる
- 言い切りの宣伝で終わらせない。会話のきっかけ・続きを読みたくなる余白を残す

【禁止】
{avoid}

【お手本(雰囲気を真似る／そのままコピーはしない・毎回 書き出しと構成を変える)】
{samples}

【絶対ルール】
- 本文のみ出力(前置き・「見出し:」等の注釈は不要)
- URL・ハッシュタグ・絵文字は含めない(画像・ハッシュタグ・URLはこちらで付けます)
- 本文はTwitterウェイト{body_limit}以内(日本語1字=2・英数字=1)
- 数字(利益率・価格)は上の商品情報のものを使う。利益率・相場は「想定/目安」とわかる書き方にする
- 適度に改行して読みやすく

本文のみ出力してください。"""

    try:
        msg = ai_client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=320,
            messages=[{"role": "user", "content": prompt}],
        )
        body = msg.content[0].text.strip()
        return _URL_RE.sub("", body).strip()  # 念のため誤URLは除去
    except Exception as e:
        print(f"  AI生成エラー({tkey}): {e}")
        return None


# ── 画像をXへネイティブ直アップ(リーチ最適化。失敗しても画像なしで続行) ──
def upscale_image(url: str) -> str:
    return re.sub(r'_ex=\d+x\d+', '_ex=600x600', url or "")


def upload_image(api_v1, image_url: str):
    if api_v1 is None or not image_url:
        return None
    try:
        r = requests.get(upscale_image(image_url), timeout=15, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        ctype = r.headers.get("Content-Type", "").lower()
        ext = "png" if "png" in ctype else "gif" if "gif" in ctype else "webp" if "webp" in ctype else "jpg"
        media = api_v1.media_upload(filename=f"product.{ext}", file=BytesIO(r.content))
        return media.media_id
    except Exception as e:
        print(f"  画像アップロード失敗(画像なしで続行): {e}")
        return None


# ── 頻度制御(ピーク時間帯のみ・1日上限・最小間隔) ──
def frequency_gate(now: datetime) -> tuple[bool, str, list]:
    log = [float(x) for x in _load_list(LOG_KEY) if isinstance(x, (int, float))]
    today = now.strftime("%Y-%m-%d")
    today_count = sum(1 for ts in log if datetime.fromtimestamp(ts, JST).strftime("%Y-%m-%d") == today)
    last_ts = max(log) if log else 0.0
    gap_min = (now.timestamp() - last_ts) / 60 if last_ts else 1e9

    if now.hour not in PEAK_HOURS_JST:
        return False, f"ピーク時間外(JST {now.hour}時)", log
    if today_count >= DAILY_CAP:
        return False, f"本日の上限({DAILY_CAP}本)に到達", log
    if gap_min < MIN_GAP_MIN:
        return False, f"前回から{gap_min:.0f}分(<{MIN_GAP_MIN}分)", log
    return True, f"OK(本日{today_count}本/{DAILY_CAP}・前回{gap_min:.0f}分前)", log


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
    # 画像のネイティブ直アップ用(v1.1)。初期化失敗時は画像なしで続行。
    api_v1 = None
    try:
        auth = tweepy.OAuth1UserHandler(
            os.environ["TWITTER_API_KEY"], os.environ["TWITTER_API_SECRET"],
            os.environ["TWITTER_ACCESS_TOKEN"], os.environ["TWITTER_ACCESS_TOKEN_SECRET"],
        )
        api_v1 = tweepy.API(auth)
    except Exception as e:
        print(f"  v1.1 API初期化失敗(画像なしで続行): {e}")

    now = datetime.now(JST)
    print("輸出ラボ 自動投稿 開始")

    # 頻度ゲート(AI生成の前に判定してコストを節約)
    ok, reason, log = frequency_gate(now)
    print(f"  頻度ゲート: {reason}")
    if not ok:
        print("  → 今回は投稿しない")
        return

    products = fetch_products()
    if not products:
        print("商品なし - スキップ")
        send_alert_email(
            "⚠️ 輸出ラボBot 商品データなし",
            "商品データがKVに存在しないため、自動投稿をスキップしました。\n"
            "refresh.yml を確認してください。\n"
            "https://github.com/ChikaraShimomura/resale-research-app/actions/workflows/refresh.yml\n\n"
            f"実行時刻: {now.strftime('%Y-%m-%d %H:%M')} JST",
        )
        return

    current_ids = [str(p["id"]) for p in products if p.get("id")]
    seen = load_seen()
    seen_set = set(seen)
    first_run = len(seen) == 0
    new_products = [p for p in products if str(p.get("id")) not in seen_set]

    # タイプ選択: 新着があれば③newitem最優先。無ければ①/②を直近と違うものにして連投回避。
    mark_seen = False
    if (not first_run) and new_products:
        tkey = "newitem"
        product = max(new_products, key=lambda p: p.get("realProfitRate", 0))
        mark_seen = True
    else:
        last_type = kv_get_raw(LASTTYPE_KEY) or ""
        choices = [c for c in ("recruit", "pro") if c != last_type] or ["recruit", "pro"]
        tkey = random.choice(choices)
        product = pick_product(products)
        if first_run:
            save_seen(current_ids)  # 初回は基準記録のみ(全件“新着”誤爆を防ぐ)

    tags = pick_tags(tkey)
    tags_str = " ".join(tags)
    body_limit = MAX_CHARS - tw_len(tags_str) - 4  # 本文末にタグのみ(URLは自己リプへ)

    print(f"  {now.strftime('%-H:%M')} / type={tkey}({TYPES[tkey]['label']}) / 新着={len(new_products)}件 / tags={tags_str}")
    print(f"  商品: {product['title'][:30] if product else 'なし'}")

    body = None
    for attempt in range(1, 4):
        print(f"  AI生成 {attempt}/3...")
        b = generate_body(product, tkey, ai_client, body_limit)
        if b:
            body = cap_body(b, body_limit)
            break
    if not body:
        print("投稿文生成失敗 - スキップ")
        return

    main_text = f"{body}\n\n{tags_str}" if tags_str else body
    card_url = product_url(product)

    # 等間隔投稿を避けるための軽いジッター(ジョブのタイムアウト内)
    time.sleep(random.randint(0, 90))

    # 画像をネイティブ直アップ
    media_id = upload_image(api_v1, product.get("imageUrl", ""))
    print(f"  画像: {'直アップ成功' if media_id else 'なし(テキスト+自己リプ)'}")

    # 本投稿(本文+ハッシュタグ+画像、URLなし)
    print(f"\n投稿本文 ({tw_len(main_text)}w):\n{main_text}\n")
    tweet_id = None
    for attempt in range(1, 4):
        try:
            kwargs = {"text": main_text}
            if media_id:
                kwargs["media_ids"] = [media_id]
            resp = twitter_client.create_tweet(**kwargs)
            tweet_id = resp.data["id"]
            print(f"本投稿成功: ID={tweet_id}")
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

    if not tweet_id:
        return

    # URLを自己リプに分離(リーチ最適化)。失敗しても本投稿は成立しているので致命的でない。
    try:
        reply_text = f"{random.choice(REPLY_LEADS)}\n{card_url}"
        twitter_client.create_tweet(text=reply_text, in_reply_to_tweet_id=tweet_id)
        print("自己リプ(URL)成功")
    except Exception as e:
        print(f"自己リプ失敗(本投稿は成功済み): {type(e).__name__}: {e}")

    # 状態を更新: 投稿ログ(頻度制御)・直近タイプ(連投回避)・既出ID(新着検知)
    save_seen_log = log + [now.timestamp()]
    kv_set_raw(LOG_KEY, json.dumps(save_seen_log[-200:]))
    kv_set_raw(LASTTYPE_KEY, tkey)
    if mark_seen:
        save_seen(merge_seen(seen, current_ids))
        print("  既出ID更新(新着検知の基準を更新)")


if __name__ == "__main__":
    main()
