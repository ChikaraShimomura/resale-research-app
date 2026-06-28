// ココナラへの個別サポート導線。A8.netアフィリエイト(本人のa8mat)。
// 収益はこのA8アフィリ等に限る。EbayListingModal と同じURL/方針を共有。
// env(NEXT_PUBLIC_COCONALA_AFFILIATE_URL)があればそれ、無ければ既定のa8リンク。a8リンク＝常に「広告」表記(ステマ規制)。
export const COCONALA_URL =
  process.env.NEXT_PUBLIC_COCONALA_AFFILIATE_URL || "https://px.a8.net/svt/ejp?a8mat=4B5X8G+C6720I+2PEO+1HP31U";
export const COCONALA_IS_AD = true;
