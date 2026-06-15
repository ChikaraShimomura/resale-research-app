import { Globe, Users, ShieldCheck, KeyRound, TrendingUp, Landmark, Briefcase, Lock, CircleCheck, type LucideIcon } from "lucide-react";

// eBay と Payoneer が世界的に使われ、強固なセキュリティで守られていることを直感的に伝える信頼ブロック。
// 海外サイトへの不安を「使う相手が世界基準の大企業」と一目で示して下げる。LP上部とeBay設定画面で使う。
// 数値は裏取り済み（eBay: 190の国・地域/1.3億人超/買い手保護, Payoneer: NASDAQ上場/200カ国超/各国ライセンス）。

const EBAY = "#0064D2";
const PAYO = "#FF6B00";

const ebayPoints: { Icon: LucideIcon; t: string }[] = [
  { Icon: Globe, t: "世界190の国・地域で利用（1995年〜）" },
  { Icon: Users, t: "1.3億人超の買い手が利用" },
  { Icon: ShieldCheck, t: "買い手保護（届かない・違う商品は返金）" },
  { Icon: KeyRound, t: "公式連携であなたのパスワードは渡りません" },
];
const payoPoints: { Icon: LucideIcon; t: string }[] = [
  { Icon: TrendingUp, t: "NASDAQ上場企業（PAYO）" },
  { Icon: Globe, t: "世界200以上の国・地域で利用" },
  { Icon: Briefcase, t: "Amazon・Airbnbなど大手も採用" },
  { Icon: Lock, t: "各国の金融ライセンス下＋本人確認で資金を保護" },
];

function Card({
  accent,
  HeadIcon,
  name,
  tagline,
  points,
}: {
  accent: string;
  HeadIcon: LucideIcon;
  name: string;
  tagline: string;
  points: { Icon: LucideIcon; t: string }[];
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${accent}1A` }}>
          <HeadIcon size={18} style={{ color: accent }} />
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-black text-gray-800 leading-tight">{name}</p>
          <p className="text-[11px] text-gray-500 leading-tight">{tagline}</p>
        </div>
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
}

export default function TrustBadges() {
  return (
    <div>
      <div className="flex items-start gap-2 mb-3">
        <ShieldCheck size={20} className="text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="text-sm font-black text-gray-800 leading-tight">使うのは、世界が信頼する2つだけ</p>
          <p className="text-[12px] text-gray-500 leading-relaxed mt-0.5">
            出品は eBay、入金は Payoneer。どちらも世界中で使われ、強固なセキュリティで守られています。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card accent={EBAY} HeadIcon={Globe} name="eBay" tagline="世界最大級のネット販売所" points={ebayPoints} />
        <Card accent={PAYO} HeadIcon={Landmark} name="Payoneer" tagline="世界の入金・受け取りサービス" points={payoPoints} />
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[12px] font-bold text-gray-700">
        <CircleCheck size={15} className="text-emerald-600 shrink-0" aria-hidden="true" />
        だから、日本にいながら安心して海外に売れます。
      </p>
    </div>
  );
}
