"""
輸出ラボ 自動投稿 - 外部cronから workflow_dispatch でトリガー

コンテンツ設計(柱モデル): 価値:宣伝=8:2 を投稿数で機械的に担保する。
  柱(pillar):
    - soba         「今日の相場 #N」日次(朝枠予約) … 商品の相場の読み解き(知識)
    - pro          eBay輸出経験者向けの実利/相場の考え方
    - recruit      副業初心者向けの不安解消・基礎
    - howto        汎用ノウハウ(送料の電子申告/カテゴリ/英訳/危険物/利益計算)
    - pitfall      「輸出の落とし穴 #N」週次(木) … 失敗→なぜ→回避
    - buildinpublic 週次(月) … 運営のプロセス数字(出品数/相場一致率など・収入断定なし)
    - announce     新商品告知(=直接宣伝) 1日1本まで。唯一URLを自己リプに付ける枠。
  → announce以外はURLを本文にも自己リプにも付けない(リーチ重視・誘導はプロフィール)。

人格(ペルソナ)を全投稿に固定注入。リーチ最適化(本文URL回避/画像ネイティブ直アップ/低頻度/
保存・問いかけCTA/ハッシュタグ基本0)は従来どおり。収入の断定・誇大はゼロ(景表法/特商法)。
"""
import os
import re
import sys
import json
import time
import random
import tweepy
import requests
import anthropic
from io import BytesIO
from datetime import datetime
from urllib.parse import quote
import pytz

JST = pytz.timezone('Asia/Tokyo')
SITE_URL = "https://www.yushutsu-fukugyo.com"
MAX_CHARS = 280

SEEN_KEY = "tweet_seen_pids"
SEEN_CAP = 1200
LOG_KEY = "tweet_post_log"        # 直近投稿 [{"t":epoch,"k":kind}, ...]
LASTKIND_KEY = "tweet_last_kind"
SOBA_N_KEY = "tweet_soba_n"        # 「今日の相場」連番
PITFALL_N_KEY = "tweet_pitfall_n"  # 「輸出の落とし穴」連番
POLL_PENDING_KEY = "tweet_poll_pending"  # 投票の答え合わせ待ち [{id,t,e,r,p}, ...]
POLL_DURATION_MIN = 1440           # 投票期間(24時間)

# 頻度制御
PEAK_HOURS_JST = {7, 8, 12, 18, 19, 20, 21, 22}
MORNING_HOURS = {7, 8}
# 小規模アカウントは「少数×高品質」が有利(ブロードキャストはリーチが薄い)。本数を絞り、
# 認知の主軸は手動リプライ(リプライレーダー)に置く。bot投稿は価値提供で薄く存在させる。
DAILY_CAP = 5
MIN_GAP_MIN = 90
ANNOUNCE_CAP = 1            # 直接宣伝(announce)は1日1本まで=価値:宣伝≒4:1(8割以上が価値提供)
PITFALL_WEEKDAY = 3        # 木曜(Mon=0)
BUILDINPUBLIC_WEEKDAY = 0  # 月曜

_URL_RE = re.compile(r'https?://\S+')

# ── 人格(ペルソナ): 全投稿の生成プロンプトに固定注入 ──
PERSONA = (
    "あなたは『輸出ラボ』運営者“本人”の人格で書く。大阪出身・30歳くらいのITコンサルタントで、楽天→eBay輸出も自分でやっている。"
    "口調は自然な関西弁。大阪の30代が普段しゃべる感じで、語尾や言い回しに『〜やな／〜やねん／〜やろ／〜してまう／ほんま／めっちゃ／ええ感じ／あかん／せやから／〜ちゃう？』などを自然に織り交ぜる。友達に話すような砕けた距離感(タメ口寄り)。"
    "ただしコテコテのエセ関西弁・吉本芸人風(『〜でっせ』『儲かりまっせ』『なんでやねん』みたいな誇張やボケツッコミ)はNG。地元の人が普通にしゃべる自然な関西弁にとどめ、わざとらしくしない・読み手をバカにしない。『ぶっちゃけ』や若者すぎる言葉も避ける。"
    "ITコンサルなので、関西弁でも要点はロジカルに分かりやすく整理する。絵文字は使わない。"
    "収入・利益額の断定や保証、『必ず/確実/誰でも◯円/簡単/即金/不労所得』は禁止(景表法・特商法)。利益や相場は必ず『想定・目安』とわかる書き方。"
)

# ── 共通: 末尾の問いかけ/保存CTA(返信・ブックマークを狙う) ──
ENGAGE = (
    "末尾に「読み手が思わず返信したくなる軽い問いかけ」か「気になる人は保存を、のような一言」を、押し付けず自然に1つ入れる。"
    "言い切りで終わらせず、会話のきっかけ・続きを読みたくなる余白を残す。"
)

# ── 共通: 読みやすさ(改行・句読点を「適度に」入れる。多すぎは逆効果なので慎重に) ──
READABILITY = (
    "読みやすさ重要。文には句読点(、。)をきちんと打ち、声に出して読めるテンポにする。"
    "話題の切れ目で改行し、2〜3行ごとの短いまとまりに分ける。"
    "ただしやり過ぎ厳禁: 1投稿の改行は多くても2〜3回まで。1行ずつのブツ切り・空行の連発・記号の盛りすぎはしない。"
    "改行や句読点を入れても、ラフでカジュアルな話し言葉のテンポは保つ。"
)


def send_alert_email(subject: str, body: str):
    # メール送信は Resend に一本化（app/lib/email.ts と同じ経路・差出人）。
    # RESEND_API_KEY 未設定の環境では送信せずスキップ（非破壊）。
    api_key = os.environ.get("RESEND_API_KEY", "")
    if not api_key:
        return
    mail_from = os.environ.get("MAIL_FROM") or "輸出ラボ <noreply@yushutsu-fukugyo.com>"
    mail_to = os.environ.get("REPORT_TO") or "chikara0323@gmail.com"
    try:
        res = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"from": mail_from, "to": mail_to, "subject": subject, "text": body},
            timeout=15,
        )
        if res.status_code >= 300:
            print(f"  メール送信失敗: {res.status_code} {res.text[:200]}")
    except Exception as e:
        print(f"  メール送信失敗: {e}")


# ── Twitter文字数カウント ──
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


# ── KV (Upstash REST) ──
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
            data=value.encode("utf-8"), timeout=10,
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


def kv_get_int(key: str) -> int:
    raw = kv_get_raw(key)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def load_seen() -> list:
    return [str(x) for x in _load_list(SEEN_KEY)]


def save_seen(ids: list):
    kv_set_raw(SEEN_KEY, json.dumps(ids[-SEEN_CAP:], ensure_ascii=False))


def merge_seen(seen: list, current_ids: list) -> list:
    s, sset = list(seen), set(seen)
    for i in current_ids:
        if i not in sset:
            s.append(i); sset.add(i)
    return s[-SEEN_CAP:]


# ── 商品取得 ──
def fetch_products() -> list:
    raw = kv_get_raw("profitable_products")
    if not raw:
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


# ── 投票(価格当て)の選択肢: eBay相場(円)を含む4つの価格帯 ──
def poll_options(avg) -> list:
    try:
        avg = int(avg)
    except (TypeError, ValueError):
        avg = 0
    if avg <= 0:
        return ["〜5千円", "5千〜1万円", "1万〜3万円", "3万円〜"]
    if avg < 5000:
        e = [3000, 6000, 10000]
    elif avg < 10000:
        e = [5000, 10000, 20000]
    elif avg < 30000:
        e = [10000, 20000, 40000]
    elif avg < 80000:
        e = [20000, 40000, 80000]
    else:
        e = [50000, 100000, 200000]

    def m(v):
        return f"{v // 10000}万円" if v >= 10000 else f"{v // 1000}千円"

    return [f"〜{m(e[0])}", f"{m(e[0])}〜{m(e[1])}", f"{m(e[1])}〜{m(e[2])}", f"{m(e[2])}〜"]


# ── データカード画像のURL(/api/card)。botがこれを直アップする ──
def build_card_url(title: str, product: dict) -> str:
    src = product.get("source", {}).get("price", 0)
    return (f"{SITE_URL}/api/card?t={quote(title)}"
            f"&n={quote(str(product.get('title', ''))[:50])}"
            f"&r={src}&e={product.get('realAvgPrice', 0)}&p={product.get('realProfitRate', 0)}")


# ── ハッシュタグ: 基本0個(2026年のXはタグで伸びない)。たまに1個だけニッチタグ ──
TAG_POOLS = {
    "default": ["#eBay輸出", "#越境EC"],
    "recruit": ["#eBay輸出", "#副業"],
    "soba": ["#eBay輸出", "#物販"],
    "pitfall": ["#eBay輸出", "#輸出ビジネス"],
    "announce": ["#eBay輸出", "#輸出ラボ"],
}
TAG_PROBABILITY = 0.25


def pick_tags(kind: str) -> list:
    if random.random() < TAG_PROBABILITY:
        return [random.choice(TAG_POOLS.get(kind, TAG_POOLS["default"]))]
    return []


# 誘導先は公開ティーザーの「利益商品ランキング」(/ranking)。ここは無料で見られるので“無料”表現が正直に成立。
# 各商品の詳細・検索・自動出品は購読(30日無料お試し)で解放、という建て付けに揃える。
REPLY_LEADS = [
    "▼ 楽天→eBayの利益商品ランキング（毎日更新・無料で見れる）",
    "いま利益が出てる商品ランキング、無料で見れます →",
    "楽天→eBayの相場・利益が分かるツール（まずは30日無料でお試し）↓",
    "まずは利益商品ランキングを無料でチェック ↓",
]

HOWTO_TOPICS = [
    "国際郵便は2024年から内容品の英語電子申告が必須(国際郵便マイページで送り状)。手書きラベルは原則不可、という基礎",
    "eBayのカテゴリ選びでつまずかないコツ(タイトルを具体的にすると自動判定が通りやすい)",
    "英語タイトル・説明は身構えなくていい(定型＋商品名で十分。やり取りもテンプレで回る)という話",
    "手取りの考え方: 売値からeBay手数料13.25%+¥47・国内送料・楽天ポイント還元まで引いて初めて『実利』。粗利で判断しない",
    "発送できない物に注意(モバイルバッテリー/リチウム電池単体/香水/スプレー等は航空危険物で国際発送不可)。仕入れ前の確認が肝",
    "新規セラーは売上が一時保留・出品上限があるのは『正常』。これを知らずに不安になる人が多い、という基礎",
]

PITFALL_TOPICS = [
    "売れてから『これ国際郵便で送れない物だった』と気づくミス(電池/香水/スプレー等の航空危険物)。仕入れ前に発送可否を確認",
    "粗利は出てるのに実は薄利…手数料13.25%+¥47と国内送料・ポイント還元を入れ忘れる値付けのミス",
    "高く出して在庫を寝かせ続けるミス。早く回すなら相場(現行の最安〜中央値)に寄せる",
    "カテゴリ誤り/タイトルが曖昧で検索に埋もれるミス。具体的なタイトルにする",
    "無在庫で出してしまうミス(在庫を持つ前提・トラブルの元)。先に仕入れてから出す",
    "追跡番号の登録漏れで売上保留・未着クレームになるミス。発送後は必ず登録",
]


def cap_body(body: str, limit: int) -> str:
    if tw_len(body) <= limit:
        return body
    out = ""
    for ch in body:
        if tw_len(out + ch + "…") > limit:
            break
        out += ch
    return out.rstrip() + "…"


def _prod_lines(product: dict | None) -> str:
    if not product:
        return ""
    src = product.get("source", {}).get("price", 0)
    return (
        f"商品名: {product.get('title','')}\n"
        f"楽天仕入れ価格: {src:,}円\n"
        f"eBay想定売値(相場・現行の最安〜中央値ベース): {product.get('realAvgPrice',0):,}円\n"
        f"想定利益率: {product.get('realProfitRate',0)}%\n"
    )


# ── 柱(kind)別の生成指示 ──
def kind_brief(kind: str, product: dict | None, extra: str = "") -> str:
    B = {
        "soba": "テーマ=『今日の相場』(知識/エバーグリーン)。個別商品の宣伝でなく、この商品を題材に『なぜ海外で評価されるか/相場の読み方/需要が動く条件』を解説。商品名を消しても“相場の見方”として成立する知識に。売り込まない。",
        "pro": "読者=現役eBay輸出セラー。ピア目線で、リサーチ時短/実利(手数料・送料・ポイント還元まで引いた手取りで利益率順)/相場=現行の最安〜中央値、を“あるある”や軽い問いかけで。教える上から目線・初心者煽りはしない。専門用語OK。",
        "recruit": "読者=これから副業を始めたい初心者。『難しそう/英語が無理/怖い』を溶かす。まずは利益商品ランキングを無料でチェックできる・写真だけでほぼ自動出品で英語ほぼ不要・手取りで利益が分かる、を1〜2点だけ自然に。最後は“見に来て”でなく“まずはランキングを無料で見てみて”の温度感。専門用語は使わない。",
        "howto": f"テーマ=輸出の基礎ノウハウ(知識)。次の論点を1つ、初心者にやさしく解説: {extra}。商品の宣伝はしない。",
        "pitfall": f"テーマ=『輸出の落とし穴』(失敗回避の知識)。次の“やりがちなミス”を『ミス→なぜダメ→どう回避』の3段でコンパクトに: {extra}。共感を呼ぶ書き出しで。",
        "buildinpublic": f"テーマ=運営の“プロセスの数字”を等身大に共有(build in public)。次の事実だけ使う(収入額は出さない): {extra}。『どう考えてどう動いているか』を見せる。淡々と、でも人間味を。",
        "announce": "テーマ=新着の利益商品の速報告知（“こういう利益商品が見つかる”実例）。商品名・想定利益率・楽天仕入れ→eBay想定売値を短くテンポよく。“続きはランキングで無料チェック（本格利用は30日無料お試し）”の温度感で、『新着は定期更新、フォローを』に自然に繋ぐ。",
    }
    return B.get(kind, "")


def generate_body(kind: str, product: dict | None, ai_client, body_limit: int, extra: str = "") -> str | None:
    prod = _prod_lines(product)
    prod_block = ("【商品情報】\n" + prod) if prod else ""
    prompt = f"""{PERSONA}

X(Twitter)の投稿本文を1つ生成してください。

{prod_block}【この投稿の狙い】
{kind_brief(kind, product, extra)}

【エンゲージの工夫】
{ENGAGE}

【読みやすさ】
{READABILITY}

【絶対ルール】
- 本文のみ出力(前置き・「見出し:」等の注釈は不要)
- URL・ハッシュタグ・絵文字は含めない(必要な画像・タグ・URLはこちらで付けます)
- 本文はTwitterウェイト{body_limit}以内(日本語1字=2・英数字=1)
- 数字(利益率・価格)は上の商品情報のものを使い、利益率・相場は「想定/目安」とわかる書き方
- 毎回 書き出しと構成を変える

本文のみ出力してください。"""
    try:
        msg = ai_client.messages.create(model="claude-haiku-4-5", max_tokens=360,
                                         messages=[{"role": "user", "content": prompt}])
        return _URL_RE.sub("", msg.content[0].text.strip()).strip()
    except Exception as e:
        print(f"  AI生成エラー({kind}): {e}")
        return None


# ── 投票ポストの本文(eBay相場・利益率は伏せる=投票の答えになるため) ──
def generate_poll_body(product: dict, ai_client, body_limit: int) -> str | None:
    src = product.get("source", {}).get("price", 0)
    prompt = f"""{PERSONA}

X(Twitter)の「投票ポスト」の本文を1つ生成してください(投票の選択肢は別で付けます)。

商品名: {product.get('title', '')}
楽天仕入れ価格: {src:,}円

【狙い】この商品が「eBay(海外)でいくらで売れそうか」を読者に当ててもらう投票。楽天の仕入れ値をヒントに『海外だといくらだと思う?』と当てたくなる導線にする。答え合わせは後日する、と一言添えてよい。
【厳守】eBayの想定売値・利益率・具体的な売値の数字は絶対に書かない(投票の答えになるため)。

【読みやすさ】
{READABILITY}

【ルール】
- 本文のみ出力(前置き不要)
- URL・ハッシュタグ・絵文字は含めない
- 本文はTwitterウェイト{body_limit}以内(日本語1字=2)

本文のみ出力してください。"""
    try:
        msg = ai_client.messages.create(model="claude-haiku-4-5", max_tokens=300,
                                        messages=[{"role": "user", "content": prompt}])
        return _URL_RE.sub("", msg.content[0].text.strip()).strip()
    except Exception as e:
        print(f"  AI生成エラー(poll): {e}")
        return None


# ── 画像をXへネイティブ直アップ(失敗時は画像なしで続行) ──
def upscale_image(url: str) -> str:
    if not url:
        return ""
    if "thumbnail.image.rakuten.co.jp/@0_mall/" in url:
        return url.replace("thumbnail.image.rakuten.co.jp/@0_mall/", "image.rakuten.co.jp/").split("?")[0]
    return re.sub(r'_ex=\d+x\d+', '_ex=600x600', url)


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


# ── 頻度ゲート ──
def frequency_gate(now: datetime, log: list) -> tuple[bool, str]:
    today = now.strftime("%Y-%m-%d")
    times = [float(e["t"]) for e in log if isinstance(e, dict) and "t" in e]
    today_count = sum(1 for t in times if datetime.fromtimestamp(t, JST).strftime("%Y-%m-%d") == today)
    last_ts = max(times) if times else 0.0
    gap_min = (now.timestamp() - last_ts) / 60 if last_ts else 1e9
    if now.hour not in PEAK_HOURS_JST:
        return False, f"ピーク時間外(JST {now.hour}時)"
    if today_count >= DAILY_CAP:
        return False, f"本日の上限({DAILY_CAP}本)に到達"
    if gap_min < MIN_GAP_MIN:
        return False, f"前回から{gap_min:.0f}分(<{MIN_GAP_MIN}分)"
    return True, f"OK(本日{today_count}本/{DAILY_CAP}・前回{gap_min:.0f}分前)"


def _count_today(log: list, kind: str, now: datetime) -> int:
    today = now.strftime("%Y-%m-%d")
    return sum(1 for e in log if isinstance(e, dict) and e.get("k") == kind
               and datetime.fromtimestamp(float(e["t"]), JST).strftime("%Y-%m-%d") == today)


# ── 柱の選択(価値:宣伝=8:2を機械的に担保＋シリーズ枠予約) ──
def choose_kind(now: datetime, log: list, has_new: bool) -> str:
    if has_new and _count_today(log, "announce", now) < ANNOUNCE_CAP:
        return "announce"  # 直接宣伝は1日2本まで(=8:2)。新着の速報性を優先
    if now.hour in MORNING_HOURS and _count_today(log, "soba", now) == 0:
        return "soba"      # 朝枠は『今日の相場』を予約
    if now.weekday() == PITFALL_WEEKDAY and _count_today(log, "pitfall", now) == 0:
        return "pitfall"   # 木曜は『輸出の落とし穴』
    if now.weekday() == BUILDINPUBLIC_WEEKDAY and _count_today(log, "buildinpublic", now) == 0:
        return "buildinpublic"  # 月曜は運営の数字
    # 残りは価値の柱を加重ランダム(直近と同じは避ける)
    last = kv_get_raw(LASTKIND_KEY) or ""
    weighted = ["pro", "pro", "recruit", "recruit", "howto", "soba", "poll", "poll"]
    pool = [k for k in weighted if k != last] or weighted
    return random.choice(pool)


# ── 投票の答え合わせ(期限が来たもの)を自己リプで投稿。頻度ゲートとは独立に処理 ──
def reveal_pending_polls(now: datetime, client) -> None:
    pend = _load_list(POLL_PENDING_KEY)
    if not pend:
        return
    keep, revealed = [], 0
    for e in pend:
        if not isinstance(e, dict) or "id" not in e:
            continue
        try:
            age_h = (now.timestamp() - float(e.get("t", 0))) / 3600
        except Exception:
            age_h = 999
        if revealed == 0 and age_h >= 20:
            try:
                txt = (f"答え合わせ：eBayの想定売値は約{int(e.get('e', 0)):,}円"
                       f"（現行の最安〜中央値ベース・あくまで想定）。"
                       f"楽天{int(e.get('r', 0)):,}円→想定利益率{e.get('p', 0)}%。当たってましたか？")
                client.create_tweet(text=txt, in_reply_to_tweet_id=e["id"])
                print("  投票の答え合わせを投稿")
                revealed += 1
            except Exception as ex:
                print(f"  答え合わせ失敗: {ex}")
                keep.append(e)
        else:
            keep.append(e)
    if revealed:
        kv_set_raw(POLL_PENDING_KEY, json.dumps(keep[-20:]))


def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY 未設定 - スキップ"); sys.exit(0)

    ai_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    twitter_client = tweepy.Client(
        consumer_key=os.environ["TWITTER_API_KEY"], consumer_secret=os.environ["TWITTER_API_SECRET"],
        access_token=os.environ["TWITTER_ACCESS_TOKEN"], access_token_secret=os.environ["TWITTER_ACCESS_TOKEN_SECRET"],
    )
    api_v1 = None
    try:
        auth = tweepy.OAuth1UserHandler(
            os.environ["TWITTER_API_KEY"], os.environ["TWITTER_API_SECRET"],
            os.environ["TWITTER_ACCESS_TOKEN"], os.environ["TWITTER_ACCESS_TOKEN_SECRET"])
        api_v1 = tweepy.API(auth)
    except Exception as e:
        print(f"  v1.1 API初期化失敗(画像なしで続行): {e}")

    now = datetime.now(JST)
    print("輸出ラボ 自動投稿 開始")

    # 投票の答え合わせ(期限到来分)を先に処理(返信なので頻度ゲートとは独立)
    reveal_pending_polls(now, twitter_client)

    log = _load_list(LOG_KEY)
    ok, reason = frequency_gate(now, log)
    print(f"  頻度ゲート: {reason}")
    if not ok:
        print("  → 今回は投稿しない"); return

    products = fetch_products()
    if not products:
        print("商品なし - スキップ")
        send_alert_email("⚠️ 輸出ラボBot 商品データなし",
                         f"商品データがKVに無いため投稿をスキップ。refresh.yml を確認。\n{now.strftime('%Y-%m-%d %H:%M')} JST")
        return

    current_ids = [str(p["id"]) for p in products if p.get("id")]
    seen = load_seen()
    seen_set = set(seen)
    first_run = len(seen) == 0
    new_products = [p for p in products if str(p.get("id")) not in seen_set]
    has_new = (not first_run) and len(new_products) > 0
    if first_run:
        save_seen(current_ids)  # 初回は基準記録のみ(全件“新着”誤爆を防ぐ)

    kind = choose_kind(now, log, has_new)

    # 柱ごとの素材を準備
    product = None
    extra = ""
    image_url = ""        # ネイティブ直アップする画像(商品写真 or データカード)のURL
    add_url = False       # URLを自己リプに付けるか(announceのみ)
    mark_seen = False
    series_prefix = ""
    poll_opts = None      # 投票の選択肢(pollのみ)

    if kind == "announce":
        product = max(new_products, key=lambda p: p.get("realProfitRate", 0))
        image_url = product.get("imageUrl", ""); add_url = True; mark_seen = True
    elif kind == "soba":
        product = pick_product(products)
        n = kv_get_int(SOBA_N_KEY) + 1
        series_prefix = f"【今日の相場 #{n}】"
        image_url = build_card_url(f"今日の相場 #{n}", product)  # 相場データカード(保存される情報型)
    elif kind in ("pro", "recruit"):
        product = pick_product(products); image_url = product.get("imageUrl", "")
    elif kind == "poll":
        product = pick_product(products)
        poll_opts = poll_options(product.get("realAvgPrice", 0))
    elif kind == "howto":
        extra = random.choice(HOWTO_TOPICS)
    elif kind == "pitfall":
        n = kv_get_int(PITFALL_N_KEY) + 1
        series_prefix = f"【輸出の落とし穴 #{n}】"
        extra = random.choice(PITFALL_TOPICS)
    elif kind == "buildinpublic":
        rates = [p.get("realProfitRate", 0) for p in products]
        avg = round(sum(rates) / len(rates)) if rates else 0
        extra = (f"今このアプリが追跡している“利益率30%以上の利益商品”は約{len(products)}件、"
                 f"想定利益率の平均は約{avg}%。相場の自動判定の一致率は実測で約82%。"
                 f"危険物・国際発送不可の物はカタログから自動除外している。")

    tags = pick_tags(kind)
    tags_str = " ".join(tags)
    body_limit = MAX_CHARS - tw_len(tags_str) - tw_len(series_prefix) - 4
    print(f"  {now.strftime('%-H:%M')} / kind={kind} / 新着={len(new_products)} / poll={bool(poll_opts)} / 画像={'card' if kind == 'soba' else bool(image_url)} / URL={add_url} / tags={tags_str}")
    if product:
        print(f"  商品: {product['title'][:30]}")

    body = None
    for attempt in range(1, 4):
        b = generate_poll_body(product, ai_client, body_limit) if kind == "poll" \
            else generate_body(kind, product, ai_client, body_limit, extra)
        if b:
            body = cap_body(b, body_limit); break
    if not body:
        print("投稿文生成失敗 - スキップ"); return

    main_text = f"{series_prefix}{body}"
    if tags_str:
        main_text = f"{main_text}\n\n{tags_str}"

    time.sleep(random.randint(0, 90))  # 等間隔を避ける軽いジッター

    # 投票は画像と共存不可。画像枠(商品写真 or データカード)は poll 以外で使う。
    media_id = upload_image(api_v1, image_url) if (image_url and not poll_opts) else None

    print(f"\n投稿本文 ({tw_len(main_text)}w):\n{main_text}\n")
    tweet_id = None
    for attempt in range(1, 4):
        try:
            kwargs = {"text": main_text}
            if poll_opts:
                kwargs["poll_options"] = poll_opts
                kwargs["poll_duration_minutes"] = POLL_DURATION_MIN
            elif media_id:
                kwargs["media_ids"] = [media_id]
            resp = twitter_client.create_tweet(**kwargs)
            tweet_id = resp.data["id"]
            print(f"本投稿成功: ID={tweet_id}")
            break
        except tweepy.errors.TwitterServerError as e:
            print(f"サーバーエラー ({attempt}/3): {e}")
            if attempt < 3:
                time.sleep(10)
            else:
                raise
        except Exception as e:
            print(f"エラー: {type(e).__name__}: {e}"); raise
    if not tweet_id:
        return

    # announce のみ URL を自己リプに分離(リーチ最適化)
    if add_url and product:
        try:
            twitter_client.create_tweet(text=f"{random.choice(REPLY_LEADS)}\n{SITE_URL}",
                                        in_reply_to_tweet_id=tweet_id)
            print("自己リプ(URL)成功")
        except Exception as e:
            print(f"自己リプ失敗(本投稿は成功済み): {type(e).__name__}: {e}")

    # 投票は後日「答え合わせ」するため pending に積む
    if kind == "poll" and product:
        pend = _load_list(POLL_PENDING_KEY)
        pend.append({"id": str(tweet_id), "t": now.timestamp(),
                     "e": product.get("realAvgPrice", 0),
                     "r": product.get("source", {}).get("price", 0),
                     "p": product.get("realProfitRate", 0)})
        kv_set_raw(POLL_PENDING_KEY, json.dumps(pend[-20:]))

    # 状態更新
    log.append({"t": now.timestamp(), "k": kind})
    kv_set_raw(LOG_KEY, json.dumps(log[-200:]))
    kv_set_raw(LASTKIND_KEY, kind)
    if kind == "soba":
        kv_set_raw(SOBA_N_KEY, str(kv_get_int(SOBA_N_KEY) + 1))
    if kind == "pitfall":
        kv_set_raw(PITFALL_N_KEY, str(kv_get_int(PITFALL_N_KEY) + 1))
    if mark_seen:
        save_seen(merge_seen(seen, current_ids))
        print("  既出ID更新(新着検知の基準を更新)")


if __name__ == "__main__":
    main()
