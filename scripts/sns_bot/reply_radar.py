"""
輸出ラボ Xリプ候補レーダー — 「今リプすべき投稿」を集めて運営者にメール通知する。

新規〜小規模アカの初速は『戦略的リプライ(自分の投稿でなく他者への価値リプ)』が律速。
ただし自動リプは品質低下・凍結リスクなので不可。このスクリプトは候補の収集・通知・下書きまで、
実際のリプ送信は必ず人手で行う(配信=bot / 会話=人 のハイブリッド)。

前提: Xの「読み取り(recent search)」が必要 = Basic以上 or 従量の読み取り権限。
      Free tierでは検索できないことがある(その場合はエラー内容をメール通知して終了)。
任意: TWITTER_SELF_USERNAME を設定すると自分の投稿を候補から除外する。
"""
import os
import sys
import json
from datetime import datetime, timezone
from urllib.parse import quote

import tweepy
import anthropic

# 同ディレクトリの tweet_auto からメール/KV＋人格/絵文字指針を再利用(DRY・投稿本文とリプの声を揃える)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tweet_auto import send_alert_email, kv_set_raw, _load_list, PERSONA, HUMAN_EMOJI  # noqa: E402

SEEN_KEY = "reply_radar_seen"   # 通知済みtweet id(重複通知を防ぐ)
SEEN_CAP = 400
MIN_FOLL = 300                  # 著者フォロワーの下限(小さすぎる相手は価値薄)
MAX_FOLL = 30000               # 上限(大きすぎると埋もれて気づかれない)。自分の2〜10倍帯を狙う目安
FRESH_HOURS = 3                # この時間内の投稿だけ(リプは鮮度が命)
MAX_CANDIDATES = 10
DRAFT_TOP = MAX_CANDIDATES      # 全候補に下書き案を生成(Haikuは安価。件数を変えても自動で全件に追従)
MAX_RESULTS = 40               # 1回の検索で取る件数(=読み取りコスト)。候補10件を出すにはフィルタ後の母数が要るため 10→40 に増量(その分コスト増)

SELF = os.environ.get("TWITTER_SELF_USERNAME", "").lstrip("@").lower()

# 日本語のeBay輸出/物販副業ニッチ。RT/リプ除外・日本語のみ。
QUERY = ('(eBay輸出 OR 越境EC OR 輸出転売 OR 物販副業 OR "eBay 出品" OR 海外転売 OR eBayせどり) '
         '-is:retweet -is:reply lang:ja')


def gen_draft(text: str, ai: anthropic.Anthropic) -> str:
    try:
        msg = ai.messages.create(
            model="claude-haiku-4-5", max_tokens=90,
            messages=[{"role": "user", "content": (
                f"{PERSONA}\n\n"
                "次のXの投稿に“一言そえるだけ”の短いリプライ下書きを1つ作る。相手の投稿が主役、こっちは軽く反応するだけ。\n"
                f"投稿:「{text[:280]}」\n\n"
                "【形】1文・改行なし・全角25字前後(長くても40字)。パッと送れる短さ＝テンポよく数を打つためのもの。\n"
                "【トーン】友達に軽く反応する感じでラフに・砕けた口調でOK(タメ口寄り・語尾もゆるく)。かしこまらない。素直な共感・相槌・軽いツッコミ、または短い質問ひとつ。\n"
                "【効果を保つ】その投稿ならではの一言にする＝どの投稿にも言える汎用コメント(『いいね！』等)は避ける。ちゃんと読んで反応してる感が残れば、ラフでも刺さる(コピペ感＝逆効果)。\n"
                "【絶対NG】自分の宣伝・売り込み(URL・『うちのアプリ/ツール』・フォロー誘導)、上から目線・説教。\n"
                f"{HUMAN_EMOJI}\n"
                "※短いので絵文字は1〜2個、気持ちが乗る所に自然に。毎回同じ絵文字の使い回しはしない。\n"
                "【出力】本文のみ(前置き・カギ括弧・複数案は不要)。短い一言ひとつだけ。")}])
        return msg.content[0].text.strip()
    except Exception as e:
        return f"(下書き生成失敗: {e})"


def main():
    for k in ("TWITTER_API_KEY", "TWITTER_API_SECRET", "TWITTER_ACCESS_TOKEN", "TWITTER_ACCESS_TOKEN_SECRET"):
        if not os.environ.get(k):
            print(f"{k} 未設定 - スキップ"); return

    client = tweepy.Client(
        consumer_key=os.environ["TWITTER_API_KEY"], consumer_secret=os.environ["TWITTER_API_SECRET"],
        access_token=os.environ["TWITTER_ACCESS_TOKEN"], access_token_secret=os.environ["TWITTER_ACCESS_TOKEN_SECRET"],
        bearer_token=os.environ.get("TWITTER_BEARER_TOKEN") or None,
    )
    ai = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"]) if os.environ.get("ANTHROPIC_API_KEY") else None

    try:
        # user_auth=True で OAuth1.0a ユーザー認証を使う(既存の access token で検索)。
        # 既定(False)はアプリ専用Bearerを要求し、未設定だと 401 になるため。
        resp = client.search_recent_tweets(
            QUERY, max_results=MAX_RESULTS, user_auth=True,
            tweet_fields=["created_at", "public_metrics", "lang"],
            expansions=["author_id"], user_fields=["public_metrics", "username", "name"])
    except Exception as e:
        print(f"検索失敗: {e}")
        send_alert_email(
            "⚠️ Xリプ候補レーダー: 検索できません",
            "Xの読み取り(recent search)に失敗しました。Xの開発者プランが『読み取り(Basic以上 "
            "または従量の読み取り)』に対応しているか確認してください。Bearerトークンが必要な場合は "
            "TWITTER_BEARER_TOKEN をSecretsに追加してください。\n\n"
            f"エラー: {e}")
        return

    tweets = resp.data or []
    users = {u.id: u for u in (resp.includes or {}).get("users", [])}
    seen = set(str(x) for x in _load_list(SEEN_KEY))
    now = datetime.now(timezone.utc)

    cands, by_author = [], {}
    for tw in tweets:
        if str(tw.id) in seen:
            continue
        u = users.get(tw.author_id)
        if not u:
            continue
        if SELF and (u.username or "").lower() == SELF:
            continue
        foll = (u.public_metrics or {}).get("followers_count", 0)
        if not (MIN_FOLL <= foll <= MAX_FOLL):
            continue
        age_min = (now - tw.created_at).total_seconds() / 60 if tw.created_at else 99999
        if age_min > FRESH_HOURS * 60:
            continue
        if by_author.get(tw.author_id, 0) >= 1:   # 1著者につき1件
            continue
        by_author[tw.author_id] = 1
        cands.append({
            "id": str(tw.id), "u": u.username, "name": u.name or "", "foll": foll,
            "age": int(age_min), "rep": (tw.public_metrics or {}).get("reply_count", 0),
            "text": tw.text or "",
        })

    cands.sort(key=lambda c: c["age"])   # 新しい順(鮮度優先)
    cands = cands[:MAX_CANDIDATES]
    if not cands:
        print("候補なし - 通知せず終了"); return

    lines = ["今すぐ反応したいXの投稿候補です。送信はあなたが行ってください（投稿後5〜15分が命）。",
             "相手の投稿を主役に・自己宣伝はしない。下書きは“一言そえるだけ”の短さ＝テンポよく1日10〜15件どんどん。\n"]
    for i, c in enumerate(cands):
        url = f"https://x.com/{c['u']}/status/{c['id']}"
        lines.append(f"{i+1}. @{c['u']}（{c['name']}・{c['foll']:,}フォロワー・{c['age']}分前・既存返信{c['rep']}件）")
        lines.append(url)
        lines.append(f"「{c['text'][:140]}」")
        if ai and i < DRAFT_TOP:
            draft = gen_draft(c["text"], ai)
            intent = f"https://twitter.com/intent/tweet?in_reply_to={c['id']}&text={quote(draft)}"
            lines.append(f"  ▶ 下書き案（編集してから送ってください）: {draft}")
            lines.append(f"     ↳ タップで返信欄に下書きを入れて開く: {intent}")
        lines.append("")

    send_alert_email(f"🗨️ Xリプ候補 {len(cands)}件（今すぐ反応推奨）", "\n".join(lines))
    print(f"候補{len(cands)}件をメール通知")

    kv_set_raw(SEEN_KEY, json.dumps((list(seen) + [c["id"] for c in cands])[-SEEN_CAP:]))


if __name__ == "__main__":
    main()
