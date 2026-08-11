#!/usr/bin/env node
// せどり帳 X運用: 毎朝7時(JST)に「今日の投稿文」をメールで届ける。
// 文面の原本は sedori-ledger/store/x-content-week1.md(このスクリプトに転記)。
// env: RESEND_API_KEY / MAIL_FROM / MAIL_TO
// 使い方: node scripts/sedoriXDaily.mjs [--dry] [--day N]

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM =
  process.env.MAIL_FROM || "せどり帳 X投稿便 <noreply@yushutsu-fukugyo.com>";
const MAIL_TO = (process.env.MAIL_TO || "chikara0323@gmail.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Day1 を配信する日(JST)。翌日がDay2…と進む
const START_DATE = "2026-08-12";
const APP_URL = "https://apps.apple.com/jp/app/id6793951342";

/** 投稿文。thread は「1本目を投稿→2本目をそのリプとして投稿」 */
const DAYS = [
  {
    title: "Day1: 自己紹介(投稿後、固定ポストに設定)",
    note: "1本目を投稿→プロフィールの…メニューから「固定」→2本目を1本目へのリプで投稿",
    thread: [
      `Excelでせどりの利益管理→3日で挫折。\n手書きノート→1週間で白紙。\n\n「もう自分で作るか」\n\n本業がITコンサルなので、自分用の利益管理アプリを本当に作ってしまいました。仕入れと売却を入れるだけで、確定申告の集計まで自動。無料で公開してます↓\n${APP_URL}`,
      `Android版ももうすぐ出ます。\n\nこのアカウントでは\n・せどりの利益管理\n・確定申告のつまずきポイント\nを発信していきます。\n\nアプリの要望はリプでどうぞ。開発者本人なので、良い要望は次のアップデートでそのまま入ります笑`,
    ],
  },
  {
    title: "Day2: Androidテスター募集",
    note: "1本目を投稿→2本目をリプでぶら下げ。「参加」が来たら『準備でき次第リンクを送りますね』と返信",
    thread: [
      `【12名限定・先行アクセス📱】\n\nせどり管理アプリ「せどり帳」のAndroid版、正式リリース前に先行テスターを募集します。\n\n・インストール無料\n・やることは「2週間入れておく」だけ\n・もらった要望は優先で反映します\n\nリプかDMで「参加」と送ってください!\n#せどり #先行テスター募集`,
      `せどり帳は、仕入れと売却を入れるだけで利益・利益率・確定申告の集計まで自動でやる帳簿アプリです。\n\niOS版はApp Storeで公開中↓\n${APP_URL}\n\nせどりをやってない方でも、Androidスマホがあれば参加OKです🙏`,
    ],
  },
  {
    title: "Day3: 機能紹介(集計タブのスクショを添付)",
    note: "アプリの集計タブを開いてスクショを撮り、画像付きで投稿",
    thread: [
      `せどりで一番こわいのは、赤字なのに「儲かってる気がする」状態です。\n\n手数料と送料を引いたら実はマイナスだった、はあるあるです。\n\n仕入れと売却を入れるだけで"本当の利益"が出る画面を作りました↓(無料)\n${APP_URL}`,
    ],
  },
  {
    title: "Day4: Tips(確定申告)",
    note: "この型(税務ネタ)は反応が伸びやすい。リプが来たら丁寧に返す",
    thread: [
      `「メルカリの売上くらいバレないでしょ」\n\n→税務署はフリマアプリに取引照会できます。副業の利益が年20万円を超えたら確定申告が必要です。\n\n意外な落とし穴が「棚卸し」。年末に残った在庫は申告に必要で、売れてない仕入れは経費になりません。年明けに慌てないように。`,
    ],
  },
  {
    title: "Day5: 開発ストーリー",
    note: "",
    thread: [
      `帳簿が続かないのは、意志が弱いからじゃないです。\n\nExcel→起動が面倒\nノート→計算が面倒\nスプシ→スマホで開くのが面倒\n\n続かない理由は全部「入力が重い」。レジ打ちみたいに2タップで終わるなら続く。そう思って自分用のアプリを作りました。`,
    ],
  },
  {
    title: "Day6: Tips(利益率)",
    note: "",
    thread: [
      `同じ「月10万の利益」でも、\n\n・仕入れ50万→利益率20%\n・仕入れ100万→利益率10%\n\nは全く別のゲームです。後者は資金も在庫リスクも2倍。\n\n自分の利益率、即答できますか?\n即答できる人は強い。記録をつけてる人だけが持てる武器です。`,
    ],
  },
  {
    title: "Day7: テスター募集リマインド",
    note: "Day2のポストを引用リポストの形で投稿すると効果的",
    thread: [
      `Android勢のせどらーさん、お待たせしています📱\n\n「せどり帳」Android版の先行テスター、引き続き募集中です。\nやることは「入れて2週間そのまま」だけ。せどり未経験でもOK。\n\nリプかDMで「参加」とどうぞ!\n#せどり #先行テスター募集`,
    ],
  },
];

const ROUTINE = [
  "せどり系アカウントに3〜5件リプ(実践者としてのコメント・宣伝なし)",
  "#せどり帳 を検索→ユーザー投稿があればリポスト+お礼リプ",
  "候補リスト(influencer-outreach.md)から10〜20件フォロー",
];

function jstToday() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

function dayIndex() {
  const argIdx = process.argv.indexOf("--day");
  if (argIdx >= 0) return Number(process.argv[argIdx + 1]) - 1;
  const diff = Math.round(
    (new Date(jstToday()) - new Date(START_DATE)) / 86400000
  );
  return diff;
}

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function main() {
  const idx = dayIndex();
  let subject, html;

  if (idx < 0) {
    console.log("開始日前のためスキップ:", jstToday());
    return;
  }

  if (idx >= DAYS.length) {
    // 1週目終了後は月曜だけリマインドを送る(毎日は送らない)
    const isMonday = new Date(jstToday()).getDay() === 1;
    if (!isMonday) {
      console.log("初週分は配信済み。月曜以外はスキップ");
      return;
    }
    subject = "【X投稿便】翌週分の投稿文が未作成です";
    html = `<p>初週(Day1〜7)の投稿文は配信済みです。</p>
<p>Claudeに「X投稿の翌週分を作って」と伝えると、反応の良かった型で次の1週間分を用意し、この配信も更新されます。</p>`;
  } else {
    const day = DAYS[idx];
    subject = `【X投稿便】${day.title}`;
    const posts = day.thread
      .map(
        (t, i) =>
          `<p style="color:#888;margin:16px 0 4px">${
            day.thread.length > 1 ? `── ${i + 1}本目${i > 0 ? "(1本目へのリプで投稿)" : ""} ──` : "── 投稿文 ──"
          }</p>
<pre style="background:#f4f4f2;border-radius:8px;padding:14px;white-space:pre-wrap;font-family:sans-serif;font-size:15px;line-height:1.6">${esc(t)}</pre>`
      )
      .join("");
    html = `<div style="font-family:sans-serif;max-width:600px">
<h2 style="font-size:16px">${esc(day.title)}</h2>
${day.note ? `<p style="color:#b4923e;font-size:13px">📌 ${esc(day.note)}</p>` : ""}
${posts}
<p style="color:#888;font-size:12px;margin-top:20px">ついでの5分ルーティン:</p>
<ul style="color:#888;font-size:12px">${ROUTINE.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
</div>`;
  }

  if (process.argv.includes("--dry")) {
    console.log("subject:", subject);
    console.log(html);
    return;
  }
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY がありません");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: MAIL_FROM, to: MAIL_TO, subject, html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  console.log("sent:", subject);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
