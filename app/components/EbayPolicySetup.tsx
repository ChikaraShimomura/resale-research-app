"use client";
import { useEffect, useRef, useState } from "react";
import { BadgeCheck, AlertTriangle } from "lucide-react";
import ReportableError from "./ReportableError";
import { SHIP_TIER_USD } from "../lib/ebay/landedCost"; // 既定送料のSSOT（landedCostと一致＝利益計算の前提と揃う）

interface StepResult {
  step: string;
  ok: boolean;
  error?: string;
  known?: boolean;
  errorDetail?: string;
}

// 送料の目安は日本郵便・米国宛の実費ベース：小=軽量エアパケット(〜500g≒¥2,040≒$14)／
// 中=〜1.2kg(≒¥3,500≒$23)／大=2kgやEMS・高額品(補償付き・$25〜)。アプリが商品の重さ・価格で自動選択する。
const SIZE_FIELDS = [
  { key: "small", label: "小（〜500g・軽量）の送料（USD）", placeholder: String(SHIP_TIER_USD.small) },
  { key: "medium", label: "中（〜1.2kg）の送料（USD）", placeholder: String(SHIP_TIER_USD.medium) },
  { key: "large", label: "大（2kgやEMS・高額品）の送料（USD）", placeholder: String(SHIP_TIER_USD.large) },
] as const;

// 送料の既定値（USD）。送り先の国に関わらず同じ料金で、サイズで料金が変わる。ユーザー入力は任意で、最初からこの値が入る。
// 既定は日本郵便・米国宛の実費に合わせた目安（赤字を出さない安全側）＝landedCostのSSOT(SHIP_TIER_USD)と一致。
const DEFAULTS: Record<string, string> = {
  handlingDays: "7",
  small: String(SHIP_TIER_USD.small),
  medium: String(SHIP_TIER_USD.medium),
  large: String(SHIP_TIER_USD.large),
};

// 発送先は sellApi 側で Worldwide（全世界）固定。国別ホワイトリストは EBAY_US で 216347 により
// AU/GB/CA/DE/FR の5カ国に縮退し、対象外の買い手に「見積もり依頼」を出す原因になるため廃止。

export default function EbayPolicySetup({ onDone }: { onDone?: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({ ...DEFAULTS });
  const [showAdvanced, setShowAdvanced] = useState(false); // 詳細オプション（変更したい人だけ）
  // 返品：規定で受け付ける（30日・返送料は買い手負担）。eBayは30日返品可を検索/Top Rated で優遇＝売れやすい。
  const [returnsAccepted, setReturnsAccepted] = useState(true);
  // 送料無料(送料込み)ポリシーも作る。規定ON＝出品/編集の「送料込み」トグルが使えるようになる。
  const [freeShipping, setFreeShipping] = useState(true);
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [msg, setMsg] = useState("");
  const [errKind, setErrKind] = useState<"known" | "unexpected" | undefined>(undefined);
  const [errDetail, setErrDetail] = useState<string | undefined>(undefined);
  // 成功後の onDone 遅延発火タイマー。アンマウント/再submitで確実にクリアする。
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (doneTimer.current) clearTimeout(doneTimer.current);
  }, []);

  const submit = async () => {
    // 送料は半角数字(>0)のみ。非数値/全角があれば送信前に弾く（サーバーでも再検証）。
    const sizeVals = SIZE_FIELDS.map((f) => String(vals[f.key] ?? "").trim()).filter((v) => v !== "");
    if (sizeVals.length === 0 || sizeVals.some((v) => !(Number(v) > 0))) {
      setState("error");
      setMsg("送料は半角数字で1つ以上入力を（例: 12）。");
      return;
    }
    if (doneTimer.current) {
      clearTimeout(doneTimer.current);
      doneTimer.current = null;
    }
    setState("saving");
    setMsg("");
    setSteps([]);
    try {
      const res = await fetch("/api/ebay/setup-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handlingDays: Number(vals.handlingDays) || 7,
          small: vals.small,
          medium: vals.medium,
          large: vals.large,
          returnsAccepted,
          returnDays: 30,
          freeShipping,
        }),
      });
      const j = await res.json();
      if (Array.isArray(j.steps)) setSteps(j.steps);
      setErrKind(j.errorKind);
      setErrDetail(
        Array.isArray(j.steps)
          ? j.steps.filter((s: StepResult) => !s.ok).map((s: StepResult) => `${s.step}: ${s.errorDetail || s.error || ""}`).join(" | ")
          : undefined
      );
      if (j.ok) {
        setState("done");
        setMsg("送料・支払い・返品を登録しました。");
        doneTimer.current = setTimeout(() => {
          doneTimer.current = null;
          onDone?.();
        }, 1200);
      } else {
        setState("error");
        setMsg(j.error || "一部の登録に失敗しました。下の結果を確認してください。");
      }
    } catch {
      setState("error");
      setMsg("通信に失敗しました。時間をおいて再度お試しを。");
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-gray-500 leading-relaxed">
        <span className="whitespace-nowrap">送料・支払い・返品は</span><wbr />
        <span className="whitespace-nowrap"><b className="text-gray-700">おすすめ設定で自動登録</b>。</span><wbr />
        <span className="whitespace-nowrap">基本はこのままボタンを押すだけ。</span><wbr />
        <span className="whitespace-nowrap">変えたい人は「詳細オプション」へ。</span>
      </p>

      {/* おすすめ設定サマリー（読むだけ・変更は詳細オプションで） */}
      <div className="bg-[#F5F7FA] rounded-xl border border-[#A98B5C]/25 p-4 text-[12px] text-gray-600 space-y-2">
        <p className="text-[11px] font-black text-[#2D323B]">おすすめ設定（このまま登録でOK）</p>
        <div className="flex justify-between gap-3"><span className="text-gray-500 shrink-0">送料</span><span className="font-bold text-gray-800 text-right tabular-nums">サイズで自動（<span className="whitespace-nowrap">小約¥{Math.round(Number(vals.small) * 155).toLocaleString("ja-JP")}</span>・<span className="whitespace-nowrap">中約¥{Math.round(Number(vals.medium) * 155).toLocaleString("ja-JP")}</span>・<span className="whitespace-nowrap">大約¥{Math.round(Number(vals.large) * 155).toLocaleString("ja-JP")}</span>／購入者負担）</span></div>
        <div className="flex justify-between gap-3"><span className="text-gray-500 shrink-0">送料無料（送料込み）</span><span className="font-bold text-gray-800">{freeShipping ? "使える（おすすめ）" : "作らない"}</span></div>
        <div className="flex justify-between gap-3"><span className="text-gray-500 shrink-0">発送先</span><span className="font-bold text-gray-800 text-right whitespace-nowrap">全世界（アメリカ＋世界中）</span></div>
        <div className="flex justify-between gap-3"><span className="text-gray-500 shrink-0">返品</span><span className="font-bold text-gray-800">{returnsAccepted ? "30日OK（売れやすい）" : "なし"}</span></div>
        <div className="flex justify-between gap-3"><span className="text-gray-500 shrink-0">発送まで</span><span className="font-bold text-gray-800">{vals.handlingDays}日</span></div>
      </div>

      <button
        onClick={submit}
        disabled={state === "saving"}
        className="w-full h-12 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23] disabled:opacity-50"
      >
        {state === "saving" ? "登録中..." : "おすすめ設定で登録する"}
      </button>

      {/* 詳細オプション（変更したい人だけ）。送料・発送先・送料無料・返品・発送日数をここに集約。 */}
      <div className="border-t border-[#A98B5C]/20 pt-3">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center justify-between w-full text-[12px] text-gray-500 active:text-gray-700"
        >
          <span>詳細オプション（変更したい人だけ）</span>
          <span className="text-gray-400">{showAdvanced ? "閉じる ▲" : "開く ▼"}</span>
        </button>

        {showAdvanced && (
          <div className="space-y-5 mt-4">
            {/* 送料・発送日数 */}
            <div className="space-y-2.5">
              <p className="text-[12px] font-bold text-gray-700">送料（サイズ別・USD）</p>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                <span className="whitespace-nowrap">購入者負担。出品時に重さ・価格から</span><wbr />
                <span className="whitespace-nowrap">小/中/大を自動選択</span><wbr />
                <span className="whitespace-nowrap">（目安は日本郵便・米国宛の実費）。</span>
              </p>
              <div>
                <label className="block text-[12px] text-gray-500 mb-1">発送までの日数（注文から発送まで）</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={vals.handlingDays ?? ""}
                  onChange={(e) => setVals((v) => ({ ...v, handlingDays: e.target.value }))}
                  placeholder="7"
                  className="w-full h-11 px-3 rounded-xl border border-[#A98B5C]/35 text-sm focus-visible:ring-2 focus-visible:ring-[#2D323B]/40 focus:border-[#2D323B]"
                />
              </div>
              {SIZE_FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="block text-[12px] text-gray-500 mb-1">{f.label}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={vals[f.key] ?? ""}
                    onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full h-11 px-3 rounded-xl border border-[#A98B5C]/35 text-sm focus-visible:ring-2 focus-visible:ring-[#2D323B]/40 focus:border-[#2D323B]"
                  />
                </div>
              ))}
            </div>

            {/* 発送先（全世界固定・eBayの「見積もり依頼」を出さないため） */}
            <div className="space-y-1.5">
              <p className="text-[12px] font-bold text-gray-700">発送先</p>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                <span className="whitespace-nowrap">アメリカ＋世界中（Worldwide）に発送。</span><wbr />
                <span className="whitespace-nowrap">国を絞ると一部の国に「送料見積もり依頼」が</span><wbr />
                <span className="whitespace-nowrap">出て売れないため、全世界で固定しています。</span>
              </p>
            </div>

            {/* 送料無料（送料込み）ポリシー */}
            <div className="space-y-1.5">
              <p className="text-[12px] font-bold text-gray-700">送料無料（送料込み）</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={freeShipping}
                  onChange={(e) => setFreeShipping(e.target.checked)}
                  className="accent-[#2D323B] w-4 h-4 focus-visible:ring-2 focus-visible:ring-[#2D323B]/40"
                />
                <span className="text-[12px] text-gray-700">送料無料（送料込み）のポリシーも作る</span>
              </label>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                <span className="whitespace-nowrap">出品/編集で「送料込み」に切替可</span><wbr />
                <span className="whitespace-nowrap">（送料を価格に含め買い手の送料は$0）。</span><wbr />
                <span className="whitespace-nowrap">eBayの「送料無料」表示で売れやすい。</span>
              </p>
            </div>

            {/* 返品ポリシー */}
            <div className="space-y-1.5">
              <p className="text-[12px] font-bold text-gray-700">返品</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={returnsAccepted}
                  onChange={(e) => setReturnsAccepted(e.target.checked)}
                  className="accent-[#2D323B] w-4 h-4 focus-visible:ring-2 focus-visible:ring-[#2D323B]/40"
                />
                <span className="text-[12px] text-gray-700">返品を受け付ける（30日・返送料は買い手負担）</span>
              </label>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                {returnsAccepted ? (
                  <>
                    <span className="whitespace-nowrap">30日以内の返品OK（返送料は買い手負担）。</span><wbr />
                    <span className="whitespace-nowrap">安心感で売れやすい反面、</span><wbr />
                    <span className="whitespace-nowrap">対応の手間は増えます。</span>
                  </>
                ) : (
                  "返品不可で登録。"
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      {steps.length > 0 && (
        <ul className="space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px]">
              {s.ok ? (
                <BadgeCheck size={16} className="text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
              )}
              <span className={s.ok ? "text-gray-700" : "text-gray-600"}>
                {s.step}
                {!s.ok && s.error ? `：${s.error}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {state === "error" && errKind === "unexpected" && (
        <ReportableError message="一部の設定で予期せぬエラーが発生しました。" errorKind="unexpected" errorDetail={errDetail} where="ebay_policy" className="mt-1" />
      )}

      {msg && (
        // 成否メッセージはスクリーンリーダーへ即時通知（エラー/結果の見落とし防止）
        <p
          role="alert"
          aria-live="assertive"
          className={`text-[12px] font-bold ${state === "done" ? "text-emerald-600" : "text-[#2D323B]"}`}
        >
          {msg}
        </p>
      )}
    </div>
  );
}
