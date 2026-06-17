// サインイン時に、端末(rr_did)単位で貯まったデータを永続アカウント(acct:<uuid>)へ引き継ぐ。
// 対象は actor 単位のキー（eBayトークン/利益台帳/SKU対応表/売却キャッシュ/仕入れ中）。
// RENAME は型非依存(string/hash/set すべて可)＋TTL保持。アカウント側に既にデータがあれば上書きしない
// （別端末で先に貯めた実績を、後からゲスト端末で潰さないため）。冪等：2回目以降は src が無く no-op。
import { kv } from "@vercel/kv";

const ACTOR_PREFIXES = ["ebay_token", "ebay_deals", "ebay_sku_map", "ebay_sold", "ebay_sourcing"] as const;

export async function migrateDeviceDataToAccount(did: string, accountId: string): Promise<void> {
  if (!did || !accountId || did === accountId) return;
  for (const p of ACTOR_PREFIXES) {
    const src = `${p}:${did}`;
    const dst = `${p}:${accountId}`;
    try {
      if (await kv.exists(dst)) continue; // アカウント側に既存 → 上書きしない
      await kv.rename(src, dst); // src が無ければ throw → catch で無視
    } catch {
      /* src 無し / 失敗は無視（初回や該当データ無しの正常系を含む） */
    }
  }
}
