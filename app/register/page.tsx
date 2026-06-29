import BrandHome from "../components/BrandHome";
import ProfitSampleStrip from "../components/ProfitSampleStrip";
import RegisterForm from "./RegisterForm";

// 完全会員制（未ログインは全ページ /register へ）＝新規が最初に見るのはこのページ。
// 価値の“証拠”（今日の儲かる中古サンプル）を登録フォームの上に出して、登録前に「おっ」を作る＝登録率を上げる。
// サンプルは中古カタログ(used_catalog)をサーバーで読むので force-dynamic（毎回最新・静的キャッシュしない）。
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4 py-10">
      <BrandHome className="mb-5" />

      {/* 価値の証拠（登録前に見せる）。通常はカタログ(229件)から3件表示。
          稀に在庫0でサンプルが null の時はリード文だけ残るが、文単体でも成立する文言にしている。 */}
      <div className="w-full max-w-sm mb-4">
        <p className="text-center text-[12px] text-gray-500 mb-2 leading-relaxed">
          <span className="whitespace-nowrap">登録すると、こういう</span><wbr />
          <span className="whitespace-nowrap"><b className="text-gray-700">“儲かる中古”が毎日</b>見られます</span>
        </p>
        <ProfitSampleStrip />
      </div>

      <RegisterForm />
    </main>
  );
}
