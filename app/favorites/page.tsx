import { redirect } from "next/navigation";

// 「お気に入り」は「商品管理」(/manage)のお気に入りタブに集約済み。旧URLはリダイレクト。
export const dynamic = "force-dynamic";
export default function FavoritesRedirect() {
  redirect("/manage?tab=fav");
}
