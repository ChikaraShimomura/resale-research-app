"""
輸出ラボ 自動投稿 - 外部cronから workflow_dispatch でトリガー

サイト趣旨（2026-06-25ピボット）に合わせ「日本の中古→eBay輸出で純利益が出る“儲かる型番”リサーチ」を発信する。
データ源は中古カタログ KV `used_catalog`（型番・状態・想定売値=eBay落札中央値・純利益率/ROI）。
⚠️ 旧モデル（楽天新品 profitable_products）は使わない。公開コピーに楽天は出さない（アフィリ撤退・直リンク方針）。

コンテンツ設計(柱モデル): 価値:宣伝=8:2 を投稿数で機械的に担保する。
  柱(pillar):
    - soba         「今日の中古相場 #N」日次(朝枠予約) … 中古相場の読み解き(知識)
    - pro          現役eBay輸出セラー向けの中古特有の取りこぼし防止
    - recruit      副業初心者向け「普通の中古が海外でこの相場」の驚き＋できそう
    - howto        中古輸出の汎用ノウハウ(状態説明/真贋/着地コスト/危険物/カテゴリ)
    - pitfall      「中古輸出の落とし穴 #N」週次(木) … 失敗→なぜ→回避
    - buildinpublic 週次(月) … 運営のプロセス数字(型番件数/純利益率平均など・収入断定なし)
    - announce     新着の「利益が出る中古の型番」速報(=直接宣伝) 1日1本まで。唯一URLを自己リプに付ける枠。
    - poll         「この中古、海外でいくら?」価格当て(答え合わせで想定売値の目安だけ開示)
  → announce以外はURLを本文にも自己リプにも付けない(リーチ重視・誘導はプロフィール)。

⚠️ モート保護: 仕入れ先の店名・仕入れ値・仕入れURL・正確な型番・仕入れ元画像は“絶対に”公開しない（＝有料の核）。
   公開して良いのは ブランド/商品名/カテゴリ/状態ランク/想定利益率(目安)/想定売値(目安=eBay落札中央値) まで。

人格(ペルソナ)を全投稿に固定注入。リーチ最適化(本文URL回避/画像はデータカードを直アップ/低頻度/
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
SOBA_N_KEY = "tweet_soba_n"        # 「今日の中古相場」連番
PITFALL_N_KEY = "tweet_pitfall_n"  # 「中古輸出の落とし穴」連番
POLL_PENDING_KEY = "tweet_poll_pending"  # 投票の答え合わせ待ち [{id,t,e}, ...]
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
    "あなたは『輸出ラボ』運営者“本人”の人格で書く。30歳くらいのITコンサルタントで、"
    "日本の中古品（カメラ・ゲーム機・時計・オーディオなど）を自分でeBayに出して海外へ輸出している。"
    "口調は自然な標準語。友達に話すくらいの、ほどよく砕けた距離感(タメ口寄り)で書く。"
    "⚠️方言・関西弁は使わない（『〜やねん／〜やで／〜やろ』等のエセ関西弁は禁止）。わざとらしい言い回し・若者言葉の盛りすぎ(『ぶっちゃけ』等)も避け、等身大で素直に。"
    "⚠️仕入れ先の店名・仕入れ値・仕入れURL・正確な型番は“絶対に”書かない（そこはツールの価値なので明かさない）。"
    "話せるのは『どんな中古が海外で評価されるか／相場の見方／利益の考え方／状態の扱い』まで。"
    "ITコンサルなので要点はロジカルに整理する。ただし論文みたいに硬くならず、“生身の人間がXでつぶやく体温”を必ず残す"
    "（素直な実感・ちょっとした本音や感情の揺れ・一人称『自分は/正直/個人的に』の視点・小さな余談）。テンプレ感/宣伝くささはダサいので消す。"
    "絵文字は“かっこよく効かせて”使う（具体は別途【絵文字】指針。少なめに、ここぞで）。"
    "収入・利益額の断定や保証、『必ず/確実/誰でも◯円/簡単/即金/不労所得』は禁止(景表法・特商法)。利益や相場は必ず『想定・目安』とわかる書き方。"
)

# ── 共通: 末尾の問いかけ/保存CTA(返信・ブックマークを狙う) ──
ENGAGE = (
    "末尾に『読み手が次に取る行動』を、はっきり1つ促すCTAを必ず入れる（押しは強めでOK。ただし誇大・命令の連打はしない）。"
    "例:『新着は毎日更新。見逃さないようにフォローを』『プロフィールのリンクから、いま純利益が出てる中古の型番を無料でチェックできる』『まずは家やリサイクルショップにある中古の相場を調べてみて』。"
    "行動で得られるもの（儲かる中古の型番が分かる／取りこぼしが減る 等）を一言添えて動機まで作る。言い切りで終わらせず、続きを見たくなる余白も残す。"
)

# ── 共通: 読みやすさ(改行・句読点を「適度に」入れる。多すぎは逆効果なので慎重に) ──
READABILITY = (
    "読みやすさ重要。文には句読点(、。)をきちんと打ち、声に出して読めるテンポにする。"
    "話題の切れ目で改行し、2〜3行ごとの短いまとまりに分ける。"
    "ただしやり過ぎ厳禁: 1投稿の改行は多くても2〜3回まで。1行ずつのブツ切り・空行の連発・記号の盛りすぎはしない。"
    "改行や句読点を入れても、ラフでカジュアルな話し言葉のテンポは保つ。"
)

# ── 共通: 人っぽさ(体温のある文章)＋絵文字を“かっこよく効かせる”。機械的・宣伝くさ・絵文字の乱用は全部ダサいので避ける ──
HUMAN_EMOJI = (
    "【人っぽさ】いちばん大事。テンプレ感・宣伝くささ・優等生の解説口調を消して、"
    "“生身の人間が思わずXでつぶやいた”体温を出す。自分の素直な実感や小さな驚き・ちょっとした本音を一人称で混ぜる"
    "（例『これ地味にすごいと思ってて』『正直、最初は半信半疑だった』『自分も昔これで失敗した』）。"
    "完璧に整えすぎず、話し言葉の自然なリズム・間で。ただし嘘・誇大・断定はしない（数字は想定/目安）。\n"
    "【絵文字】“かっこよく効かせる”。全体で1〜3個だけ、要点や区切り・感情の乗る所に、内容に合うものを選んで置く"
    "（例 📦発送 ✈️🌏海外 💰利益 📈相場 🔍リサーチ 👀注目 ⌚時計 📷カメラ 🎮ゲーム 🎧オーディオ ✅ポイント ⚠️注意 🔥激アツ 💡コツ）。"
    "⚠️全行に絵文字／連打／意味の薄い装飾（✨🥺💕の乱用）はダサいので絶対にしない。少なめで“ここぞ”に置くのがいちばんかっこいい。"
)

# ── 共通: 検索からも見つかるよう核キーワードを“自然に”入れる(X検索は本文テキストが対象) ──
DISCOVERY = (
    "Xの検索からも見つかるように、核となる言葉を本文に自然に入れる: 『eBay』と『輸出』は文脈に合う限り必ず入れる(この海外輸出/物販の話だと一目で分かるように)。"
    "さらに話題に合えば『中古』『中古せどり』『せどり』『越境EC』など“よく検索される言葉”を1つだけ自然に織り込む。"
    "ただしキーワードの羅列・不自然な詰め込みは絶対にしない(読み手にもアルゴリズムにも嫌われる)。あくまで普通の文章の流れの中で。"
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


def kv_hgetall(key: str) -> dict:
    # Upstash REST: /hgetall/{key} → {"result":[field1,val1,field2,val2,...]} を dict に畳む。
    kv_url, kv_token = _kv_env()
    if not kv_url or not kv_token:
        return {}
    try:
        resp = requests.get(f"{kv_url}/hgetall/{key}", headers={"Authorization": f"Bearer {kv_token}"}, timeout=10)
        arr = resp.json().get("result") or []
        if not isinstance(arr, list):
            return {}
        return {arr[i]: arr[i + 1] for i in range(0, len(arr) - 1, 2)}
    except Exception as e:
        print(f"  KV hgetall エラー({key}): {e}")
        return {}


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


# ── 状態ランクの表示（app/lib/usedCatalog.ts conditionLabel と揃える） ──
def used_condition_label(c) -> str:
    raw = (c or "")
    up = raw.upper()
    if re.search(r'JUNK|ジャンク', up):
        return "ジャンク(動作未確認)"
    if re.search(r'新品|未使用', raw):
        return "新品同様"
    m = re.search(r'(?:中古)?\s*([NSABCD])\b', up)
    rank = m.group(1) if m else ""
    return {
        "N": "新品同様", "S": "ほぼ新品", "A": "目立つ傷なし",
        "B": "普通の使用感", "C": "傷・使用感あり", "D": "難あり",
    }.get(rank, "中古")


# ── 中古カタログ取得（KV used_catalog）。配信ゲートは getUsedCatalog と同等＝確定品/売切除外/ROI≥10% ──
# ⚠️ 2026-07-01 ユーザー判断：Xの投稿カードは「生データ」フル版に変更＝仕入れ値・型番・実物画像も“カード画像”に載せる方針
#    （Askで「画像1どおりフル公開」を選択・モート露出を承知）。本文テキスト側は従来どおり伏せる（_prod_lines/PERSONA）。
def fetch_products() -> list:
    raw = kv_get_raw("used_catalog")
    if not raw:
        return []
    try:
        arr = json.loads(raw)
    except Exception as e:
        print(f"  中古カタログ パースエラー: {e}")
        return []
    if not isinstance(arr, list):
        return []
    status = kv_hgetall("used_source_status")  # 仕入れ元が売切/削除と判定された品（隠す）

    def sold_out(pid: str) -> bool:
        f = status.get(str(pid))
        if isinstance(f, str):
            try:
                f = json.loads(f)
            except Exception:
                return False
        st = f.get("status") if isinstance(f, dict) else None
        return st in ("soldout", "dead")

    out = []
    for x in arr:
        if not isinstance(x, dict):
            continue
        buy = x.get("buyJpy") or 0
        profit = x.get("profitJpy")
        if not isinstance(profit, (int, float)) or buy <= 0:
            continue
        if profit / buy < 0.10:                 # ROI<10%は配信ゲートで除外
            continue
        if x.get("ebayConfirmed") is not True:  # 確定品(同一型番でeBay実落札を照合済)のみ＝サイト既定
            continue
        pid = str(x.get("id") or x.get("modelKey") or "")
        if not pid or sold_out(pid):
            continue
        comp = x.get("ebayActiveCount")
        out.append({
            "id": pid,
            "title": (x.get("name") or x.get("modelKey") or "").strip(),
            "brand": (x.get("brand") or "").strip(),
            "cat": (x.get("cat") or "").strip(),
            "code": (x.get("code") or "").strip(),              # 型番（フル公開カード用）
            "conditionLabel": used_condition_label(x.get("condition")),
            "realProfitRate": round(profit / buy * 100),        # 想定純利益率(ROI・目安)
            "realAvgPrice": int(x.get("ebayMedianJpy") or 0),   # eBay落札中央値(想定売値・目安)
            "buyJpy": int(buy),                                 # 仕入れ値（フル公開カード用）
            "netJpy": int(profit),                              # 純利益額
            "soldCount": x.get("soldCount") or 0,               # 直近の落札件数(実需シグナル)
            "compCount": int(comp) if isinstance(comp, (int, float)) else None,  # eBay競合数(現在出品総数)
            "imageUrl": (x.get("imageUrl") or "").strip(),      # 実物画像（フル公開カード用）
        })
    out.sort(key=lambda p: p["realProfitRate"], reverse=True)
    return out


def pick_product(products: list):
    if not products:
        return None
    top = sorted(products, key=lambda p: p.get("realProfitRate", 0), reverse=True)[:20]
    return random.choice(top)


# ── 投票(価格当て)の選択肢: eBay想定売値(円)を含む4つの価格帯 ──
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


# ── データカード画像のURL(/api/card?mode=full)。botがこれを直アップする ──
# ⚠️ 2026-07-01 ユーザー判断で「生データ」フル版に変更＝仕入れ値・型番・実物画像・純益額・競合数まで“カード画像”に載せる。
#    サイトの商品カード(画像1)に寄せる。本文テキストは従来どおりモート非公開（画像だけがフルデータ）。
def build_card_url(title: str, product: dict) -> str:
    brand = str(product.get("brand", "")).strip()
    nm = str(product.get("title", "")).strip()
    name = f"{brand} {nm}".strip()[:50]
    parts = [
        f"{SITE_URL}/api/card?mode=full",
        f"t={quote(title)}",
        f"n={quote(name)}",
        f"c={quote(str(product.get('conditionLabel', '')))}",
        f"g={quote(str(product.get('cat', '')))}",
        f"code={quote(str(product.get('code', '')))}",
        f"r={product.get('buyJpy', 0)}",
        f"e={product.get('realAvgPrice', 0)}",
        f"p={product.get('realProfitRate', 0)}",
        f"net={product.get('netJpy', 0)}",
        f"sold={product.get('soldCount', 0) or 0}",
    ]
    comp = product.get("compCount")
    if isinstance(comp, (int, float)) and comp > 0:
        parts.append(f"comp={int(comp)}")
    img = str(product.get("imageUrl", "")).strip()
    if img:
        parts.append(f"img={quote(img, safe='')}")
    return "&".join(parts)


# ── ハッシュタグ: 基本0個(2026年のXはタグで伸びない)。たまに1個だけニッチタグ ──
TAG_POOLS = {
    "default": ["#eBay輸出", "#越境EC"],
    "recruit": ["#eBay輸出", "#中古せどり"],
    "soba": ["#eBay輸出", "#中古せどり"],
    "pitfall": ["#eBay輸出", "#輸出ビジネス"],
    "announce": ["#eBay輸出", "#輸出ラボ"],
}
TAG_PROBABILITY = 0.4  # 検索の入口を少し増やす(最大1個のまま・詰め込みはしない)。本文の核ワード(DISCOVERY)が主の対策。


def pick_tags(kind: str) -> list:
    if random.random() < TAG_PROBABILITY:
        return [random.choice(TAG_POOLS.get(kind, TAG_POOLS["default"]))]
    return []


# 誘導先は公開ティーザーの「利益商品ランキング」(/ranking)。ここは無料で見られるので“無料”表現が正直に成立。
# 各型番の詳細(仕入れ先/仕入れ値)・検索は購読(30日無料お試し)で解放、という建て付けに揃える。
REPLY_LEADS = [
    "こういう“いま純利益が出てる中古の型番”、毎日更新で無料で見れます📈 ランキングはこちら↓",
    "日本の中古が海外でいくらになるか、無料でチェック🔍 利益が出る中古の型番ランキング（毎日更新）↓",
    "いま利益が出てる中古、無料で見れます👀 まずはここから↓",
    "本格的に探すなら30日無料でお試し。まずはランキングを無料で💰↓",
]

HOWTO_TOPICS = [
    "中古は“状態の説明”が命。eBayのコンディション(Pre-owned等)に加え、傷・使用感・付属品を正直に書くほど返品やクレームが減る、という基礎",
    "手取りの考え方: 売値からeBay手数料(約13.25%＋固定手数料)・国際送料・関税(DDP)・仕入れまで引いて初めて『純利益』。粗利で判断しない",
    "発送できない物に注意(モバイルバッテリー/リチウム電池単体/香水/スプレー等は航空危険物で国際発送不可)。中古でも仕入れ前の確認が肝",
    "eBayはブランド名・型番(MPN)を正確に入れるほど検索に出やすい。中古は“型番”で探されることが多い、という基礎",
    "国際郵便は内容品の英語電子申告が必須(国際郵便マイページで送り状)。手書きラベルは原則不可、という基礎",
    "ブランド時計やカメラは真贋が大事。確証が持てない物には手を出さない、状態と付属品は正直に、という基礎",
]

PITFALL_TOPICS = [
    "状態を良く書きすぎて返品になるミス。中古は“悪い点も正直に”書いた方が、結局クレームが減って得",
    "粗利は出てるのに実は薄利…eBay手数料・国際送料・関税(DDP)を入れ忘れる値付けのミス",
    "高く出して在庫を寝かせ続けるミス。早く回すなら、出品中の最安でなく直近の落札(売れた価格)の中央値に寄せる",
    "ブランド品の真贋を確かめずに仕入れるミス。確証のない高額ブランドには手を出さない",
    "売れてから『これ国際郵便で送れない物だった』と気づくミス(電池/香水/スプレー等の航空危険物)。仕入れ前に発送可否を確認",
    "追跡番号の登録漏れで売上保留・未着クレームになるミス。発送後は必ず登録",
]


def cap_body(body: str, limit: int) -> str:
    if tw_len(body) <= limit:
        return body
    # 制限内に収まる範囲をまず取る（…の余白は確保しない＝文末で切れれば…は付けない）。
    out = ""
    for ch in body:
        if tw_len(out + ch) > limit:
            break
        out += ch
    # 文中ブツ切り＋「…」は不格好なので、収まった範囲の最後の文末（。！？!?改行）で切って“完結した文”で終える。
    cut = max(out.rfind(c) for c in ("。", "！", "？", "!", "?", "\n"))
    if cut >= len(out) * 0.5:  # 文末が後半にある＝十分な本文が残る時だけ採用（短すぎ防止）
        return out[: cut + 1].rstrip()
    # 文末が見つからない（または早すぎる）時だけ従来どおり…で詰める
    out = ""
    for ch in body:
        if tw_len(out + ch + "…") > limit:
            break
        out += ch
    return out.rstrip() + "…"


def _prod_lines(product) -> str:
    if not product:
        return ""
    lines = f"商品名: {product.get('title', '')}\n"
    if product.get("brand"):
        lines += f"ブランド: {product.get('brand')}\n"
    if product.get("cat"):
        lines += f"ジャンル: {product.get('cat')}\n"
    if product.get("conditionLabel"):
        lines += f"状態ランク: {product.get('conditionLabel')}\n"
    lines += (
        f"eBay想定売値(海外の中古落札・中央値ベース): {product.get('realAvgPrice', 0):,}円\n"
        f"想定純利益率(ROI・目安): {product.get('realProfitRate', 0)}%\n"
        "※ 仕入れ先の店名・仕入れ値・仕入れURL・正確な型番は本文に書かない(伏せる)\n"
    )
    return lines


# ── 柱(kind)別の生成指示 ──
def kind_brief(kind: str, product, extra: str = "") -> str:
    B = {
        "soba": "テーマ=『今日の中古相場』(知識/エバーグリーン)。この中古品を題材に『なぜこの手の日本の中古が海外で評価されるか/相場の読み方(出品中の最安でなく“直近の落札=売れた価格の中央値”を見る)/状態ランクと値段の関係』を解説。商品名を消しても“中古相場の見方”として成立する知識に。仕入れ先・仕入れ値は明かさず、売り込まない。",
        "pro": "読者=現役eBay輸出セラー。狙い=【“取りこぼし防止”で『もっと取りこぼさず利益が出せるかも』という希望】。中古特有の“あるある取りこぼし”を1つ取り上げ、ピア目線で『分かるわ〜→こう防げる』に持っていく: "
                "・粗利で判断してeBay手数料(約13.25%＋固定)・国際送料・関税(DDP)を引き忘れ実は薄利→“純利益(ROI)順”で見る ／ "
                "・状態を良く書きすぎて返品→正直な状態説明で結局得 ／ "
                "・相場を高く付け過ぎて在庫を寝かせた→直近の落札中央値に寄せて早く回す ／ "
                "・危険物/国際発送不可を仕入れてから気づいた→事前に除外 ／ ・ブランド品の真贋を確かめず仕入れた。"
                "『あるある、と共感→こう防げる』の流れで。リサーチ時短(eBayの実落札と型番が一致した“確定品”だけ純利益順に一覧)も絡めてよい。教える上から目線・初心者煽りはしない。専門用語OK。数字・相場は想定/目安と分かる書き方。金額の約束はしない。",
        "recruit": "読者=これから副業を始めたい初心者。狙い=【“驚き＋自分にもできそう”という希望】。"
                "①驚き: 日本だと中古で手に入るこの手の物(ジャンル/状態)が、海外のeBayだと想定でこれくらいの相場になる、という“えっ”を作る(eBay想定売値・利益率は想定・目安と分かる書き方)。"
                "②できそう: 特別な物でなく“普通の中古”でいい・状態ランクで状態が分かる・型番で海外の相場を調べるだけ・日本にいながら完結、の中から1〜2点だけ自然に添えて『難しそう/自分には無理』を溶かす。"
                "⚠️仕入れ先の店名・仕入れ値は書かない。断定や金額の約束はしない。締めは行動をはっきり促す（例『まずは無料ランキングで“いま利益が出てる中古の型番”を見てみて』『新着を見逃さないようにフォローを』）。専門用語は使わない。",
        "howto": f"テーマ=中古輸出の基礎ノウハウ(知識)。次の論点を1つ、初心者にやさしく解説: {extra}。商品の宣伝はしない。",
        "pitfall": f"テーマ=『中古輸出の落とし穴』(失敗回避の知識)。次の“やりがちなミス”を『ミス→なぜダメ→どう回避』の3段でコンパクトに: {extra}。共感を呼ぶ書き出しで。",
        "buildinpublic": f"テーマ=運営の“プロセスの数字”を等身大に共有(build in public)。次の事実だけ使う(収入額は出さない): {extra}。『どう考えてどう動いているか』を見せる。淡々と、でも人間味を。",
        "announce": "テーマ=新着の“利益が出る中古の型番”の速報＝【“こんな身近な中古が海外でこの相場”の驚き】。ジャンル・状態ランク・eBay想定売値・想定純利益率を短くテンポよく出し、『えっ、これが？』という発見の驚きを主役にする(数字は想定/目安と分かる書き方)。⚠️仕入れ先・仕入れ値・正確な型番は書かない。“自分にもできそう”を一言だけ添えてよい(普通の中古でいい/状態ランクで分かる)。金額の約束・断定はしない。締めは『続きはランキングで無料チェック(本格利用は30日無料お試し)、新着は定期更新なのでフォローを』に自然に繋ぐ。",
    }
    return B.get(kind, "")


def generate_body(kind: str, product, ai_client, body_limit: int, extra: str = "") -> str | None:
    prod = _prod_lines(product)
    prod_block = ("【商品情報】\n" + prod) if prod else ""
    prompt = f"""{PERSONA}

X(Twitter)の投稿本文を1つ生成してください。

{prod_block}【この投稿の狙い】
{kind_brief(kind, product, extra)}

{HUMAN_EMOJI}

【エンゲージの工夫】
{ENGAGE}

【読みやすさ】
{READABILITY}

【検索で見つかるように(SEO)】
{DISCOVERY}

【絶対ルール】
- 本文のみ出力(前置き・「見出し:」等の注釈は不要)
- URL・ハッシュタグは本文に入れない(画像・タグ・URLはこちらで付けます)。絵文字は積極的に使ってOK(上の【絵文字】の指針で“効かせて”1〜3個)
- ⚠️仕入れ先の店名・仕入れ値・仕入れURL・正確な型番は絶対に書かない(伏せる)
- 本文はTwitterウェイト{body_limit}以内(日本語1字=2・絵文字=2・英数字=1)。必ずこの範囲に収め、最後は文の途中で切らず「。」や絵文字で言い切って終える(超過して途中で切れるのは厳禁)
- 数字(利益率・想定売値)は上の商品情報のものを使い、利益率・相場は「想定/目安」とわかる書き方
- 毎回 書き出しと構成を変える

本文のみ出力してください。"""
    try:
        msg = ai_client.messages.create(model="claude-haiku-4-5", max_tokens=360,
                                         messages=[{"role": "user", "content": prompt}])
        return _URL_RE.sub("", msg.content[0].text.strip()).strip()
    except Exception as e:
        print(f"  AI生成エラー({kind}): {e}")
        return None


# ── 投票ポストの本文(eBay想定売値・利益率は伏せる=投票の答えになるため) ──
def generate_poll_body(product: dict, ai_client, body_limit: int) -> str | None:
    hint = "\n".join(filter(None, [
        f"商品名: {product.get('title', '')}",
        f"ブランド: {product.get('brand')}" if product.get("brand") else "",
        f"ジャンル: {product.get('cat')}" if product.get("cat") else "",
        f"状態ランク: {product.get('conditionLabel')}" if product.get("conditionLabel") else "",
    ]))
    prompt = f"""{PERSONA}

X(Twitter)の「投票ポスト」の本文を1つ生成してください(投票の選択肢は別で付けます)。

{hint}

【狙い】この中古品が「eBay(海外)でいくらで売れそうか」を読者に当ててもらう投票。ジャンルや状態をヒントに『海外だといくらだと思う?』と当てたくなる導線にする。答え合わせは後日する、と一言添えてよい。
【厳守】eBayの想定売値・利益率・具体的な売値の数字は絶対に書かない(投票の答えになるため)。仕入れ先・仕入れ値・正確な型番も書かない。

{HUMAN_EMOJI}

【読みやすさ】
{READABILITY}

【ルール】
- 本文のみ出力(前置き不要)
- URL・ハッシュタグは含めない。絵文字は使ってOK(効かせて1〜2個)
- 本文はTwitterウェイト{body_limit}以内(日本語1字=2・絵文字=2)

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
    return url


def upload_image(api_v1, image_url: str):
    if api_v1 is None or not image_url:
        return None
    try:
        r = requests.get(upscale_image(image_url), timeout=15, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        ctype = r.headers.get("Content-Type", "").lower()
        ext = "png" if "png" in ctype else "gif" if "gif" in ctype else "webp" if "webp" in ctype else "jpg"
        media = api_v1.media_upload(filename=f"card.{ext}", file=BytesIO(r.content))
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


# ── 柱の選択(価値:宣伝=8:2を機械的に担保＋シリーズ枠予約)。中古カタログが無い時は知識柱だけで回す ──
def choose_kind(now: datetime, log: list, has_new: bool, has_products: bool) -> str:
    if has_products and has_new and _count_today(log, "announce", now) < ANNOUNCE_CAP:
        return "announce"  # 直接宣伝は1日1本まで(=8:2)。新着の速報性を優先
    if has_products and now.hour in MORNING_HOURS and _count_today(log, "soba", now) == 0:
        return "soba"      # 朝枠は『今日の中古相場』を予約
    if now.weekday() == PITFALL_WEEKDAY and _count_today(log, "pitfall", now) == 0:
        return "pitfall"   # 木曜は『中古輸出の落とし穴』(知識・商品不要)
    if has_products and now.weekday() == BUILDINPUBLIC_WEEKDAY and _count_today(log, "buildinpublic", now) == 0:
        return "buildinpublic"  # 月曜は運営の数字
    # 残りは加重ランダム(直近と同じは避ける)。注力2柱(pro=取りこぼし防止/recruit=驚き＋できそう)を厚めに。
    last = kv_get_raw(LASTKIND_KEY) or ""
    if has_products:
        weighted = ["pro", "pro", "pro", "recruit", "recruit", "recruit", "howto", "soba", "poll", "poll"]
    else:
        weighted = ["howto", "howto", "pitfall", "pro"]  # 商品データが無い時は商品不要の知識柱だけ
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
                txt = (f"答え合わせ🎯 海外(eBay)の想定売値は約{int(e.get('e', 0)):,}円"
                       f"（直近の落札中央値ベース・あくまで想定）。"
                       f"日本だと中古で手に入る物が、海外だとこの相場👀 当たってましたか？")
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
    # FORCE_POST=true（手動Run workflowのforce入力）＝頻度ゲート(ピーク時間/本数上限/間隔)を無視して必ず1本出す＝テスト用。
    force = os.environ.get("FORCE_POST") == "true"
    ok, reason = frequency_gate(now, log)
    print(f"  頻度ゲート: {reason}{'（FORCE_POSTで無視）' if force else ''}")
    if not ok and not force:
        print("  → 今回は投稿しない"); return

    # 中古カタログ（無くても知識柱で投稿を続ける＝供給状況は別途 liveness 監視に任せる）
    products = fetch_products()
    has_products = len(products) > 0
    current_ids = [str(p["id"]) for p in products if p.get("id")]
    seen = load_seen()
    seen_set = set(seen)
    first_run = has_products and len(seen) == 0
    new_products = [p for p in products if str(p.get("id")) not in seen_set] if has_products else []
    has_new = has_products and (not first_run) and len(new_products) > 0
    if first_run:
        save_seen(current_ids)  # 初回は基準記録のみ(全件“新着”誤爆を防ぐ)

    kind = choose_kind(now, log, has_new, has_products)

    # 柱ごとの素材を準備
    product = None
    extra = ""
    image_url = ""        # ネイティブ直アップする画像(中古データカード)のURL
    add_url = False       # URLを自己リプに付けるか(announceのみ)
    mark_seen = False
    series_prefix = ""
    poll_opts = None      # 投票の選択肢(pollのみ)

    if kind == "announce":
        product = max(new_products, key=lambda p: p.get("realProfitRate", 0))
        image_url = build_card_url("新着・利益が出る中古", product); add_url = True; mark_seen = True
    elif kind == "soba":
        product = pick_product(products)
        n = kv_get_int(SOBA_N_KEY) + 1
        series_prefix = f"【今日の中古相場 #{n}】"
        image_url = build_card_url(f"今日の中古相場 #{n}", product)
    elif kind == "recruit":
        product = pick_product(products)
        if product:
            image_url = build_card_url("日本の中古が、海外だと", product)
    elif kind == "pro":
        product = pick_product(products) if has_products else None
        if product:
            image_url = build_card_url("中古せどりの相場", product)
    elif kind == "poll":
        product = pick_product(products)
        poll_opts = poll_options(product.get("realAvgPrice", 0))
    elif kind == "howto":
        extra = random.choice(HOWTO_TOPICS)
    elif kind == "pitfall":
        n = kv_get_int(PITFALL_N_KEY) + 1
        series_prefix = f"【中古輸出の落とし穴 #{n}】"
        extra = random.choice(PITFALL_TOPICS)
    elif kind == "buildinpublic":
        rates = [p.get("realProfitRate", 0) for p in products]
        avg = round(sum(rates) / len(rates)) if rates else 0
        extra = (f"今このアプリが追跡している“純利益が出る中古の型番”は約{len(products)}件、"
                 f"想定の純利益率(ROI)の平均は約{avg}%。eBayの実際の落札相場と型番が一致した“確定品”だけを載せている。"
                 f"危険物・国際発送不可の物はカタログから自動除外している。")

    tags = pick_tags(kind)
    tags_str = " ".join(tags)
    body_limit = MAX_CHARS - tw_len(tags_str) - tw_len(series_prefix) - 4
    print(f"  {now.strftime('%-H:%M')} / kind={kind} / 中古={len(products)} / 新着={len(new_products)} / poll={bool(poll_opts)} / 画像={bool(image_url)} / URL={add_url} / tags={tags_str}")
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

    # 投票は画像と共存不可。画像枠(中古データカード)は poll 以外で使う。
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

    # 投票は後日「答え合わせ」するため pending に積む(想定売値の目安だけ後で開示・仕入れ値/利益率は出さない)
    if kind == "poll" and product:
        pend = _load_list(POLL_PENDING_KEY)
        pend.append({"id": str(tweet_id), "t": now.timestamp(), "e": product.get("realAvgPrice", 0)})
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
