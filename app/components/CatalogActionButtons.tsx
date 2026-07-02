"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Undo2, Eye, ExternalLink } from "lucide-react";
import { reportClientError, errToDetail } from "../lib/clientError";
import DropshipListButton from "./DropshipListButton";

// 中古カタログ各カードの小さな triage ボタン。「仕入れた」を per-actor で記録して一覧から外す＋
// 「ライバル確認」(eBayの現行出品＝今のライバルを見る)＋「無在庫出品」(プロMAX以上・先に買わずeBay出品)。
// 「仕入れた」時はサーバーが仕入れ元の在庫を確認：まだ在庫ありなら基本は蹴る（カタログから消さない）。
// 無在庫転売プラン(canAutoList=プロMAX/身内/管理者)の人だけ在庫ありでも登録でき、その人の画面からのみ非表示になる。
// ※「これは無理/非表示」(skip)ボタンは使用頻度が低く2026-06-30に撤去（unfav/再読込で代替）。
export default function CatalogActionButtons({
  productId,
  buyJpy,
  canAutoList = false,
  canDropship = false,
  teamOwner,
  shareTitle,
  sourceUrl,
  soldUrl,
  rivalsUrl,
}: {
  productId: string;
  buyJpy: number;
  isAdmin?: boolean; // 旧skipボタンの文言出し分け用。skip撤去で未使用だが呼び出し側の互換のため受ける。
  canAutoList?: boolean;
  canDropship?: boolean; // 無在庫出品（先に買わずeBay出品）を実行できるか＝プロMAX以上（身内/管理者含む）。未満はボタン押下でプラン誘導。
  teamOwner?: string; // チーム共有モードで「オーナーのデータ」に仕入れる時のオーナーactor
  shareTitle?: string; // 商品名（無在庫出品モーダルのタイトルに使う）
  sourceUrl?: string; // 仕入れ元の商品ページURL（「仕入れ元確認」ボタン）。上段左。
  soldUrl?: string; // eBayの落札検索URL（「eBay落札確認」ボタン）。下段左。
  rivalsUrl?: string; // eBayの「今出品されているライバル(現行出品)」検索URL（「eBayライバル確認」ボタン）。下段中。
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"bought" | "undo" | null>(null);
  const [done, setDone] = useState(false); // 「仕入れ商品」に追加済み（このセッション表示）
  const [inStock, setInStock] = useState(false); // 無在庫プランの人が在庫ありを登録した＝無在庫転売
  const [blocked, setBlocked] = useState(false); // 在庫あり＋無在庫プラン無し＝蹴った（記録せずカタログに残す）
  const [err, setErr] = useState<string | null>(null);

  // confirmedBought: 在庫ありで一度蹴られた後、本人が「もう仕入れ済み（在庫表示が古い）」と明示確認した時だけ true で再送。
  const post = async (action: "bought" | "undo", confirmedBought = false) => {
    setBusy(action);
    setErr(null);
    setBlocked(false);
    try {
      const res = await fetch("/api/catalog/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 「仕入れた」は仕入れ値も送って収支の累計に乗せる（undoでは無視される）。teamOwner指定時はオーナーのデータへ。
        body: JSON.stringify({ action, productId, buyJpy, teamOwner, confirmedBought }),
      }).then((r) => r.json());
      if (res.ok) {
        if (action === "undo") {
          setDone(false);
          setInStock(false);
          router.refresh(); // 印を消してカタログに戻す
        } else if (res.added === false && res.needsPlan) {
          setBlocked(true); // 在庫あり＝無在庫転売→蹴った。カタログに残す（done にしない）。
        } else {
          setInStock(res.availability === "in-stock"); // 在庫ありでも登録できた＝無在庫プランの人
          setDone(true); // カードはこのセッションは残し、次回読込でサーバーが非表示にする
        }
      } else {
        if (res.errorKind !== "known") reportClientError("catalog_action", { action: `catalog_${action}`, endpoint: "/api/catalog/action", status: 0, detail: res.errorDetail || res.error || "(no detail)", productId });
        setErr(res.error || "操作に失敗しました。");
      }
    } catch (e) {
      reportClientError("catalog_action", { action: `catalog_${action}`, endpoint: "/api/catalog/action", status: 0, detail: `fetch例外: ${errToDetail(e)}`, productId });
      setErr("通信エラーで操作できませんでした。");
    }
    setBusy(null);
  };

  if (done) {
    return (
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5">
          <span className="text-[11px] font-bold text-gray-600">
            <span className="whitespace-nowrap">✓「仕入れ商品」に追加しました</span>
          </span>
          <button
            onClick={() => post("undo")}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0064D2] disabled:opacity-40"
          >
            <Undo2 size={12} /> 元に戻す
          </button>
        </div>
        {/* 無在庫プランの人が在庫ありを登録＝無在庫転売。カタログ自体は消さず、本人/チームの画面からのみ非表示。 */}
        {inStock && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2">
            <p className="text-[11px] font-bold text-amber-800 leading-relaxed">
              <span className="whitespace-nowrap">⚠️ 在庫ありのまま登録</span><wbr />
              <span className="whitespace-nowrap">（無在庫転売）</span>
            </p>
            <p className="text-[10px] text-amber-700 leading-relaxed mt-0.5">
              <span className="whitespace-nowrap">仕入れ元にまだ在庫がある商品です。</span><wbr />
              <span className="whitespace-nowrap"><b>あなた（チーム）の画面からのみ非表示</b>になり、</span><wbr />
              <span className="whitespace-nowrap">カタログ自体には残ります。</span><wbr />
              <span className="whitespace-nowrap">欠品・価格変動・eBay規約違反の</span><wbr />
              <span className="whitespace-nowrap">リスクにご注意ください。</span>
            </p>
          </div>
        )}
      </div>
    );
  }

  // 下段の列数＝eBay落札確認(任意)＋eBayライバル確認(任意)＋無在庫出品(常設) の個数に合わせる。
  const row2n = (soldUrl ? 1 : 0) + (rivalsUrl ? 1 : 0) + 1;
  const row2Cols = row2n >= 3 ? "grid-cols-3" : row2n === 2 ? "grid-cols-2" : "grid-cols-1";

  return (
    <div className="mt-2 space-y-1.5">
      {/* 在庫ありを「仕入れた」＝無在庫転売で蹴られた時の案内＋無在庫転売プラン誘導。 */}
      {blocked && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2">
          <p className="text-[11px] font-bold text-amber-800 leading-relaxed">
            <span className="whitespace-nowrap">⚠️ まだ仕入れ元に</span><wbr />
            <span className="whitespace-nowrap">在庫があります</span>
          </p>
          <p className="text-[10px] text-amber-700 leading-relaxed mt-0.5">
            <span className="whitespace-nowrap">在庫が残っている＝</span><wbr />
            <span className="whitespace-nowrap"><b>まだ実際に仕入れていない</b>状態です。</span><wbr />
            <span className="whitespace-nowrap">在庫がある商品をeBayに出すのは</span><wbr />
            <span className="whitespace-nowrap"><b>無在庫転売</b>で、</span><wbr />
            <span className="whitespace-nowrap">欠品・価格変動・eBay規約違反</span><wbr />
            <span className="whitespace-nowrap">（出品取消で評価低下）の</span><wbr />
            <span className="whitespace-nowrap">リスクがあります。</span><wbr />
            <span className="whitespace-nowrap">本当に仕入れ済みなら、</span><wbr />
            <span className="whitespace-nowrap"><b>仕入れ元が売り切れになってから</b></span><wbr />
            <span className="whitespace-nowrap">押してください。</span>
          </p>
          <Link href="/pricing?from=catalog" className="mt-1.5 inline-block text-[11px] font-bold text-[#2D323B] underline underline-offset-2">
            <span className="whitespace-nowrap">※ どうしても無在庫で出すなら</span><wbr />
            <span className="whitespace-nowrap"><b>無在庫転売プラン（プロMAX）</b></span><wbr />
            <span className="whitespace-nowrap">→ プランを見る</span>
          </Link>
          {/* 正直な買い手の救済（控えめな副導線）：実際にもう買った人だけが押す。在庫表示が古いだけのケースを自己申告で通す。 */}
          <button
            onClick={() => post("bought", true)}
            disabled={busy !== null}
            className="mt-1.5 block text-[10px] text-amber-700 underline underline-offset-2 disabled:opacity-40"
          >
            <span className="whitespace-nowrap">はい、もう仕入れ済みです</span><wbr />
            <span className="whitespace-nowrap">（在庫表示が古い）</span>
          </button>
        </div>
      )}

      {/* 上段：仕入れ元確認・仕入れた */}
      <div className={`grid ${sourceUrl ? "grid-cols-2" : "grid-cols-1"} gap-1.5`}>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="nofollow noopener noreferrer"
            className="inline-flex flex-col items-center justify-center gap-0.5 h-10 rounded-lg bg-[#2D323B] text-white text-[11px] font-bold leading-tight active:bg-[#1A1D23]"
          >
            <ExternalLink size={15} /> <span>仕入れ元確認</span>
          </a>
        )}
        <button
          onClick={() => post("bought")}
          disabled={busy !== null}
          className="inline-flex flex-col items-center justify-center gap-0.5 h-10 rounded-lg bg-emerald-600 text-white text-[11px] font-bold disabled:opacity-40 active:bg-emerald-700 leading-tight"
        >
          <Check size={16} /> <span>仕入れた</span>
        </button>
      </div>
      {/* 下段：eBay落札確認・eBayライバル確認・無在庫出品 */}
      <div className={`grid ${row2Cols} gap-1.5`}>
        {soldUrl && (
          <a
            href={soldUrl}
            target="_blank"
            rel="nofollow noopener noreferrer"
            className="inline-flex flex-col items-center justify-center gap-0.5 h-10 rounded-lg border border-[#0064D2] bg-white text-[#0064D2] text-[10px] font-bold leading-tight active:bg-[#0064D2]/5"
          >
            <ExternalLink size={14} /> <span>eBay落札確認</span>
          </a>
        )}
        {/* 今出品されているライバル（eBay現行出品）を新規タブで確認。仕入れ前に競合の数・最安値を見て判断できる。 */}
        {rivalsUrl && (
          <a
            href={rivalsUrl}
            target="_blank"
            rel="nofollow noopener noreferrer"
            className="inline-flex flex-col items-center justify-center gap-0.5 h-10 rounded-lg border border-gray-300 bg-white text-gray-600 text-[10px] font-bold leading-tight active:bg-gray-50"
          >
            <Eye size={14} /> <span>eBayライバル確認</span>
          </a>
        )}
        {/* 無在庫出品＝先に買わずeBayへ出品（売れてから仕入れて発送）。プロMAX以上のみ実行可（未満はプラン誘導・サーバーでも再判定）。 */}
        <DropshipListButton productId={productId} title={shareTitle || ""} canDropship={canDropship} onBehalfOf={teamOwner} />
      </div>
      {err && <p className="mt-1 text-[10px] text-rose-600">{err}</p>}
    </div>
  );
}
