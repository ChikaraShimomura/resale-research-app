import { redirect } from "next/navigation";

// 「仕入れ商品」は「商品管理」(/manage)の仕入れ商品タブに集約済み。旧URLはリダイレクト。
export const dynamic = "force-dynamic";
export default function BoughtRedirect() {
  redirect("/manage?tab=bought");
}
