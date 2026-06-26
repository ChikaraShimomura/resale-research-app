import { redirect } from "next/navigation";

// 旧・新品商材の商品詳細ページ。中古モデルへ一本化したため中古の利益カタログへ送る（新品は見せない）。
// 中古の出品フローは /catalog のモーダル(ListingHelper)で完結し、このルートは使わない。
export const dynamic = "force-dynamic";

export default function ProductRedirect() {
  redirect("/catalog");
}
