import { redirect } from "next/navigation";

// 料金プランは現在非公開（有料機能・課金が未実装のため）。
// 直接アクセスは検索ページへ誘導する。プラン内容は git 履歴に保持。
export default function PricingPage() {
  redirect("/search");
}
