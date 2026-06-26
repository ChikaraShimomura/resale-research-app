import { redirect } from "next/navigation";

// 「出品管理」は「商品管理」(/manage)の出品中タブに集約済み。旧URLはリダイレクト。
export const dynamic = "force-dynamic";
export default function ListingsRedirect() {
  redirect("/manage?tab=listed");
}
