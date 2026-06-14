import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(__dirname, 'raw');
const BASE = 'http://localhost:3001';
const VIEWPORT = { width: 430, height: 860 };

const manifest = {}; // id -> { guide, kind, screen, instruction }
function add(id, meta) { manifest[id] = meta; }

async function shotEl(el, id) {
  if (!el) { console.log(`x MISSING ${id}`); return false; }
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.screenshot({ path: path.join(RAW, `${id}.png`), type: 'png' });
  console.log(`ok ${id}.png`);
  return true;
}

async function main() {
  const browser = await chromium.launch();

  /* 1. はじめてガイド */
  {
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/guide`, { waitUntil: 'networkidle' });

    await shotEl(await page.$('main .bg-gradient-to-br'), 'g_intro');
    add('g_intro', { guide: 'guide', kind: 'card', screen: '楽天xeBay 輸出転売の概要＋フロー図（仕入れ→販売→回収）', instruction: '楽天で仕入れてeBayで海外に売る副業の全体像' });

    const stepCards = await page.$$('main > div:nth-child(2) > div:nth-child(2) > div');
    const stepMeta = [
      ['g_step1', '①楽天で商品を仕入れる', 'ポイント高還元日(0と5のつく日/スーパーSALE)を狙う'],
      ['g_step2', '②eBayアカウントを作成する', '売上受け取りのセラー登録は初回だけ。画像つきガイドあり'],
      ['g_step3', '③eBayに出品する', '「楽天で仕入れる」を押すと簡単出品が解放。タイトル・価格は自動'],
      ['g_step4', '④売れたら発送する', '日本郵便の国際郵便で発送。追跡番号をeBayに登録'],
      ['g_step5', '⑤利益を受け取る', 'Payoneer経由で銀行へ。楽天ポイントは次の仕入れに'],
    ];
    for (let i = 0; i < stepMeta.length && i < stepCards.length; i++) {
      const [id, screen, instruction] = stepMeta[i];
      await shotEl(stepCards[i], id);
      add(id, { guide: 'guide', kind: 'card', screen, instruction });
    }

    await shotEl(await page.$('main [class*="font-mono"]'), 'g_profit');
    add('g_profit', { guide: 'guide', kind: 'card', screen: '利益の計算式(eBay相場 − 楽天仕入れ + ポイント − 手数料)', instruction: '全商品この式で利益を算出。国際送料は購入者負担' });

    await ctx.close();
  }

  /* 2. eBayセラー登録ガイド */
  {
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('ebay_guide_step', '0'); } catch {} });
    await page.goto(`${BASE}/guide/ebay-seller`, { waitUntil: 'networkidle' });

    const introCards = await page.$$('main > div > div.bg-white.rounded-2xl');
    await shotEl(introCards[0], 'e_intro');
    add('e_intro', { guide: 'ebay', kind: 'card', screen: '登録は初回だけ・所要10〜15分。用意するもの(スマホ/本人確認書類/銀行口座/カード)', instruction: '名前・住所はローマ字で身分証と完全一致。ズレると審査で止まる' });

    const stepPhones = {
      0: [
        ['e_s1_login', 'eBayにSign in（メール＋パスワード）', 'ログインする。買い物用アカウントがあればそのまま使える'],
        ['e_s1_sell', '上部メニュー Sell →青いSell now', '「Sell(出品)」を押し、青い「Sell now」で出品を始める'],
        ['e_s1_search', '商品名で検索→近い候補を選ぶ', 'ピッタリ無ければ「一致なしで続行」でOK'],
        ['e_s1_getstarted', 'Set up your selling account →Get started', '押すと自動でPayoneer画面に切替（正しい動き）。次のSTEP2へ'],
      ],
      1: [
        ['e_s2_signup', 'Connect to Payoneer →Sign up', '新規登録。確認メールが来たらリンクを押して続行（迷惑メールも確認）'],
        ['e_s2_type', '種別=個人(Individual)、氏名はローマ字', '身分証と同じローマ字表記で入力'],
        ['e_s2_contact', '連絡先情報（★最大の難所）', '「次へ」が押せない時：住所を確定/City必須/電話は先頭の0を取る/SMSは最新6桁'],
        ['e_s2_kyc', '本人確認(KYC)＝書類番号 or 撮影', '明るい場所で四隅まで・反射に注意。免許証は表裏のことも'],
        ['e_s2_bank', '受け取り銀行口座（本人名義・ローマ字一致）', '支店コードやSWIFTコードを聞かれることあり。事前に調べてメモ'],
        ['e_s2_done', '🎉おめでとう＝申請完了（審査中）', '自動でeBayに戻る。まだ出品はできない。あせらず待つ'],
      ],
      2: [
        ['e_s3_sync', 'Sync(同期)で氏名・住所が反映→Continue', 'Payoneerの情報がeBayに取り込まれる。確認して続行'],
        ['e_s3_card', '手数料用カードを登録(VISA/Master)', '保険用で登録だけなら請求なし。デビットは不可のことも'],
        ['e_s3_submit', 'Submit registration で送信', 'これでeBay側の入力は完了。あとは審査を待つ'],
      ],
      3: [
        ['e_s4_listing', '準備OKメール後→アプリで「確認できた・出品する」', 'KYC完了メール(差出人Payoneer)が出品解禁の合図。以降は1タップ出品'],
      ],
    };

    for (const step of [0, 1, 2, 3]) {
      await page.evaluate((s) => { try { localStorage.setItem('ebay_guide_step', String(s)); } catch {} }, step);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      const phones = await page.$$('div[class*="max-w-[260px]"]');
      const metas = stepPhones[step];
      for (let i = 0; i < metas.length; i++) {
        const [id, screen, instruction] = metas[i];
        const el = phones[i];
        if (await shotEl(el, id)) add(id, { guide: 'ebay', kind: 'phone', screen, instruction });
      }
    }

    const tCards = await page.$$('main > div > div.bg-white.rounded-2xl');
    await shotEl(tCards[tCards.length - 1], 'e_troubles');
    add('e_troubles', { guide: 'ebay', kind: 'card', screen: 'よくあるつまずき集（次へ押せない/出品エラー=審査待ち/承認メール違い/迷惑メール）', instruction: '困ったらこの4つを確認すればほぼ解決' });

    await ctx.close();
  }

  /* 3. Payoneer出金ガイド */
  {
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/guide/payoneer-withdraw`, { waitUntil: 'networkidle' });

    const kids = await page.$$('main > *');
    const pMeta = [
      ['p_intro', 'eBayの売上→Payoneer→あなたの銀行口座へ', 'Payoneerに入った売上を日本の銀行へ出金して手元のお金にする'],
      ['p_prepare', '用意するもの＝本人名義の銀行口座', '口座名義はPayoneer登録名と完全一致（ローマ字）。違うと出金不可'],
      ['p_step1', 'STEP1 login.payoneer.com にログイン', '登録したメール・パスワードでログイン'],
      ['p_step2', 'STEP2 出金先の銀行口座を登録（初回だけ）', '名義はPayoneerと同じローマ字。初回は審査に最大3営業日'],
      ['p_step3', 'STEP3 引き出し→「銀行口座宛」を選ぶ', '上部メニューの引き出しから銀行口座宛を選択'],
      ['p_step4', 'STEP4 出金する金額を入力', '手数料目安：出金約1〜2%＋為替最大2%。まとめて出金がお得'],
      ['p_step5', 'STEP5 内容を確認して送信→着金待ち', '3〜5営業日で銀行口座に着金'],
      ['p_fees', '手数料・日数まとめ', '出金1〜2%/為替最大2%/口座審査最大3営業日/着金3〜5営業日'],
      ['p_troubles', 'よくあるつまずき', '出金不可=名義不一致/初回は口座審査/手数料はまとめて出金で軽減'],
    ];
    for (let i = 0; i < pMeta.length; i++) {
      const [id, screen, instruction] = pMeta[i];
      await shotEl(kids[i], id);
      add(id, { guide: 'payoneer', kind: 'card', screen, instruction });
    }

    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nok manifest.json (${Object.keys(manifest).length} images)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
