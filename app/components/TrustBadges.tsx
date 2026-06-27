import Link from "next/link";
import { Globe, Users, ShieldCheck, KeyRound, TrendingUp, Landmark, Briefcase, Lock, CircleCheck, ShoppingBag, Coins, Package, type LucideIcon } from "lucide-react";

// このサイトが使うサービスを「信頼できる相手」として直感的に伝える信頼ブロック。
// 海外サイトへの不安を「使う相手が世界基準の大企業」と一目で示して下げる。
// withRakuten=true で 仕入れ先の楽天を加えた3つ（ホーム上部）。false で eBay/Payoneer の2つ（eBay設定画面・従来どおり）。
// linked=true で各カードがそのサービスのガイドへのリンクになる。
// 数値は裏取り済み（eBay: 190の国・地域/1.3億人超/買い手保護, Payoneer: NASDAQ上場/200カ国超/各国ライセンス）。

const RAKU = "#BF0000";
const EBAY = "#0064D2";
const PAYO = "#FF6B00";

type Pt = { Icon: LucideIcon; t: string };

const rakuPoints: Pt[] = [
  { Icon: ShoppingBag, t: "日本最大級。いつもの通販感覚で仕入れ" },
  { Icon: Coins, t: "買うほどポイント還元で実質コスト減" },
  { Icon: Package, t: "仕入れも受け取りも国内で安心" },
  { Icon: CircleCheck, t: "楽天会員アカウントでそのまま購入" },
];
const ebayPoints: Pt[] = [
  { Icon: Globe, t: "世界190の国・地域で利用（1995年〜）" },
  { Icon: Users, t: "1.3億人超の買い手" },
  { Icon: ShieldCheck, t: "買い手保護（届かない・違う商品は返金）" },
  { Icon: KeyRound, t: "公式連携。パスワードは渡らない" },
];
const payoPoints: Pt[] = [
  { Icon: TrendingUp, t: "NASDAQ上場企業（PAYO）" },
  { Icon: Globe, t: "世界200以上の国・地域で利用" },
  { Icon: Briefcase, t: "Amazon・Airbnbなど大手も採用" },
  { Icon: Lock, t: "各国の金融ライセンス＋本人確認で資金保護" },
];

function Card({
  accent, HeadIcon, name, role, tagline, points, href, linked, external, compact,
}: {
  accent: string; HeadIcon: LucideIcon; name: string; role?: string; tagline: string;
  points: Pt[]; href: string; linked: boolean; external?: boolean; compact?: boolean;
}) {
  // コンパクト3列（ホーム）：アイコン＋社名＋役割＋短い説明だけ。詳細な点リストは省いて横並びを優先。
  if (compact) {
    const inner = (
      <div className="bg-white border border-[#A98B5C]/25 rounded-2xl shadow-sm p-3 h-full flex flex-col items-center text-center gap-1.5">
        <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${accent}1A` }}>
          <HeadIcon size={22} style={{ color: accent }} />
        </div>
        <p className="text-[14px] font-black text-gray-800 leading-tight">{name}</p>
        {role && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${accent}1A`, color: accent }}>{role}</span>
        )}
        <p className="text-[10px] text-gray-500 leading-snug">{tagline}</p>
      </div>
    );
    if (!linked) return inner;
    return external ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="block active:scale-[0.99] transition-transform">{inner}</a>
    ) : (
      <Link href={href} className="block active:scale-[0.99] transition-transform">{inner}</Link>
    );
  }

  const body = (
    <div className="bg-white border border-[#A98B5C]/25 rounded-2xl shadow-sm p-4 h-full">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${accent}1A` }}>
          <HeadIcon size={18} style={{ color: accent }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[15px] font-black text-gray-800 leading-tight">{name}</p>
            {role && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${accent}1A`, color: accent }}>{role}</span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 leading-tight mt-0.5">{tagline}</p>
        </div>
        {linked && <span aria-hidden="true" className="text-gray-300 text-base shrink-0">›</span>}
      </div>
      <ul className="space-y-2">
        {points.map(({ Icon, t }, i) => (
          <li key={i} className="flex items-start gap-2">
            <Icon size={15} className="mt-0.5 shrink-0" style={{ color: accent }} aria-hidden="true" />
            <span className="text-[12px] text-gray-600 leading-snug">{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  if (!linked) return body;
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="block active:scale-[0.99] transition-transform">{body}</a>
  ) : (
    <Link href={href} className="block active:scale-[0.99] transition-transform">{body}</Link>
  );
}

export default function TrustBadges({ withRakuten = false, linked = false }: { withRakuten?: boolean; linked?: boolean } = {}) {
  return (
    <div>
      <div className="flex items-start gap-2 mb-3">
        <ShieldCheck size={20} className="text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="text-sm font-black text-gray-800 leading-tight">
            {withRakuten ? "使うのは、信頼できる3つだけ" : "使うのは、世界が信頼する2つだけ"}
          </p>
          <p className="text-[12px] text-gray-500 leading-relaxed mt-0.5">
            {withRakuten ? (
              <>
                <span className="whitespace-nowrap">仕入れは楽天、出品はeBay、</span><wbr />
                <span className="whitespace-nowrap">入金はPayoneer。</span><wbr />
                <span className="whitespace-nowrap">日本最大級と世界基準の</span><wbr />
                <span className="whitespace-nowrap">サービスだけ。</span>
              </>
            ) : (
              <>
                <span className="whitespace-nowrap">出品はeBay、入金はPayoneer。</span><wbr />
                <span className="whitespace-nowrap">どちらも世界中で使われ、</span><wbr />
                <span className="whitespace-nowrap">強固なセキュリティで安心。</span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className={`grid ${withRakuten ? "grid-cols-3 gap-2" : "grid-cols-1 sm:grid-cols-2 gap-3"}`}>
        {withRakuten && (
          <Card accent={RAKU} HeadIcon={ShoppingBag} name="楽天" role="仕入れ" tagline="日本最大級の通販モール" points={rakuPoints} href="/guide/rakuten" linked={linked} compact={withRakuten} />
        )}
        <Card accent={EBAY} HeadIcon={Globe} name="eBay" role={withRakuten ? "販売" : undefined} tagline={withRakuten ? "世界最大級のフリマ" : "世界最大級のフリマサイト"} points={ebayPoints} href="https://www.ebay.com/sl/sell" linked={linked} external compact={withRakuten} />
        <Card accent={PAYO} HeadIcon={Landmark} name="Payoneer" role={withRakuten ? "受け取り" : undefined} tagline={withRakuten ? "世界の入金・受け取り" : "世界の入金・受け取りサービス"} points={payoPoints} href="/guide/payoneer-withdraw" linked={linked} compact={withRakuten} />
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[12px] font-bold text-gray-700">
        <CircleCheck size={15} className="text-emerald-600 shrink-0" aria-hidden="true" />
        <span>
          <span className="whitespace-nowrap">だから、日本にいながら</span><wbr />
          <span className="whitespace-nowrap">安心して海外に売れる。</span>
        </span>
      </p>
    </div>
  );
}
