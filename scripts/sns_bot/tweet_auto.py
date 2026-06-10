"""
輸出ラボ 自動投稿 - 毎時15分（24本/日）

6スタイルローテーション:
  hour % 6
  0 → 公式配信スタイル（eBay輸出・副業ノウハウ断言系）
  1 → 個人コメント（仕入れ実績・楽天せどり）
  2 → 論争スタイル（副業界あるある議論・炎上ぎりぎり）
  3 → 公式配信スタイル
  4 → 個人コメント（eBay価格差・利益実績）
  5 → 論争スタイル

文字数管理:
  URLとハッシュタグはコード側で付加。Claudeには本文のみ生成させる。
"""
import os
import re
import sys
import tweepy
import requests
import anthropic
import xml.etree.ElementTree as ET
from datetime import datetime
import pytz

JST = pytz.timezone('Asia/Tokyo')
SITE_URL = "https://www.yushutsu-fukugyo.com"
HASHTAGS = "#輸出副業 #eBay転売 #楽天せどり"
MAX_CHARS = 280
_URL_RE = re.compile(r'https?://\S+')

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
}

# ── 時間帯別テーマ ────────────────────────────────────────────
HOUR_THEMES = [
    (5,  8,  "朝活タイム",       "今日の仕入れ展望・昨夜のeBay落札動向・朝イチ確認",   "朝活副業家向け"),
    (8,  12, "仕入れゴールデンタイム", "楽天ポイント還元・仕入れ狙い目・eBay急騰商品",    "速報ランキング形式"),
    (12, 15, "昼の輸出リサーチ",  "午前の落札実績・狙い目ジャンル・eBay価格更新情報",    "中間レポート形式"),
    (15, 18, "夕方まとめ",        "今日の仕入れ振り返り・利益が出やすいカテゴリ・明日の展望", "分析考察形式"),
    (18, 24, "夜の副業学習",      "輸出副業の始め方・楽天→eBayの仕組み・利益計算・初心者向け", "教育啓発形式"),
    (0,  5,  "深夜eBay市場",      "米国・欧州バイヤーの動向・深夜の落札ラッシュ・ドル円影響", "海外市場連動形式"),
]

# ── 輸出ラボの機能リスト ──────────────────────────────────────
APP_FEATURES = [
    "楽天商品とeBayの落札価格を自動で比較して利益が出る商品を見つけられる",
    "eBayの平均落札価格をリアルタイムで確認して適正な仕入れ価格を判断できる",
    "利益率・利益額を自動計算してeBay手数料・送料込みの純利益がすぐわかる",
    "楽天ポイント還元も含めた実質的な仕入れコストを計算できる",
    "ポケカ・ガンプラ・腕時計など人気ジャンルの利益商品を毎日自動でリサーチしてくれる",
    "商品の落札実績件数と信頼スコアで仕入れリスクを判断できる",
    "eBayの平均販売日数がわかるので資金回転率を計画しやすい",
    "楽天で仕入れてeBayで売る輸出副業を、リサーチ時間ゼロで始められる",
]

# ── 論争スタイル用トピック ────────────────────────────────────
CONTROVERSIAL_TOPICS = [
    "「副業するなら投資より転売の方が稼げる」という意見",
    "「楽天せどりはもう稼げない時代が終わった」という声",
    "「eBay輸出は英語が話せないと無理」という思い込み",
    "「転売は社会悪だからやるべきではない」という批判",
    "「副業は本業の給料が上がらない人がやるもの」という偏見",
    "「輸出転売は関税・規制が厳しくてリスクが高すぎる」という過大評価",
    "「ポケカ・ガンプラ転売は在庫リスクが高くておすすめできない」という意見",
    "「せどりは単純作業で誰でもできる」という誤解",
    "「副業で月10万稼ぐより本業に集中すべき」という考え方",
    "「eBayは中国セラーに価格競争で勝てないから日本人には向かない」という思い込み",
    "「楽天ポイント還元目的の転売はグレーゾーンだ」という議論",
    "「転売で稼いだお金は不労所得ではなく普通の労働収入だ」という主張",
    "「副業解禁が進んでも会社員はせどりをやるべきではない」という風潮",
    "「輸出副業で月30万以上稼いでいる人は嘘をついている」という疑念",
    "「AI・ツールに頼った転売リサーチは長続きしない」という批判",
]


def get_hour_theme(hour: int) -> dict:
    for start, end, label, focus, fmt in HOUR_THEMES:
        if start <= hour < end:
            return {"label": label, "focus": focus, "format": fmt}
    return {"label": "輸出副業情報", "focus": "楽天→eBay輸出・副業・せどり", "format": "自由形式"}


def get_post_style(hour: int) -> dict:
    """6スタイルローテーション"""
    index = hour % 6
    return [
        {"name": "official",        "label": "公式配信スタイル"},
        {"name": "personal_buy",    "label": "個人コメント（仕入れ・楽天）"},
        {"name": "debate",          "label": "論争スタイル"},
        {"name": "official",        "label": "公式配信スタイル"},
        {"name": "personal_sell",   "label": "個人コメント（eBay実績）"},
        {"name": "debate",          "label": "論争スタイル"},
    ][index]


# ── フッター構築 ────────────────────────────────────────────
def build_footer(theme: dict) -> str:
    return f"\n{SITE_URL}\n{HASHTAGS}"


def get_body_budget(footer: str) -> int:
    return MAX_CHARS - tw_len(footer) - 5


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
            0xFE30 <= cp <= 0xFE6F, 0xFF00 <= cp <= 0xFFEF,
        ]) or cp > 0xFFFF:
            count += 2
        else:
            count += 1
    return count


# ── RSS取得 ──────────────────────────────────────────────────
def _fetch_rss_titles(url: str, limit: int = 3) -> list:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        titles = []
        for item in root.findall(".//item")[:limit]:
            t = item.find("title")
            if t is not None and t.text:
                title = t.text.split(" - ")[0].strip()
                title = re.sub(r"【.*?】|「.*?」", "", title).strip()
                if title and len(title) > 5:
                    titles.append(title)
        return titles
    except Exception:
        return []


def _gnews(query: str) -> str:
    return (
        "https://news.google.com/rss/search"
        "?q=" + query.replace(" ", "+") + "&hl=ja&gl=JP&ceid=JP:ja"
    )


# ── ニュース収集 ──────────────────────────────────────────────
def gather_export_news() -> list:
    """輸出副業・eBay・楽天関連ニュース収集"""
    queries = [
        "eBay 日本 輸出 転売 人気", "楽天 せどり 仕入れ ポイント還元",
        "ポケモンカード BOX 高騰 転売", "ガンプラ 海外 人気 価格",
        "日本製品 海外 需要 人気 ブランド", "円安 輸出 副業 メリット",
        "副業 転売 月収 稼ぐ 実績", "楽天市場 セール ポイント 攻略",
        "eBay 落札 日本 アニメ フィギュア", "海外 日本製品 需要 ブーム",
    ]
    seen, result = set(), []
    for q in queries:
        for t in _fetch_rss_titles(_gnews(q), 2):
            if t not in seen:
                seen.add(t)
                result.append(t)
    return result[:15]


def gather_buy_buzz() -> list:
    """仕入れ・楽天せどり関連のバズ収集"""
    queries = [
        "楽天 せどり 仕入れ 実績 体験", "ポイント転売 楽天 攻略 正直",
        "転売 仕入れ リサーチ ツール 使ってみた", "eBay 輸出 始めた きっかけ",
        "副業 転売 初月 利益 実感", "楽天スーパーセール 仕入れ タイミング",
        "ポケカ 仕入れ BOX 利益 実際", "ガンダム プラモ 海外 需要 体験",
    ]
    seen, result = set(), []
    for q in queries:
        for t in _fetch_rss_titles(_gnews(q), 2):
            if t not in seen:
                seen.add(t)
                result.append(t)
    return result[:15]


def gather_sell_buzz() -> list:
    """eBay販売・実績関連のバズ収集"""
    queries = [
        "eBay 販売 日本 実績 体験談", "輸出転売 月収 実績 公開",
        "eBay 日本語対応 始め方 初心者", "円安 eBay 利益 増えた 実感",
        "海外バイヤー 日本製品 反応 購入", "eBay 送料 梱包 コツ 実体験",
        "輸出副業 脱サラ 実現 体験", "eBay 高額落札 日本製品 驚いた",
    ]
    seen, result = set(), []
    for q in queries:
        for t in _fetch_rss_titles(_gnews(q), 2):
            if t not in seen:
                seen.add(t)
                result.append(t)
    return result[:15]


# ── プロンプト生成 ────────────────────────────────────────────
def _make_prompt_official(news, theme, date_str, features_text, body_budget):
    news_text = "\n".join("・" + n for n in news)
    jp_est = body_budget // 2
    return (
        "あなたは歯に衣着せない物言いで知られる副業・輸出転売メディアの論説編集長です。\n"
        "「業界の本音」「誰も言わない真実」を発信することで副業家から支持されています。\n"
        "今は" + date_str + "。テーマ: " + theme["label"] + "（" + theme["focus"] + "）\n\n"
        "━━ 今日のリアルタイム輸出副業トレンド ━━\n"
        + news_text + "\n\n"
        "━━ 【絶対厳守】過激・断言スタイルで書くこと ━━\n"
        "おとなしい・無難な投稿は厳禁。必ず以下を守ること:\n\n"
        "【冒頭は必ずこのどれかで始める（必須）】\n"
        "・「○○しないと副業で一生稼げない現実」\n"
        "・「9割の転売初心者が犯す致命的ミス」\n"
        "・「今すぐやめるべき○○な仕入れ方法」\n"
        "・「なぜ日本人はeBay輸出をやらないのか（衝撃）」\n"
        "・「知らないと一生損し続ける楽天せどりの真実」\n"
        "・「円安なのにeBay輸出してない人、マジで大丈夫？」\n"
        "・「○○円以下の仕入れは絶対やめろ」\n"
        "・「知ってる人と知らない人、副業収入に○万円の差」\n\n"
        "【必ず入れること】\n"
        "・具体的な数字（利益率・金額・日数）で現実を突きつける\n"
        "・「稼いでいる人 vs 稼げない人」の格差を強調\n"
        "・断言・言い切り（弱腰表現「〜かもしれません」は絶対NG）\n"
        "・ランキング（①②③）や「○○選」で保存率を上げる\n\n"
        "━━ 輸出ラボの機能を末尾に1文だけ自然に入れること ━━\n"
        "以下の中から最も自然に合う機能を1つ選んで「輸出ラボ」アプリ名と一緒に紹介（URLは不要）:\n"
        + features_text + "\n\n"
        "━━ 生成ルール（厳守） ━━\n"
        "1. 【本文のみ】生成する（URLもハッシュタグも絵文字も含めない）\n"
        "2. 本文Twitterウェイトを【" + str(body_budget) + "以内】に収める\n"
        "   日本語1文字=2、英数字=1 / 目安: 全角文字" + str(jp_est) + "文字以内\n"
        "3. 行数は最大6行（空行含む）\n"
        "4. 投稿文のみ出力（前置き・「投稿文:」などは一切不要）\n\n"
        "本文のみ出力してください。"
    )


def _make_prompt_personal_buy(buzz, news, theme, date_str, features_text, body_budget):
    buzz_text = "\n".join("・" + b for b in buzz)
    news_sub  = "\n".join("・" + n for n in news[:4])
    jp_est = body_budget // 2
    return (
        "あなたはフォロワー数3万人以上の人気輸出副業インフルエンサーです。\n"
        "楽天での仕入れからeBay輸出まで歯に衣着せぬ物言いで支持されており、特に【仕入れ・楽天活用】のノウハウで知られています。\n"
        "今は" + date_str + "。テーマ: " + theme["label"] + "\n\n"
        "━━ 今の転売・仕入れコミュニティで話題になっていること ━━\n"
        + buzz_text + "\n\n"
        "━━ 今日のトレンド（参考） ━━\n"
        + news_sub + "\n\n"
        "━━ 【絶対厳守】仕入れ・楽天について過激・挑発スタイルで書くこと ━━\n"
        "【冒頭は必ずこのどれかで始める（必須）】\n"
        "・「楽天ポイント還元なめてた、正直に言う」\n"
        "・「仕入れでやらかしてた頃の自分に言いたいこと」\n"
        "・「これ言っていいのかわからんけど正直に言う」\n"
        "・「9割の人が知らない楽天仕入れの真実」\n"
        "・「楽天せどりやらないやつの末路、見たくないな」\n"
        "・「eBayに出品してるのに楽天ポイント使ってない人、大丈夫？」\n\n"
        "【必ず入れること】\n"
        "・楽天仕入れ・ポイント還元・具体的な利益額に触れる\n"
        "・危機感・緊急性（「今すぐ」「手遅れになる前に」）\n"
        "・断言・言い切り\n\n"
        "━━ 輸出ラボの機能を末尾に1文だけ自然に入れること ━━\n"
        "以下の中から最も自然に合う機能を1つ選んで「輸出ラボ」アプリ名と一緒に口コミ感覚で紹介（URLは不要）:\n"
        + features_text + "\n\n"
        "━━ 生成ルール（厳守） ━━\n"
        "1. 【本文のみ】生成する（URLもハッシュタグも絵文字も含めない）\n"
        "2. 本文Twitterウェイトを【" + str(body_budget) + "以内】に収める\n"
        "   日本語1文字=2、英数字=1 / 目安: 全角文字" + str(jp_est) + "文字以内\n"
        "3. 行数は最大6行（空行含む）\n"
        "4. 投稿文のみ出力\n\n"
        "本文のみ出力してください。"
    )


def _make_prompt_personal_sell(buzz, news, theme, date_str, features_text, body_budget):
    buzz_text = "\n".join("・" + b for b in buzz)
    news_sub  = "\n".join("・" + n for n in news[:4])
    jp_est = body_budget // 2
    return (
        "あなたはフォロワー数3万人以上の人気輸出副業インフルエンサーです。\n"
        "eBay輸出の実績・稼ぎ方について歯に衣着せぬ物言いで支持されており、特に【eBay販売・利益実績】のノウハウで知られています。\n"
        "今は" + date_str + "。テーマ: " + theme["label"] + "\n\n"
        "━━ 今の輸出転売コミュニティで話題になっていること ━━\n"
        + buzz_text + "\n\n"
        "━━ 今日のトレンド（参考） ━━\n"
        + news_sub + "\n\n"
        "━━ 【絶対厳守】eBay実績について過激・挑発スタイルで書くこと ━━\n"
        "【冒頭は必ずこのどれかで始める（必須）】\n"
        "・「eBay輸出、正直なめてたわ（いい意味で）」\n"
        "・「円安なのにeBayやってない人、本当に大丈夫？」\n"
        "・「海外バイヤーが日本製品に払う金額、衝撃だった」\n"
        "・「9割の副業初心者が知らないeBayの真実」\n"
        "・「日本人がeBay輸出をやらない理由が本当にわからない」\n"
        "・「輸出副業しない人と始めた人、1年後の差がヤバすぎる」\n\n"
        "【必ず入れること】\n"
        "・eBay落札価格・利益率・具体的な数字に触れる\n"
        "・円安メリット・海外需要の高さを強調\n"
        "・断言・言い切り\n\n"
        "━━ 輸出ラボの機能を末尾に1文だけ自然に入れること ━━\n"
        "以下の中から最も自然に合う機能を1つ選んで「輸出ラボ」アプリ名と一緒に口コミ感覚で紹介（URLは不要）:\n"
        + features_text + "\n\n"
        "━━ 生成ルール（厳守） ━━\n"
        "1. 【本文のみ】生成する（URLもハッシュタグも絵文字も含めない）\n"
        "2. 本文Twitterウェイトを【" + str(body_budget) + "以内】に収める\n"
        "   日本語1文字=2、英数字=1 / 目安: 全角文字" + str(jp_est) + "文字以内\n"
        "3. 行数は最大6行（空行含む）\n"
        "4. 投稿文のみ出力\n\n"
        "本文のみ出力してください。"
    )


def _make_prompt_debate(news, now, features_text, body_budget):
    topic = CONTROVERSIAL_TOPICS[now.hour % len(CONTROVERSIAL_TOPICS)]
    news_sub = "\n".join("・" + n for n in news[:5])
    date_str = now.strftime("%-m月%-d日")
    jp_est = body_budget // 2
    return (
        "あなたはフォロワー数3万人以上の個人輸出副業家で、副業・転売界隈のあるある論争に積極的に参加することで知られています。\n"
        "今は" + date_str + "。\n\n"
        "━━ 今回論じるテーマ ━━\n"
        + topic + "\n\n"
        "━━ 今日のトレンド（参考） ━━\n"
        + news_sub + "\n\n"
        "━━ 【絶対厳守】賛否を呼ぶ論争投稿のルール ━━\n"
        "・賛成 or 反対、どちらか一方を明確に選んで言い切る（中立は厳禁）\n"
        "・「こういう意見よく見るけど正直に言う」的な切り口で入る\n"
        "・具体的な反論・体験で支持または批判する\n"
        "・「どっちが正しいかは人それぞれ」で絶対に終わらない\n"
        "・最後は読者が「賛成」「反対」「俺は違う」と反応したくなる締めで終わる\n\n"
        "【冒頭パターン例】\n"
        "・「○○って言う人よく見るけどさ、正直言わせてもらう」\n"
        "・「○○論、ずっと疑問に思ってた」\n"
        "・「みんなが信じてる○○、本当に正しいの？」\n\n"
        "【絶対NG】\n"
        "・中立まとめ・逃げ表現・当たり障りのない意見\n\n"
        "━━ 輸出ラボの機能を末尾に1文だけ自然に入れること ━━\n"
        "以下の中から最も自然に合う機能を1つ選んで「輸出ラボ」アプリ名と一緒に紹介（URLは不要）:\n"
        + features_text + "\n\n"
        "━━ 生成ルール（厳守） ━━\n"
        "1. 【本文のみ】生成する（URLもハッシュタグも絵文字も含めない）\n"
        "2. 本文Twitterウェイトを【" + str(body_budget) + "以内】に収める\n"
        "   日本語1文字=2、英数字=1 / 目安: 全角文字" + str(jp_est) + "文字以内\n"
        "3. 行数は最大6行（空行含む）\n"
        "4. 投稿文のみ出力\n\n"
        "本文のみ出力してください。"
    )


# ── Claude API で本文生成 ─────────────────────────────────────
def generate_body(news, buzz_buy, buzz_sell, theme, now, style_info, body_budget):
    date_str = now.strftime("%-m月%-d日 %-H時%-M分")
    features_text = "\n".join("  ・" + f for f in APP_FEATURES)
    style_name = style_info["name"]

    if style_name == "official":
        prompt = _make_prompt_official(news, theme, date_str, features_text, body_budget)
    elif style_name == "personal_buy":
        prompt = _make_prompt_personal_buy(buzz_buy, news, theme, date_str, features_text, body_budget)
    elif style_name == "personal_sell":
        prompt = _make_prompt_personal_sell(buzz_sell, news, theme, date_str, features_text, body_budget)
    else:  # debate
        prompt = _make_prompt_debate(news, now, features_text, body_budget)

    try:
        message = ai_client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}]
        )
        return message.content[0].text.strip()
    except Exception as e:
        print(f"AI生成エラー: {e}")
        return None


# ── クリーニング・トリム・バリデーション ─────────────────────
def clean_body(text: str) -> str:
    for p in [r"^(投稿文|ツイート|X投稿|以下|出力)[：:]\s*", r"^```[^\n]*\n", r"\n```$"]:
        text = re.sub(p, "", text, flags=re.MULTILINE).strip()
    text = re.sub(r"^[「」『』]", "", text).strip()
    text = _URL_RE.sub("", text).strip()
    lines = [l for l in text.split("\n") if not re.match(r"^#\S", l)]
    text = "\n".join(lines).strip()
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    # 絵文字除去
    text = re.sub(
        r"[\U0001F300-\U0001FAFF\U00002600-\U000027FF\U00002300-\U000023FF"
        r"\U0001F000-\U0001F02F\U0001F0A0-\U0001F0FF\U0001F900-\U0001F9FF"
        r"\U0000200D\U0000FE0F\U00002702-\U000027B0]+",
        "", text,
    ).strip()
    return text


def trim_body(body: str, budget: int) -> str:
    if tw_len(body) <= budget:
        return body
    lines = body.split("\n")
    while lines and tw_len("\n".join(lines)) > budget:
        for i in range(len(lines) - 1, -1, -1):
            if lines[i].strip():
                lines.pop(i)
                break
        else:
            lines.pop()
        while lines and not lines[-1].strip():
            lines.pop()
    return "\n".join(lines).strip()


def assemble_and_validate(body: str, footer: str) -> str | None:
    tweet = body + footer
    if SITE_URL not in tweet:
        print("  URL なし NG")
        return None
    length = tw_len(tweet)
    if length > MAX_CHARS:
        print(f"  {length}w NG（280超過）")
        return None
    return tweet


# ── メイン ────────────────────────────────────────────────────
def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY 未設定 - スキップ")
        sys.exit(0)

    global ai_client, twitter_client
    ai_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    twitter_client = tweepy.Client(
        consumer_key=os.environ["TWITTER_API_KEY"],
        consumer_secret=os.environ["TWITTER_API_SECRET"],
        access_token=os.environ["TWITTER_ACCESS_TOKEN"],
        access_token_secret=os.environ["TWITTER_ACCESS_TOKEN_SECRET"],
    )

    now        = datetime.now(JST)
    theme      = get_hour_theme(now.hour)
    style_info = get_post_style(now.hour)
    footer     = build_footer(theme)
    budget     = get_body_budget(footer)

    print(f"輸出ラボ 自動投稿 開始")
    print(f"  {now.strftime('%-H:%M')} / {theme['label']} / {style_info['label']}")
    print(f"  本文上限: {budget}w")

    news     = gather_export_news()
    buzz_buy  = gather_buy_buzz()
    buzz_sell = gather_sell_buzz()
    print(f"  ニュース: {len(news)}件 / 仕入れbuzz: {len(buzz_buy)}件 / 販売buzz: {len(buzz_sell)}件")

    if not news:
        print("ニュース取得失敗 - スキップ")
        return

    tweet = None
    for attempt in range(1, 4):
        print(f"  AI生成 {attempt}/3...")
        raw = generate_body(news, buzz_buy, buzz_sell, theme, now, style_info, budget)
        if not raw:
            continue
        body  = clean_body(raw)
        body  = trim_body(body, budget)
        tweet = assemble_and_validate(body, footer)
        if tweet:
            break

    if not tweet:
        print("3回失敗 - スキップ")
        return

    print(f"\n投稿内容 ({tw_len(tweet)}w):\n{tweet}\n")

    import time
    for post_attempt in range(1, 4):
        try:
            response = twitter_client.create_tweet(text=tweet)
            print(f"ツイート成功: ID={response.data['id']}")
            break
        except tweepy.errors.Forbidden as e:
            print(f"403 Forbidden: {e}")
            raise
        except tweepy.errors.TwitterServerError as e:
            print(f"Xサーバーエラー ({post_attempt}/3): {e} - 10秒後リトライ")
            if post_attempt < 3:
                time.sleep(10)
            else:
                raise
        except Exception as e:
            print(f"エラー: {type(e).__name__}: {e}")
            raise


if __name__ == "__main__":
    main()
