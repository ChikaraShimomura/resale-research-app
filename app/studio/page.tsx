import type { Metadata } from "next";
import Link from "next/link";
import { getTopProfitProducts } from "../lib/topProducts";
import BottomNav from "../components/BottomNav";
import CopyText from "../components/CopyText";
import { Download } from "lucide-react";

// 運営者向けの「動画素材スタジオ」。今日の利益商品ごとに、縦型カード(動画用)＋台本＋キャプションを用意。
// 公開だが検索除外(noindex)。中身は公開データ(商品)のみ。
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "動画素材スタジオ｜輸出ラボ",
  robots: { index: false },
};

const yen = (n: number) => "¥" + Math.round(n || 0).toLocaleString("ja-JP");

// 縦型カード画像のURL(=/api/card?v=1...)。
function cardUrl(name: string, raku: number, ebay: number, rate: number): string {
  const q = new URLSearchParams({
    v: "1",
    t: "今日の利益商品",
    n: name.slice(0, 56),
    r: String(Math.round(raku || 0)),
    e: String(Math.round(ebay || 0)),
    p: String(rate || 0),
  });
  return `/api/card?${q.toString()}`;
}

// 15〜20秒の台本(断定なし・想定/目安)。
function script(raku: number, ebay: number, rate: number): string {
  return [
    `日本で${yen(raku)}のこの商品、海外では${yen(ebay)}くらいで取引。`,
    `手数料・送料を引いても、想定利益率はおよそ${rate}パーセント。`,
    `日本にしかない物が、海外ではこの値段に。`,
    `※利益は想定・目安です。`,
    `他の利益商品も登録すれば毎日チェック（30日無料）。リンクはプロフィールから。`,
  ].join("\n");
}

// 動画投稿用キャプション(Shorts/TikTok/Reels)。
function caption(raku: number, ebay: number, rate: number): string {
  return [
    `今日の利益商品💹`,
    `楽天 ${yen(raku)} → eBay想定 ${yen(ebay)}（想定利益率 ${rate}%）`,
    ``,
    `日本→海外の輸出転売。利益が出やすい商品を毎日チェック（登録で30日無料）。`,
    `※数字は想定・目安です`,
    `▶ プロフィールのリンクから`,
    ``,
    `#eBay輸出 #物販 #副業 #せどり #楽天ポイントせどり`,
  ].join("\n");
}

export default async function StudioPage() {
  const items = await getTopProfitProducts(15);

  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header className="bg-gradient-to-r from-[#2D323B] to-[#1A1D23] shadow-sm sticky top-0 z-20"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <Link href="/" aria-label="トップへ"
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/20 text-white text-lg font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <span className="text-white font-black text-base tracking-tight">動画素材スタジオ</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5">
        <div className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-4 mb-3">
          <h1 className="text-[15px] font-black text-gray-900 mb-1">今日の利益商品で動画素材をつくる</h1>
          <p className="text-[12px] text-gray-500 leading-relaxed">
            各商品に<b>縦型カード（9:16）</b>・<b>台本</b>・<b>キャプション</b>を用意。カードを動画に重ね、台本を読み（または合成音声で）、キャプションを貼るだけ。Shorts／TikTok／Reelsに横展開可。
          </p>
          <p className="text-[10px] text-gray-400 leading-relaxed mt-1.5">
            ※ 数字はすべて想定・目安。収入の断定や誇大表現はNG（媒体の信頼に関わります）。
          </p>
        </div>

        {items.length === 0 ? (
          <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-6 text-center shadow-sm text-sm text-gray-500">
            集計中です。少し時間をおいて再度ご覧ください。
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((p) => {
              const raku = p.source?.price || 0;
              const ebay = p.realAvgPrice || 0;
              const rate = p.realProfitRate || 0;
              return (
                <section key={p.id} className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-4">
                  <div className="flex items-center gap-3 mb-3">
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt="" className="w-14 h-14 object-cover rounded-lg border border-[#A98B5C]/25 shrink-0" />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-gray-100 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-bold text-gray-800 leading-snug line-clamp-2">{p.title}</p>
                      <p className="text-[11px] text-gray-500 mt-1 tabular-nums">
                        楽天 {yen(raku)} → eBay想定 <span className="text-[#0064D2] font-bold">{yen(ebay)}</span>・利益率 <span className="text-[#2D323B] font-bold">{rate}%</span>
                      </p>
                    </div>
                  </div>

                  <a href={cardUrl(p.title, raku, ebay, rate)} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 h-11 bg-[#2D323B] text-white font-bold text-[13px] rounded-xl active:bg-[#1A1D23] mb-2.5">
                    <Download size={15} /> 縦型カードを保存（9:16）
                  </a>

                  <p className="text-[11px] font-bold text-gray-500 mb-1">台本（15〜20秒）</p>
                  <div className="mb-2.5"><CopyText text={script(raku, ebay, rate)} label="台本コピー" /></div>

                  <p className="text-[11px] font-bold text-gray-500 mb-1">キャプション</p>
                  <CopyText text={caption(raku, ebay, rate)} label="コピー" />
                </section>
              );
            })}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
