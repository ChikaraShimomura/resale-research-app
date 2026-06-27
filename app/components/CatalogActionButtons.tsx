"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, X, Undo2, Share2 } from "lucide-react";

// 中古カタログ各カードの小さな triage ボタン。「仕入れた」「これは無理」を per-actor で記録して一覧から外す＋「共有」でリンク共有。
// 「仕入れた」時はサーバーが仕入れ元の在庫を確認：まだ在庫ありなら基本は蹴る（カタログから消さない）。
// 無在庫転売プラン(canAutoList=プロMAX/身内/管理者)の人だけ在庫ありでも登録でき、その人の画面からのみ非表示になる。
export default function CatalogActionButtons({
  productId,
  buyJpy,
  isAdmin = false,
  canAutoList = false,
  teamOwner,
  shareUrl,
  shareTitle,
}: {
  productId: string;
  buyJpy: number;
  isAdmin?: boolean;
  canAutoList?: boolean;
  teamOwner?: string; // チーム共有モードで「オーナーのデータ」に仕入れる時のオーナーactor
  shareUrl?: string; // 共有するリンク（仕入れ元の商品URL）
  shareTitle?: string; // 共有時のタイトル（商品名）
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"bought" | "skip" | "undo" | null>(null);
  const [done, setDone] = useState<"bought" | "skip" | null>(null);
  const [inStock, setInStock] = useState(false); // 無在庫プランの人が在庫ありを登録した＝無在庫転売
  const [blocked, setBlocked] = useState(false); // 在庫あり＋無在庫プラン無し＝蹴った（記録せずカタログに残す）
  const [shared, setShared] = useState(false); // リンクをコピーした（共有API非対応時）
  const [err, setErr] = useState<string | null>(null);

  // confirmedBought: 在庫ありで一度蹴られた後、本人が「もう仕入れ済み（在庫表示が古い）」と明示確認した時だけ true で再送。
  const post = async (action: "bought" | "skip" | "undo", confirmedBought = false) => {
    setBusy(action);
    setErr(null);
    setBlocked(false);
    try {
      const res = await fetch("/api/catalog/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 「仕入れた」は仕入れ値も送って収支の累計に乗せる（skip/undoでは無視される）。teamOwner指定時はオーナーのデータへ。
        body: JSON.stringify({ action, productId, buyJpy, teamOwner, confirmedBought }),
      }).then((r) => r.json());
      if (res.ok) {
        if (action === "undo") {
          setDone(null);
          setInStock(false);
          router.refresh(); // 印を消してカタログに戻す
        } else if (action === "bought") {
          if (res.added === false && res.needsPlan) {
            setBlocked(true); // 在庫あり＝無在庫転売→蹴った。カタログに残す（done にしない）。
          } else {
            setInStock(res.availability === "in-stock"); // 在庫ありでも登録できた＝無在庫プランの人
            setDone("bought"); // カードはこのセッションは残し、次回読込でサーバーが非表示にする
          }
        } else {
          setDone(action); // skip（非表示）
        }
      } else {
        setErr(res.error || "操作に失敗しました。");
      }
    } catch {
      setErr("通信エラーで操作できませんでした。");
    }
    setBusy(null);
  };

  // 共有：Web Share API（対応端末は標準の共有シート）→ 非対応はクリップボードへコピー。
  const share = async () => {
    const url = shareUrl || (typeof window !== "undefined" ? window.location.href : "");
    const title = shareTitle || "利益が出る中古品";
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title, url });
      } else if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setShared(true);
        setTimeout(() => setShared(false), 1500);
      } else if (typeof window !== "undefined") {
        window.prompt("このリンクをコピーして共有してください", url); // 共有API/クリップボード非対応端末のフォールバック
      }
    } catch {
      /* ユーザーがキャンセル/失敗は無視 */
    }
  };

  if (done) {
    return (
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5">
          <span className="text-[11px] font-bold text-gray-600">
            {done === "bought" ? (
              <span className="whitespace-nowrap">✓「仕入れ商品」に追加しました</span>
            ) : (
              <>
                <span className="whitespace-nowrap">非表示にしました</span><wbr />
                <span className="whitespace-nowrap">（次回から表示されません）</span>
              </>
            )}
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
        {done === "bought" && inStock && (
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

      <div className="flex gap-1.5">
        <button
          onClick={() => post("bought")}
          disabled={busy !== null}
          className="flex-1 inline-flex items-center justify-center gap-1 h-11 rounded-lg bg-emerald-600 text-white text-[12px] font-bold disabled:opacity-40 active:bg-emerald-700"
        >
          <Check size={14} /> 仕入れた
        </button>
        {/* 管理者は「これは無理」(カタログ全体の判断用)、他ユーザーは「非表示」。動作は同じ＝そのユーザーに非表示。
            ※ 1行に統一（旧：小さな「(無理と判断)」を2行目に折り返していて見栄えが悪かった）。 */}
        <button
          onClick={() => post("skip")}
          disabled={busy !== null}
          className="flex-1 inline-flex items-center justify-center gap-1 h-11 rounded-lg border border-gray-300 bg-white text-gray-500 text-[12px] font-bold disabled:opacity-40 active:bg-gray-50"
        >
          <X size={13} /> {isAdmin ? "これは無理" : "非表示"}
        </button>
        {/* 共有＝この商品のリンクを共有シート/コピーで送る（仲間・チームに教える）。 */}
        <button
          onClick={share}
          aria-label="共有（リンクを送る）"
          className="shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-lg border border-gray-300 bg-white text-gray-500 active:bg-gray-50"
        >
          <Share2 size={16} />
        </button>
      </div>
      {shared && <p className="text-[10px] text-emerald-600 font-bold">リンクをコピーしました</p>}
      {err && <p className="mt-1 text-[10px] text-rose-600">{err}</p>}
    </div>
  );
}
