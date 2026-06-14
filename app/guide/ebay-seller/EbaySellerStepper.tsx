"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  AlertTriangle,
  Check,
  Smartphone,
  CreditCard,
  Landmark,
  Hand,
  Clock,
  Mail,
  Search,
  Camera,
  HelpCircle,
  Lock,
  ChevronDown,
  RotateCcw,
} from "lucide-react";
import AddressConverter from "../../components/AddressConverter";

/* ── 画面イラストの小部品（実画面をなぞった注釈つき。値はすべてダミー） ── */

function EbayLogo() {
  return (
    <span className="font-black text-[15px] tracking-tight leading-none">
      <span className="text-[#E53238]">e</span>
      <span className="text-[#0064D2]">b</span>
      <span className="text-[#F5AF02]">a</span>
      <span className="text-[#86B817]">y</span>
    </span>
  );
}

function PayoneerLogo() {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="relative w-4 h-4 rounded-full"
        style={{ background: "conic-gradient(from 90deg, #ff6a00, #ff2db4, #8a3ffc, #1e9bff, #ff6a00)" }}
      >
        <span className="absolute inset-[3px] rounded-full bg-white" />
      </span>
      <span className="font-bold text-[13px] text-gray-800">Payoneer</span>
    </span>
  );
}

// スマホ枠：画面イラストを「スマホの画面」と分かるように囲う（角丸外枠＋上部ステータスバー風）
function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[260px] rounded-[26px] border-[5px] border-gray-800 bg-gray-800 shadow-md overflow-hidden">
      <div className="flex items-center justify-between h-6 px-3 bg-gray-800 text-white text-[9px] font-semibold">
        <span>9:41</span>
        <span className="relative w-9 h-2.5 mx-auto rounded-full bg-gray-700" aria-hidden="true">
          <span className="absolute left-1/2 -translate-x-1/2 top-0.5 w-3 h-1.5 rounded-full bg-gray-600" />
        </span>
        <span className="flex items-center gap-1" aria-hidden="true">
          <span className="text-[8px]">●●●</span>
          <span className="inline-block w-4 h-2 rounded-[2px] border border-white/70 relative">
            <span className="absolute inset-[1px] right-1.5 bg-white rounded-[1px]" />
          </span>
        </span>
      </div>
      <div className="bg-white">{children}</div>
    </div>
  );
}

function Screen({ logo, children }: { logo?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white overflow-hidden">
      <div className="flex items-center justify-center h-8 px-2.5 bg-gray-50 border-b border-gray-100">
        {logo ?? (
          <span className="flex gap-1" aria-hidden="true">
            <span className="w-2 h-2 rounded-full bg-gray-200" />
            <span className="w-2 h-2 rounded-full bg-gray-200" />
            <span className="w-2 h-2 rounded-full bg-gray-200" />
          </span>
        )}
      </div>
      <div className="p-3 space-y-2">{children}</div>
    </div>
  );
}

// 押す場所（ハイライト＋指マーク）。<p>内でも使えるよう span のみで構成する。
function Tap({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-flex">
      <span className="absolute -inset-1 rounded-xl ring-2 ring-[#BF0000] animate-pulse" aria-hidden="true" />
      <span className="relative">{children}</span>
      <span className="absolute -right-2 -bottom-3 text-[#BF0000]">
        <Hand size={18} />
      </span>
    </span>
  );
}

function BlueBtn({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center h-9 px-5 rounded-full bg-[#0064D2] text-white text-[13px] font-bold">
      {children}
    </span>
  );
}

function Field({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-gray-400 mb-0.5">{label}</p>
      <div
        className={`min-h-8 py-1 px-2.5 flex items-center rounded-lg border text-[12px] ${
          ok ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-gray-200 text-gray-700"
        }`}
      >
        <span className="leading-snug">{value}</span>
        {ok && <Check size={13} className="ml-auto shrink-0 text-emerald-500" />}
      </div>
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
      <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
      <div className="text-[12px] text-amber-800 leading-relaxed">{children}</div>
    </div>
  );
}

// 「つまずいたら」の一言（軽い色味で各STEPに添える）
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 bg-sky-50 border border-sky-100 rounded-xl px-3 py-2">
      <HelpCircle size={15} className="text-sky-500 shrink-0 mt-0.5" />
      <p className="text-[11.5px] text-sky-800 leading-relaxed">
        <b>つまずいたら：</b>
        {children}
      </p>
    </div>
  );
}

// メールのステップ用カード（封筒＋件名の要旨＋押すリンクのハイライト）
function MailCard({
  from,
  subject,
  body,
  link,
}: {
  from: React.ReactNode;
  subject: string;
  body: string;
  link: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100">
        <span className="w-7 h-7 rounded-full bg-[#BF0000]/10 flex items-center justify-center shrink-0">
          <Mail size={15} className="text-[#BF0000]" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] text-gray-500 leading-tight">メールが届きます（差出人：{from}）</p>
          <p className="text-[12.5px] font-bold text-gray-800 leading-tight truncate">{subject}</p>
        </div>
      </div>
      <div className="p-3 space-y-2">
        <p className="text-[12px] text-gray-600 leading-relaxed">{body}</p>
        <p className="text-[12px] text-gray-700">
          本文の中の{" "}
          <Tap>
            <span className="text-[#0064D2] font-bold underline underline-offset-2">{link}</span>
          </Tap>{" "}
          を押す。
        </p>
      </div>
    </div>
  );
}

// Payoneerアプリの導入カード（本人確認書類の撮影アップロードがスムーズになる）
function PayoneerAppInstall() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3">
      <p className="text-[12px] font-bold text-gray-800 flex items-center gap-1.5 mb-2">
        <Smartphone size={15} className="text-[#BF0000] shrink-0" />
        Payoneerアプリを入れておく（書類の提出がかんたん）
      </p>
      <div className="flex gap-2">
        <a
          href="https://apps.apple.com/jp/app/payoneer/id663338402"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 inline-flex items-center justify-center h-10 rounded-xl bg-gray-900 text-white text-[12px] font-bold active:opacity-80"
        >
          App Store（iPhone）
        </a>
        <a
          href="https://play.google.com/store/apps/details?id=com.payoneer.android"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 inline-flex items-center justify-center h-10 rounded-xl bg-gray-900 text-white text-[12px] font-bold active:opacity-80"
        >
          Google Play（Android）
        </a>
      </div>
      <p className="text-[10px] text-gray-400 mt-1.5 leading-snug">
        App Store / Google Play で「Payoneer」と検索しても入れられます。書類はアプリのカメラでその場で撮ってアップロードできます。
      </p>
    </div>
  );
}

/* ── STEPの中身（各STEPの本文） ── */

function Step1Body() {
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-gray-600 leading-relaxed">
        まず、スマホでブラウザ（SafariやChrome）を開き、上のアドレス欄に「ebay.com」と入力して開きます。アプリは使いません。画面が英語でも大丈夫、下の絵のとおりに押していけばOKです。
      </p>

      {/* ① ログイン */}
      <p className="text-[12px] font-bold text-gray-700">① ログインする</p>
      <Phone>
        <Screen logo={<EbayLogo />}>
          <p className="text-[13px] font-bold text-gray-800">Hello! Sign in to eBay</p>
          <Field label="Email or username" value="あなたのメール" />
          <Field label="Password" value="••••••••" />
          <Tap>
            <BlueBtn>Sign in</BlueBtn>
          </Tap>
        </Screen>
      </Phone>
      <p className="text-[12px] text-gray-600 leading-relaxed">
        メールアドレスとパスワードを入れて「Sign in（サインイン）」を押します。買い物用のアカウントがあれば、そのまま使えます。
      </p>

      {/* ② Sell → Sell now */}
      <p className="text-[12px] font-bold text-gray-700">② 「Sell（出品）」→「Sell now」を押す</p>
      <Phone>
        <Screen logo={<EbayLogo />}>
          <div className="flex items-center justify-between text-[12px] text-gray-600 border-b border-gray-100 pb-1.5">
            <span>My eBay</span>
            <Tap>
              <span className="font-bold text-gray-800">Sell</span>
            </Tap>
            <span>Watchlist</span>
          </div>
          <p className="text-[11px] text-gray-500">出品ページが開いたら、青いボタンを押します</p>
          <Tap>
            <BlueBtn>Sell now</BlueBtn>
          </Tap>
        </Screen>
      </Phone>
      <p className="text-[12px] text-gray-600 leading-relaxed">
        画面いちばん上の「Sell（出品）」を押すと出品ページが開きます。続けて青い「Sell now（セルナウ＝今すぐ出品）」を押し、出品を始めます。
      </p>

      {/* ③ 何か選んで進むだけ（商品は“テスト”でOK） */}
      <p className="text-[12px] font-bold text-gray-700">③ 何か選んで進むだけ（商品は“テスト”でOK）</p>
      <Phone>
        <Screen logo={<EbayLogo />}>
          <p className="text-[12px] font-bold text-gray-800">出品の入口（セラー登録のためだけ）</p>
          <div className="h-9 px-3 flex items-center gap-2 rounded-lg border border-gray-200 text-[12px] text-gray-700">
            <Search size={14} className="text-gray-400 shrink-0" />
            <span>商品名は何でもOK</span>
          </div>
          <p className="text-[11px] text-[#0064D2] font-bold">
            候補が出たらどれか1つ／無ければ「一致なしで続行」
          </p>
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg border border-gray-200 text-[11.5px] text-gray-600">
            <span>コンディション（状態）</span>
            <span className="font-bold text-gray-700">適当に選ぶ</span>
          </div>
          <Tap>
            <span className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-[12px] text-emerald-700">
              タイトル等の必須項目は「テスト」
              <Check size={13} className="ml-auto shrink-0 text-emerald-500" />
            </span>
          </Tap>
          <BlueBtn>Continue（続ける）</BlueBtn>
        </Screen>
      </Phone>
      <p className="text-[12px] text-gray-600 leading-relaxed">
        この画面は<b>「出品」ではなく、セラー登録に進むための入口</b>です。だから商品は<b>何でもOK</b>。検索して候補が出たらどれか1つ選び（無ければ「一致なしで続行」）、状態（コンディション）も<b>適当に選んで</b>かまいません。
      </p>
      <p className="text-[12px] text-gray-600 leading-relaxed">
        続けてタイトルなどの<b>必須項目を求められたら、すべて「テスト」</b>と入れて進めて大丈夫です。写真や価格も適当でOK。やがて「Set up your selling account（セラー登録）」の画面になります。
      </p>

      {/* ④ Get started */}
      <p className="text-[12px] font-bold text-gray-700">④ 「Get started」を押してセラー登録へ</p>
      <Phone>
        <Screen logo={<EbayLogo />}>
          <p className="text-[12px] font-bold text-gray-800">Set up your selling account</p>
          <p className="text-[11px] text-gray-700">① Connect a Payoneer account</p>
          <p className="text-[11px] text-gray-400">② Sync eBay and Payoneer</p>
          <p className="text-[11px] text-gray-400">③ Add your financial info（カード）</p>
          <p className="text-[11px] text-gray-400">④ Submit registration</p>
          <Tap>
            <BlueBtn>Get started</BlueBtn>
          </Tap>
        </Screen>
      </Phone>
      <p className="text-[12px] text-gray-600 leading-relaxed">
        「Set up your selling account（セラー登録）」の画面で「Get started（ゲットスターテッド＝はじめる）」を押すと、次のSTEPのPayoneer（ペイオニア）登録に進みます。
      </p>
      <p className="text-[12px] text-gray-600 leading-relaxed">
        「Get started」を押すと、画面が自動で「Payoneer（ペイオニア）」に切り替わります（ロゴがカラフルな丸い印に変わります）。これは正しい動きなので、そのまま次のSTEP2へ進んでください。
      </p>

      <Warn>
        ここで作るものは“セラー登録に進むための仮の入口”で、<b>このまま公開・販売されることはありません</b>（あとで下書きを破棄してOK）。だから<b>商品・状態・タイトルは「テスト」など適当で大丈夫</b>。本当の出品は登録が全部終わってから、アプリ（輸出ラボ）の「eBay簡単出品」が写真だけで自動で行います。
      </Warn>
      <Tip>上のメニューに「Sell」が見当たらない時は、右上の「☰（三本線）」を押すと中に入っています。</Tip>
      <p className="text-[12px] text-[#BF0000] font-bold leading-relaxed">
        → ここまでできたら、下の赤いボタン「できた・次へ進む」を押してください。
      </p>
    </div>
  );
}

function Step2Body() {
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-gray-600 leading-relaxed">
        STEP1で「Get started」を押すと、この「Payoneer（ペイオニア）」の画面が自動で開きます。eBayから抜けたわけではないので安心してください。
      </p>
      <p className="text-[13px] text-gray-600 leading-relaxed">
        Payoneer（ペイオニア）は、eBayの売上を受け取る口座です。ここが一番つまずきやすいところです。落ち着いて1つずつ進めましょう。
      </p>
      <p className="text-[12px] text-gray-600 leading-relaxed">
        ここから先は、画面が「次へ」で1枚ずつ進みます（②種別→③連絡先→④口座→⑤完了の順）。下に出てくる画面は“順番に出てくる別々のページ”です。1つ終わったら「次へ」で次の画面に進んでください。<b>本人確認（書類の提出）は、この登録のあとにPayoneerからメールで案内が来ます</b>（後述の⑥）。
      </p>

      {/* ① 新規登録 */}
      <p className="text-[12px] font-bold text-gray-700">① 「Sign up」で新規登録（初めての人）</p>
      <Phone>
        <Screen logo={<PayoneerLogo />}>
          <p className="text-[12px] font-bold text-gray-800">Connect to Payoneer</p>
          <Field label="Email" value="あなたのメール" />
          <p className="text-[12px] text-gray-600">
            New to Payoneer?{" "}
            <Tap>
              <span className="text-[#0064D2] font-bold">Sign up</span>
            </Tap>
          </p>
        </Screen>
      </Phone>
      <p className="text-[12px] text-gray-600 leading-relaxed">
        Payoneerの画面に変わったら「Sign up（サインアップ＝新規登録）」を押します。すでに持っている人は「Sign in（サインイン＝ログイン）」でOKです。
      </p>
      <p className="text-[12px] text-gray-600 leading-relaxed">
        「Sign up」のあと、入力したメールアドレス宛にPayoneer（ペイオニア）から確認メールが届くことがあります。その時は、メールを開いて中のボタン（リンク）を一度押すと、続きの入力画面に進めます。見当たらない時は迷惑メールフォルダも確認してください。
      </p>

      {/* ② 種別＋氏名 */}
      <p className="text-[12px] font-bold text-gray-700">② 種別は「個人」、氏名はローマ字で</p>
      <Phone>
        <Screen logo={<PayoneerLogo />}>
          <Field label="アカウント種別" value="個人 / Individual" ok />
          <Field label="名 / First name" value="TARO" />
          <Field label="姓 / Last name" value="YAMADA" />
        </Screen>
      </Phone>
      <p className="text-[12px] text-gray-600 leading-relaxed">
        種別は「個人（Individual）」を選びます。氏名はローマ字（半角英字）で、身分証と同じ表記にします。
      </p>

      {/* ③ 連絡先情報（最大の難所） */}
      <div className="rounded-2xl border-2 border-[#BF0000]/40 bg-[#BF0000]/[0.03] p-3 space-y-3">
        <p className="text-[12px] font-black text-[#BF0000]">③ 連絡先情報（★ここが最大の難所）</p>
        <p className="text-[11.5px] text-[#BF0000] font-bold leading-relaxed">
          ここで「次へ」が押せない人が続出します。下の4つを必ず守ってください。
        </p>
        <Phone>
          <Screen logo={<PayoneerLogo />}>
            <Field label="国 / Country" value="Japan（+81）" ok />
            <Field label="番地 / Street address" value="1-2-3 Marunouchi ▼候補から選ぶ" ok />
            <Field label="都市名 / City（必須）" value="Chiyoda-ku" ok />
            <Field label="都道府県 / State" value="Tokyo" />
            <Field label="郵便番号 / ZIP" value="100-0005" />
            <Field label="携帯番号（先頭の0を取る）" value="9012345678" ok />
            <Field label="SMS認証コード" value="届いた最新の6桁" />
          </Screen>
        </Phone>
        <Warn>
          <p className="font-bold mb-1">「次へ」が押せない4つの原因</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>住所を確定していない（候補をタップ、または「手動入力」で確定する）</li>
            <li>City（都市名）が空になっている（必ず埋める）</li>
            <li>
              電話番号は先頭の0を取る。国を「Japan（+81）」に選んでから、番号の先頭の0を取って入力（例：090-1234-5678 → 9012345678／ハイフンも先頭の0も無し）。+81は自分で入力せず、国を選べば自動で付きます
            </li>
            <li>SMSコードが古い（届いた最新の6桁を、入れたらすぐ次へ）</li>
          </ul>
        </Warn>

        <p className="text-[11.5px] text-gray-600 leading-relaxed">
          携帯番号を入れたら「コードを送信（Send code＝センドコード／送信）」を押します。数十秒でスマホにSMS（ショートメール）で6桁の数字が届くので、それを「SMS認証コード」欄に入れてすぐ「次へ」を押してください。
        </p>

        <p className="text-[12px] text-gray-700 leading-relaxed font-bold">
          下の赤い箱で、日本の住所を英語に変換できます。出てきた英語をコピーして、上のフォームの同じ欄に貼り付けてください。
        </p>
        <AddressConverter />
        <p className="text-[11.5px] text-gray-500 leading-relaxed">
          ※ Payoneerの画面では「Street address（番地）」＝住所1、「City」＝市区町村、「State」＝都道府県の欄です。色や順番が違っても、英語のラベルが同じ欄に貼り付ければOKです。
        </p>
        <p className="text-[11.5px] text-gray-500 leading-relaxed">
          SMS認証コードは数分で期限切れになります。コードを入れたら他をいじらず、すぐ「次へ」を押すのがコツです。
        </p>
      </div>

      {/* ④ 受け取り銀行口座 */}
      <p className="text-[12px] font-bold text-gray-700">④ 受け取り銀行口座を登録（本人名義・ローマ字一致）</p>
      <Phone>
        <Screen logo={<PayoneerLogo />}>
          <Field label="銀行名 / Bank" value="〇〇銀行" />
          <Field label="支店・口座番号" value="支店名・口座番号" />
          <Field label="口座名義（ローマ字）" value="TARO YAMADA" ok />
        </Screen>
      </Phone>
      <p className="text-[12px] text-gray-600 leading-relaxed">
        売上を最終的に振り込んでもらう、あなたの銀行口座を登録します。名義は通帳のローマ字表記と同じにしてください。
      </p>
      <p className="text-[12px] text-gray-600 leading-relaxed">
        銀行によっては「支店コード（3桁の数字）」や「SWIFT（スイフト）コード」を聞かれます。SWIFTコードは銀行ごとに決まった英数字8〜11桁の記号で、各銀行の公式サイトで「（銀行名）SWIFTコード」と検索すると出てきます。通帳やキャッシュカードには載っていないので、事前に調べてメモしておくと安心です。
      </p>

      {/* ⑤ 申請完了 */}
      <p className="text-[12px] font-bold text-gray-700">⑤ 「おめでとうございます」＝申請完了</p>
      <Phone>
        <Screen logo={<PayoneerLogo />}>
          <p className="text-[13px] font-black text-[#1e9bff]">🎉 おめでとうございます！</p>
          <p className="text-[12px] text-gray-700">申請が正常に送信されました。審査中です。</p>
        </Screen>
      </Phone>
      <p className="text-[12px] text-gray-600 leading-relaxed">
        この画面のあと、自動でeBayの登録画面に戻ります（「eBayに戻る／Return to eBay」のようなボタンが出たら、それを押してください）。戻ったら次のSTEP3に進みます。
      </p>

      {/* ⑥ 本人確認(KYC)の書類提出メール（登録のあとに届く） */}
      <p className="text-[12px] font-bold text-gray-700">⑥ 本人確認（KYC）の書類提出メールが届く → 提出すると 0〜3日で承認</p>
      <MailCard
        from={<PayoneerLogo />}
        subject="（例）本人確認書類のご提出のお願い"
        body="申請のあと、Payoneer（ペイオニア）から「本人確認の書類を提出してください」というメールが届きます。メール内の案内（ボタン／リンク）から、身分証などの書類を提出します。登録画面でその場で求められず、あとからメールで来るのがふつうです。"
        link="書類を提出する / Verify your identity"
      />
      <p className="text-[12px] text-gray-600 leading-relaxed">
        書類の提出は <b>Payoneerアプリ</b> を使うとスムーズです（その場でカメラ撮影してアップロードできます）。下から入れておきましょう。
      </p>
      <PayoneerAppInstall />
      <p className="text-[12px] text-gray-600 leading-relaxed flex items-start gap-1.5">
        <Camera size={14} className="text-gray-400 shrink-0 mt-0.5" />
        撮影のコツ：明るい場所で、書類の四隅が全部写るように、文字がはっきり読めるように。光の反射で文字が白飛びしないよう注意。免許証は表・裏の両方を求められることがあります。ピンボケや暗いと再提出になるので、落ち着いて撮り直してOKです。
      </p>
      <Warn>
        提出すると審査が始まり、<b>早ければ当日、長くても0〜3日ほど</b>で承認されます。承認されると、いよいよ出品できます（STEP4）。
        <br />
        ※承認の前に「有効化」「承認」など別のメールが届くことがありますが、出品できるのは<b>本人確認（KYC）が完了</b>してからです。あせらず待ちましょう。
      </Warn>
      <p className="text-[12px] text-[#BF0000] font-bold leading-relaxed">
        → ここまでできたら、下の赤いボタン「できた・次へ進む」を押してください。
      </p>
    </div>
  );
}

function Step3Body() {
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-gray-600 leading-relaxed">
        Payoneer（ペイオニア）の申請が終わると、自動的にeBayの画面（「Set up your selling account＝セラー登録」）に戻ります。もし戻らなかったり画面を閉じてしまった時は、あわてず eBayを開き直し、「Account（アカウント）→ Selling（出品）」から登録の続きを開けます。氏名や住所が空欄に見えても、少し待つか画面を更新すると反映されます。
      </p>
      <p className="text-[12px] text-gray-600 leading-relaxed">
        戻ると、さっきの4つのリストのうち「① Payoneerの接続」が済んだ印（チェック）になっています。ここからは残りの②③④を上から順に進めるだけです。今いる場所が分からなくなったら、リストの“まだ印が付いていない一番上”が次にやることです。
      </p>

      {/* ① Sync */}
      <p className="text-[12px] font-bold text-gray-700">① Sync（氏名・住所が反映 → Continue）</p>
      <Phone>
        <Screen logo={<EbayLogo />}>
          <p className="text-[12px] text-gray-700">② Sync eBay and Payoneer profiles</p>
          <p className="text-[11px] text-gray-500">Payoneerの氏名・住所が反映 → 内容を確認</p>
          <Tap>
            <BlueBtn>Continue</BlueBtn>
          </Tap>
        </Screen>
      </Phone>
      <p className="text-[12px] text-gray-600 leading-relaxed">
        Sync（シンク＝同期。情報を合わせる作業）で、Payoneerの氏名・住所がeBayに取り込まれます。内容を確認して「Continue（コンティニュー＝つづける）」を押します。
      </p>

      {/* ② カード登録 */}
      <p className="text-[12px] font-bold text-gray-700">② カードを登録（VISA/Master・手数料用）</p>
      <Phone>
        <Screen logo={<EbayLogo />}>
          <p className="text-[12px] text-gray-700">③ Add your financial info</p>
          <Field label="カード番号" value="•••• •••• •••• ••••" />
          <Field label="有効期限 / セキュリティコード" value="MM/YY ・ •••" />
        </Screen>
      </Phone>
      <p className="text-[12px] text-gray-600 leading-relaxed">
        カードを1枚登録します（VISAまたはMastercard）。これは“万一、売上で足りない手数料が出た時の保険”で、登録しただけでお金は取られません。実際に請求されるのは、売れたあと手数料を売上から引けなかった時だけです。デビットカードは登録できないことがあるので、できればクレジットカードを用意してください。
      </p>

      {/* ③ Submit */}
      <p className="text-[12px] font-bold text-gray-700">③ Submit registration で送信</p>
      <Phone>
        <Screen logo={<EbayLogo />}>
          <p className="text-[12px] text-gray-700">④ Submit registration info</p>
          <Tap>
            <BlueBtn>Submit registration</BlueBtn>
          </Tap>
        </Screen>
      </Phone>
      <p className="text-[12px] text-gray-600 leading-relaxed">
        最後に「Submit registration（サブミット＝登録を送る）」で登録情報を送信します。これでeBay側の入力は完了です。あとは審査を待つだけです。
      </p>
      <Tip>
        うまく戻れなかった時は、eBayの「Account → Selling」から登録の続きを開けます。
      </Tip>
      <p className="text-[12px] text-[#BF0000] font-bold leading-relaxed">
        → ここまでできたら、下の赤いボタン「できた・次へ進む」を押してください。
      </p>
    </div>
  );
}

function Step4Body() {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
        <Clock size={16} className="text-blue-500 shrink-0 mt-0.5" />
        <p className="text-[12px] text-blue-800 leading-relaxed">
          STEP2で本人確認の書類を提出したら、あとはPayoneer（ペイオニア）の審査を待つだけです。早ければ当日、長くても0〜3日ほどで完了し、Payoneerからメールが届きます。この間、何度も画面を確認したり、アプリを開きっぱなしにする必要はありません。スマホを閉じて、ふだんどおり過ごして大丈夫です。準備ができるとPayoneerからメールで知らせが来るので、それまで待つだけでOKです。
        </p>
      </div>

      <p className="text-[12px] font-bold text-gray-700">① 「準備OK」メールが来たら出品解禁</p>
      <MailCard
        from={<PayoneerLogo />}
        subject="（例）本人確認が完了しました／アカウントが有効になりました"
        body="Payoneerでの本人確認（KYC）が終わり、アカウントが使える状態になったことを知らせる内容のメールです。これが出品解禁の合図です。差出人はPayoneerで、eBayではありません。"
        link="アカウントを確認する / Get started（ゲットスターテッド）"
      />
      <Warn>
        件名は環境によって変わります（「確認が完了」「アカウントが有効に」など）。差出人がPayoneer（ペイオニア）で、本人確認の完了やアカウントが使える状態を知らせる内容なら、それが合図です。このメールが届くまでは、アプリで「最終確認待ち」と出ても正常です。
        <br />
        ※先に別の「アカウント有効化／承認」メールが届くことがありますが、それでは出品できません。出品できるのは“本人確認（KYC）が完了しました”という内容のメールが届いてからです（どちらもPayoneerから届きます）。
      </Warn>

      <p className="text-[12px] font-bold text-gray-700">② アプリ（輸出ラボ）で出品！</p>
      <Phone>
        <Screen logo={<span className="font-black text-[13px] text-[#BF0000]">輸出ラボ</span>}>
          <p className="text-[12px] font-bold text-gray-800">eBay簡単出品</p>
          <p className="text-[11px] text-gray-500">写真だけで、そのまま公開できます</p>
          <Tap>
            <span className="inline-flex items-center justify-center h-9 px-5 rounded-full bg-[#BF0000] text-white text-[13px] font-bold">
              確認できた・出品する
            </span>
          </Tap>
        </Screen>
      </Phone>
      <p className="text-[12px] text-gray-600 leading-relaxed">
        メールが届いたら、アプリ（輸出ラボ）の「eBay簡単出品」→「確認できた・出品する」を押すと、そのまま公開されます。これ以降は1タップで出品できます。
      </p>

      <Link
        href="/guide/payoneer-withdraw"
        className="inline-flex items-center gap-1 text-[12px] font-bold text-[#0064D2] underline underline-offset-2"
      >
        💴 売れたら → 売上の受け取り（Payoneer出金）の方法はこちら
      </Link>
    </div>
  );
}

/* ── STEP定義 ── */

interface StepDef {
  title: string;
  // 完了後に折りたたみで見せる一言要約
  summary: string;
  body: React.ReactNode;
}

const STEPS: StepDef[] = [
  {
    title: "eBayで“出品”をはじめる",
    summary: "ログイン → Sell → 商品を選ぶ → Get started まで完了",
    body: <Step1Body />,
  },
  {
    title: "Payoneer（売上の受け取り口座）に登録",
    summary: "個人で登録 → 連絡先・口座を入力 → 申請 → メールで本人確認書類を提出",
    body: <Step2Body />,
  },
  {
    title: "eBayに戻って仕上げる",
    summary: "Sync → カード登録 → Submit。eBay側の入力は完了",
    body: <Step3Body />,
  },
  {
    title: "“準備OK”メールが来たら、アプリで出品！",
    summary: "Payoneerの完了メール → アプリで「確認できた・出品する」",
    body: <Step4Body />,
  },
];

const TOTAL = STEPS.length;
const STORAGE_KEY = "ebay_guide_step";

/* ── ステッパー本体 ── */

export default function EbaySellerStepper() {
  // ハイドレーション安全：初期値は 0 で描画し、マウント後に localStorage を反映する
  const [current, setCurrent] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  // 完了済みSTEPの開閉（見返し用）。キー＝STEP index
  const [openDone, setOpenDone] = useState<Record<number, boolean>>({});

  useEffect(() => {
    setHydrated(true);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n) && n >= 0 && n <= TOTAL) setCurrent(n);
      }
    } catch {
      /* localStorageが使えない環境でも初期値0で動く */
    }
  }, []);

  const persist = (n: number) => {
    setCurrent(n);
    try {
      localStorage.setItem(STORAGE_KEY, String(n));
    } catch {
      /* 保存できなくても進行はできる */
    }
  };

  const goNext = () => persist(Math.min(current + 1, TOTAL));
  const goPrev = () => persist(Math.max(current - 1, 0));
  const reset = () => {
    setOpenDone({});
    persist(0);
  };

  // 全STEP完了（current が範囲外＝最後の「次へ」を押した状態）
  const allDone = current >= TOTAL;
  const progressCount = Math.min(current, TOTAL);
  // 表示中のステップ番号（完了時はTOTAL）。進捗バーと「N/TOTAL」表記を常に一致させる。
  const displayStep = Math.min(progressCount + (allDone ? 0 : 1), TOTAL);
  const progressPct = Math.round((displayStep / TOTAL) * 100);

  return (
    <div className="space-y-3">
      {/* イントロ（常時表示） */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2.5">
        <p className="text-sm text-gray-700 leading-relaxed">
          eBayで<b>売上を受け取る</b>ための登録を、<b>順番に1つずつ</b>ご案内します。
          登録が必要なのは<b>初回だけ</b>。入力にかかる時間は10〜15分ほどです（このあと審査の待ち時間があります）。
        </p>
        <div className="bg-[#BF0000]/[0.04] border border-[#BF0000]/20 rounded-xl px-3 py-2.5">
          <p className="text-[12px] font-black text-gray-800 mb-1">
            操作のしかた（ここが大事）
          </p>
          <p className="text-[12px] text-gray-700 leading-relaxed">
            各STEPの作業が終わったら、画面を下にスクロールして、赤いボタン
            <b>「できた・次へ進む →」</b>を押してください。それで次のSTEPが開きます。
          </p>
        </div>
        <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
          <p className="text-[12px] font-black text-gray-800 mb-1">この登録は大きく4つです</p>
          <ul className="space-y-0.5 text-[12px] text-gray-700 leading-relaxed">
            <li>① eBayで出品をはじめる</li>
            <li>② 売上の受け取り口座（Payoneer〔ペイオニア〕）を作る</li>
            <li>③ eBayに戻って仕上げる</li>
            <li>④ 準備OKメールが来たら出品</li>
          </ul>
          <p className="text-[11.5px] text-gray-600 leading-relaxed mt-1.5">
            ②のあとに本人確認の審査（早ければ数分、長いと数日）があります。お金（カード・銀行口座）が必要になるのは②と③です。
          </p>
        </div>
        <div>
          <p className="text-[12px] font-black text-gray-800 mb-1.5">用意するもの</p>
          <ul className="space-y-1.5 text-[12.5px] text-gray-700">
            <li className="flex items-center gap-2">
              <Smartphone size={15} className="text-[#BF0000] shrink-0" /> スマホ（SMS認証コードを受け取る）
            </li>
            <li className="flex items-center gap-2">
              <CreditCard size={15} className="text-[#BF0000] shrink-0" /> 本人確認書類（マイナンバー／免許証／パスポート）
            </li>
            <li className="flex items-center gap-2">
              <Landmark size={15} className="text-[#BF0000] shrink-0" /> 受け取り用の銀行口座（支店コード・SWIFTコードを聞かれることあり）
            </li>
            <li className="flex items-center gap-2">
              <CreditCard size={15} className="text-[#BF0000] shrink-0" /> 手数料用のカード1枚（VISA／Master）
            </li>
          </ul>
        </div>
        <p className="text-[11.5px] text-[#BF0000] font-bold leading-relaxed">
          名前・住所は<b>ローマ字</b>で、<b>身分証と完全一致</b>に。ここがズレると審査で止まります。
        </p>
      </div>

      {/* 進捗表示 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[12.5px] font-black text-gray-800">
            ステップ {displayStep} / {TOTAL}
            {allDone && <span className="ml-1 text-emerald-600">（完了！）</span>}
          </p>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600"
          >
            <RotateCcw size={12} /> 最初から
          </button>
        </div>
        <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-[#BF0000] transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* STEP一覧 */}
      {STEPS.map((step, i) => {
        const n = i + 1;
        const isCurrent = hydrated ? i === current : i === 0;
        const isDone = hydrated ? i < current : false;
        const isLocked = hydrated ? i > current : i > 0;

        // 完了STEP（折りたたみ・押すと開閉）
        if (isDone) {
          const open = !!openDone[i];
          return (
            <section key={i} className="bg-white rounded-2xl border border-emerald-200 shadow-sm overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenDone((s) => ({ ...s, [i]: !s[i] }))}
                className="w-full flex items-center gap-2.5 px-4 py-3 text-left"
              >
                <span className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0">
                  <Check size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-black text-gray-800 leading-snug">
                    STEP {n}. {step.title}
                  </span>
                  <span className="block text-[11px] text-gray-500 leading-snug mt-0.5">{step.summary}</span>
                </span>
                <ChevronDown
                  size={18}
                  className={`text-gray-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                />
              </button>
              {open && <div className="px-4 pb-4 pt-1 border-t border-gray-100">{step.body}</div>}
            </section>
          );
        }

        // 現在のSTEP（展開・全詳細＋進むボタン）
        if (isCurrent) {
          const isLast = i === TOTAL - 1;
          return (
            <section
              key={i}
              className="bg-white rounded-2xl border-2 border-[#BF0000]/40 shadow-sm overflow-hidden"
            >
              <div className="flex items-center gap-2.5 px-4 py-3 bg-[#BF0000]">
                <span className="w-7 h-7 rounded-full bg-white text-[#BF0000] flex items-center justify-center text-sm font-black shrink-0">
                  {n}
                </span>
                <h2 className="text-[14px] font-black text-white leading-snug">{step.title}</h2>
              </div>
              <div className="p-4 space-y-3">
                {step.body}

                <div className="flex items-center gap-2 pt-1">
                  {i > 0 && (
                    <button
                      type="button"
                      onClick={goPrev}
                      className="inline-flex items-center gap-1 h-10 px-3 rounded-full border border-gray-200 text-[12px] font-bold text-gray-500 active:bg-gray-50"
                    >
                      <ArrowLeft size={14} /> 1つ前にもどる
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={goNext}
                    className="flex-1 inline-flex items-center justify-center h-11 px-5 rounded-full bg-[#BF0000] text-white text-[13.5px] font-black active:bg-[#9E0000]"
                  >
                    {isLast ? "ガイドを終わる" : "できた・次へ進む →"}
                  </button>
                </div>
              </div>
            </section>
          );
        }

        // 未到達STEP（鍵・タイトルのみ・中身は描画しない）
        void isLocked;
        return (
          <section
            key={i}
            aria-disabled="true"
            className="bg-gray-50 rounded-2xl border border-gray-100 shadow-sm px-4 py-3 opacity-70"
          >
            <div className="flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-full bg-gray-200 text-gray-400 flex items-center justify-center shrink-0">
                <Lock size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-black text-gray-400 leading-snug">
                  STEP {n}. {step.title}
                </span>
                <span className="block text-[11px] text-gray-400 leading-snug mt-0.5">
                  前のSTEPが終わると開きます
                </span>
              </span>
            </div>
          </section>
        );
      })}

      {/* 全STEP完了の締め */}
      {allDone && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <Check size={16} />
            </span>
            <h2 className="text-[14px] font-black text-emerald-800">セラー登録ガイドは以上です</h2>
          </div>
          <p className="text-[13px] text-emerald-800 leading-relaxed">
            あとはPayoneerの「準備OK」メールを待って、アプリ（輸出ラボ）の「eBay簡単出品」から出品するだけです。
            見返したいSTEPは上の各カードを押すと開けます。
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Link
              href="/guide"
              className="inline-flex items-center gap-1 h-10 px-4 rounded-full bg-[#BF0000] text-white text-[12.5px] font-black active:bg-[#9E0000]"
            >
              <ArrowLeft size={14} /> ガイド一覧にもどる
            </Link>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 h-10 px-4 rounded-full border border-gray-200 text-[12.5px] font-bold text-gray-500 active:bg-gray-50"
            >
              <RotateCcw size={13} /> 最初から見直す
            </button>
          </div>
        </div>
      )}

      {/* つまずき集（常時表示） */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <h2 className="text-[13px] font-black text-gray-800 mb-2.5">よくあるつまずき</h2>
        <ul className="space-y-2 text-[12px] text-gray-700 leading-relaxed">
          <li>
            🔴 <b>「次へ」が押せない</b> → 住所を<b>確定</b>し、<b>City（都市名）</b>を入力、電話番号は<b>先頭の0を取る</b>。この3つでほぼ解決します（STEP2）。
          </li>
          <li>
            🔴 <b>「出品できませんでした」と長いエラー</b> → 実は<b>本人確認（KYC）の審査待ち</b>で、正常です。<b>準備OKメール</b>が届いてから再出品すればOK（STEP4）。
          </li>
          <li>
            🔴 <b>承認メールが来たのに出品できない</b> → それは早い方の<b>有効化メール</b>かも。出品解禁は<b>本人確認（KYC）完了メール</b>のほうです。どちらもPayoneerからですが別物です。
          </li>
          <li>
            🔴 <b>メールが見つからない</b> → <b>迷惑メールフォルダ</b>を確認。差出人（Payoneer）で検索すると早く見つかります。
          </li>
        </ul>
      </div>

      {/* 免責注記 */}
      <p className="text-center text-[11px] text-gray-400 pt-2 pb-6">
        ※ 画面は分かりやすさのための再現イラストです（入力例はすべてダミー）。eBayやPayoneer（ペイオニア）の実際の画面・メールの件名は、時期や環境によって細部が異なる場合があります。
      </p>
    </div>
  );
}
