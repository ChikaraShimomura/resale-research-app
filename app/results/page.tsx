import { redirect } from "next/navigation";

// 旧・新品商材の検索結果ページ。中古モデルへ一本化したため中古の利益カタログへ送る（新品は見せない）。
export const dynamic = "force-dynamic";

export default function ResultsRedirect() {
  redirect("/catalog");
}
