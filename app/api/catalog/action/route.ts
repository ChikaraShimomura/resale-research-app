import { kv } from "@vercel/kv";
import { Ratelimit } from "@upstash/ratelimit";
import { getActorId } from "../../../lib/auth/actor";
import { canDropship } from "../../../lib/auth/plan";
import { fetchSourceAvailability } from "../../../lib/usedGallery";
import { hasPerm, type TeamPerm } from "../../../lib/team";

// 中古カタログの「仕入れた」「これは無理(スキップ)」印。アクター単位の集合に記録し、カタログ/ランキングの表示から外す。
// eBay もカタログ生成も叩かない。ログイン時は actor=acct:{uuid} なので別端末でも同じ印が効く。
// 1点物なので「仕入れた」はそのユーザーにとっての売り切れ印にもなる（本人が再表示したい時は undo）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOUGHT_KEY = (actor: string) => `used_bought:${actor}`;
const SKIP_KEY = (actor: string) => `used_skip:${actor}`;
const FAV_KEY = (actor: string) => `used_fav:${actor}`; // お気に入り（♡）。Hash id→スナップショット。カタログは隠さない（仕入れ/skipと別）。
const BOUGHT_TTL = 365 * 24 * 60 * 60; // 仕入れ実績は長め(1年)
const SKIP_TTL = 180 * 24 * 60 * 60; // スキップ判断は半年で自然解除（気が変われば再表示）
const FAV_TTL = 365 * 24 * 60 * 60; // お気に入りは長め(1年)

// 濫用防止: 書き込みは1アクター60回/10分。大量IDをaddして集合を肥大化させるのを防ぐ。
const rl = new Ratelimit({ redis: kv, limiter: Ratelimit.slidingWindow(60, "10 m"), prefix: "rl:catalogact:actor", analytics: false });

// POST: { action: "bought"|"skip"|"undo", productId, buyJpy? }
// used_bought は「id→仕入れ値(JPY)」のハッシュ＝収支の仕入れ累計に使う。used_skip は id の集合（金額不要）。
export async function POST(req: Request) {
  const viewer = await getActorId();
  if (!viewer) return Response.json({ ok: false, error: "ログインが必要です。ログインしてからお試しください。" }, { status: 401 });
  try {
    const { success } = await rl.limit(viewer);
    if (!success) return Response.json({ ok: false, error: "しばらくしてからお試しください。" }, { status: 429 });
  } catch { /* フェイルオープン */ }

  const body = (await req.json().catch(() => ({}))) as { action?: string; productId?: string; buyJpy?: number; shippingJpy?: number; teamOwner?: string; snapshot?: unknown; confirmedBought?: boolean };
  const productId = (body.productId || "").trim();
  if (!productId || productId.length > 256) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });
  // 仕入れ値は0〜1億円に丸めて保存（異常値で集計を壊さない）。未指定/不正は0（印は付くが金額なし）。
  const buyJpy = Math.min(Math.max(0, Math.round(Number(body.buyJpy) || 0)), 100_000_000);

  // 操作対象のアクター。teamOwner 指定時はチーム共有＝オーナーのデータを操作する（権限チェック後）。既定は自分。
  // お気に入り(fav/unfav)は個人のブックマーク＝チームへ代理せず常に自分(viewer)。
  const PERM_FOR: Record<string, TeamPerm> = { bought: "buy", skip: "skip", undo: "delete", shipping: "shipping" };
  let actor = viewer;
  const teamOwner = (body.teamOwner || "").trim();
  const isFav = body.action === "fav" || body.action === "unfav";
  if (!isFav && teamOwner && teamOwner !== viewer) {
    const need = PERM_FOR[body.action || ""];
    if (!need || !(await hasPerm(teamOwner, viewer, need))) {
      return Response.json({ ok: false, error: "この操作の権限がありません。" }, { status: 403 });
    }
    actor = teamOwner;
  }

  try {
    if (body.action === "bought") {
      // 仕入れた＝スキップとは排他。「仕入れ商品一覧」で出品できるよう、psnap(出品用ProfitProduct)のスナップショットを丸ごと保存。
      // 金額(buyJpy)は finance(getStats) 用に上位にも持つ。psnap が無い古い品はクライアント送信の buyJpy で最小記録。
      let snap = null;
      try { snap = await kv.get(`psnap:${productId}`); } catch { /* noop */ }

      // 仕入れ元の在庫を先に確認。まだ「在庫あり」＝実際には買っていない＝無在庫転売の疑い。Hard Offのみ判定可。
      let availability: "in-stock" | "sold-out" | "unknown" = "unknown";
      try {
        const srcUrl = snap && typeof snap === "object" ? String((snap as { source?: { url?: string } }).source?.url || "") : "";
        if (srcUrl) availability = await fetchSourceAvailability(srcUrl);
      } catch { /* noop */ }

      // ★在庫ありを「仕入れた」＝無在庫転売。基本は蹴る（カタログから消さない・記録しない）。ユーザー指示2026-06-27。
      //   無在庫はプロMAX限定(canDropship=プロMAX/身内/管理者)。通常の出品(canAutoList=ライト以上)とは別の上位ゲート。
      //   ⚠️ ゲートは「自分の一覧に・自分で」入れる時(actor===viewer)だけ。チーム買い付け(actor=owner)は
      //   オーナーが権限付与済み＝認可なので対象外（無在庫の可否は出品時に判定。publish と整合）。
      //   ※ canDropship() は viewer(セッション)のプランなので、actor===viewer の時だけ正しく一致する。
      if (availability === "in-stock" && actor === viewer && !(await canDropship())) {
        // ★正直な買い手の救済: 仕入れ元ページが売り切れに更新される前に実際に買ってしまった人を罠に嵌めない。
        //   confirmedBought=true（本人が「もう仕入れ済み」と明示確認）なら通常通り記録する（本人のみ非表示）。
        //   未確認なら従来通り needsPlan で蹴る（在庫表示が古いだけのケースを本人の自己申告で救済する設計）。
        if (!body.confirmedBought) {
          return Response.json({ ok: true, added: false, availability, needsPlan: true });
        }
      }

      const item =
        snap && typeof snap === "object"
          ? { ...(snap as Record<string, unknown>), buyJpy: Number((snap as { source?: { price?: number } }).source?.price) || buyJpy, boughtAt: new Date().toISOString() }
          : { id: productId, buyJpy, boughtAt: new Date().toISOString() };
      await kv.hset(BOUGHT_KEY(actor), { [productId]: item });
      await kv.srem(SKIP_KEY(actor), productId);
      await kv.expire(BOUGHT_KEY(actor), BOUGHT_TTL);
      // 出品は後日でも動くよう psnap を仕入れTTLまで延命（既定TTL35日で失効すると prepare が引けなくなるため）。
      if (snap && typeof snap === "object") { try { await kv.set(`psnap:${productId}`, snap, { ex: BOUGHT_TTL }); } catch { /* noop */ } }
      return Response.json({ ok: true, added: true, availability });
    }
    if (body.action === "skip") {
      await kv.sadd(SKIP_KEY(actor), productId);
      await kv.hdel(BOUGHT_KEY(actor), productId);
      await kv.expire(SKIP_KEY(actor), SKIP_TTL);
      return Response.json({ ok: true });
    }
    if (body.action === "undo") {
      // どちらの印も解除＝カタログに戻す。送料設定も消す。
      await kv.hdel(BOUGHT_KEY(actor), productId);
      await kv.srem(SKIP_KEY(actor), productId);
      try { await kv.hdel(`used_ship:${actor}`, productId); } catch { /* noop */ }
      return Response.json({ ok: true });
    }
    if (body.action === "shipping") {
      // 仕入れた商品の送料（円）を保存。未設定の品は集計時に一律1000円扱い。0〜10万に丸める。
      const shippingJpy = Math.min(100000, Math.max(0, Math.round(Number(body.shippingJpy) || 0)));
      await kv.hset(`used_ship:${actor}`, { [productId]: shippingJpy });
      await kv.expire(`used_ship:${actor}`, BOUGHT_TTL);
      return Response.json({ ok: true, shippingJpy });
    }
    if (body.action === "fav") {
      // ♡お気に入りに追加（個人ブックマーク）。psnapスナップショットを丸ごと保存し /manage?tab=fav で表示。
      // カタログからは隠さない（仕入れた/skipと違い triage ではない）。
      let snap = null;
      try { snap = await kv.get(`psnap:${productId}`); } catch { /* noop */ }
      const item =
        snap && typeof snap === "object"
          ? { ...(snap as Record<string, unknown>), favAt: new Date().toISOString() }
          : { id: productId, favAt: new Date().toISOString() };
      await kv.hset(FAV_KEY(actor), { [productId]: item });
      await kv.expire(FAV_KEY(actor), FAV_TTL);
      if (snap && typeof snap === "object") { try { await kv.set(`psnap:${productId}`, snap, { ex: FAV_TTL }); } catch { /* noop */ } }
      return Response.json({ ok: true, faved: true });
    }
    if (body.action === "unfav") {
      await kv.hdel(FAV_KEY(actor), productId);
      return Response.json({ ok: true, faved: false });
    }
  } catch {
    return Response.json({ ok: false, error: "保存できませんでした。少し待ってお試しください。" }, { status: 503 });
  }

  return Response.json({ ok: false, error: "不明な操作です。" }, { status: 400 });
}
