import { redirect } from "next/navigation";

// 旧・新品商材の検索ページ。中古モデルへ一本化したため、到達しても新品は見せず中古の利益カタログへ送る。
// （旧コンポーネント=ProductCard/SearchForm 等は他からの参照のため残置・このルートは入口を閉じる）
export const dynamic = "force-dynamic";

export default function SearchRedirect() {
  redirect("/catalog");
}
