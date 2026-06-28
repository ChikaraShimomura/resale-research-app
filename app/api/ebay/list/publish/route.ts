import { kv } from "@vercel/kv";
import { getActorId } from "../../../../lib/auth/actor";
import { getProductById } from "../../../../lib/ebay/productStore";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { createAndPublish, SKU_MAP_KEY, SKU_MAP_TTL } from "../../../../lib/ebay/listing";
import { filterProductImages } from "../../../../lib/ebay/imageFilter";
import { enhanceToEps } from "../../../../lib/ebay/imageProcess";
import { recordListed, listDealsForUser } from "../../../../lib/ebay/stats";
import { removeSourcing } from "../../../../lib/ebay/sourcing";
import { friendlyEbayError } from "../../../../lib/ebay/errorMessages";
import { SOLD_THRESHOLD } from "../../../../lib/sold";
import { getPlan, isUnlimited } from "../../../../lib/auth/plan";
import { hasPerm, markTeamListed } from "../../../../lib/team";
import { getTeamContext } from "../../../../lib/auth/teamActor";
import { PLANS, PAYWALL_ENABLED, planCanAutoList } from "../../../../lib/plans";
import { toRakutenProductUrl } from "../../../../lib/utils";
import { fetchSourceAvailability } from "../../../../lib/usedGallery";

// 「eBay出品する」：在庫アイテム→オファー→公開を実行し、SKU→商品ID の対応表を保存する。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // 画像の取得→sharp加工→EPSアップロードで時間がかかるため上限を引き上げ

interface Payload {
  productId?: string;
  title?: string;
  description?: string;
  priceUsd?: string;
  condition?: string;
  categoryId?: string;
  aspects?: Record<string, string>; // { Brand: "Unbranded", ... }
  fulfillmentPolicyId?: string; // 選んだ送料サイズ
  handlingDays?: number; // 発送までの日数（落札後）
  quantity?: number; // 出品個数（在庫数）。1〜30
  onBehalfOf?: string; // チーム：出品権限のあるメンバーがチームの共有在庫を出品する時のオーナーactor。eBayアカウントはモードで決まる。
  selectedImages?: string[]; // ユーザーが出品画面で選んだ出品画像URL（先頭=メイン）。未指定なら自動選定
}

export async function POST(req: Request) {
  const viewer = await getActorId();
  if (!viewer) return Response.json({ ok: false, connected: false });

  const body = (await req.json().catch(() => ({}))) as Payload;

  // チーム完全共有：在庫・台帳・満了枠は「共有データ名前空間(dataActor=オーナー)」に統一し、全員で同じ出品中/収益を見る。
  // eBayトークン/SKU対応表は「出品アカウント(ebayActor)」＝共有モードはオーナー、個別モードは本人（各自のeBayで出品）。
  // メンバーが出品するには "list" 権限が要る（オーナー本人は全権）。
  const { dataActor, ebayActor, owner, isMember } = await getTeamContext();
  const teamListing = isMember && !!owner && owner !== viewer;
  if (teamListing && owner && !(await hasPerm(owner, viewer, "list"))) {
    return Response.json({ ok: false, error: "このチームでの出品権限がありません。" }, { status: 403 });
  }
  const actor = dataActor ?? viewer; // 台帳・在庫・満了枠（チーム共有）
  const ebayActorId = ebayActor ?? viewer; // eBayトークン・SKU対応表（出品に使うeBayアカウント）

  const token = await getValidAccessToken(ebayActorId); // 共有=オーナー / 個別=本人 のeBay。未連携ならここで弾く。
  if (!token) return Response.json({ ok: false, connected: false });
  if (!body.productId) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });
  if (!body.categoryId) return Response.json({ ok: false, error: "カテゴリが未指定です。" }, { status: 400 });
  const price = Number(body.priceUsd);
  if (!body.priceUsd || !Number.isFinite(price) || price < 0.01) {
    return Response.json({ ok: false, error: "価格(USD)を入力してください。" }, { status: 400 });
  }

  const product = await getProductById(body.productId);
  if (!product) return Response.json({ ok: false, error: "商品が見つかりませんでした。" }, { status: 404 });

  // 売切ガード：仕入れ元(ハードオフ)が売切/掲載終了の品を「新規出品」させない＝欠品キャンセル(新規アカ致命)を防ぐ。
  //  ・getUsedCatalog は売切を一覧から隠すが、psnap直リンク/お気に入り/仕入れ済みの stale な productId からは publish に到達し得る。
  //    ここで実ページの schema.org availability を最新で確認して塞ぐ（既存ライブ出品の自動停止は hardoffLivenessWorker→reconcile が担当）。
  //  ・unknown は通す(fail-open＝取得不能で正当な出品を妨げない)。ハードオフはVercel(DC-IP)からも取得可。
  if ((product.source?.site as string) === "hardoff" && product.source?.url) {
    const avail = await fetchSourceAvailability(product.source.url);
    if (avail === "sold-out") {
      return Response.json({ ok: false, error: "この商品は仕入れ元（ハードオフ）で売り切れ／掲載終了のため出品できません。別の商品をお試しください。" }, { status: 409 });
    }
  }

  // 行為者のプラン。admin/master(あなた＋身内=無料・無制限)は満了・プラン上限の対象外。
  const plan = await getPlan();
  const comp = isUnlimited(plan);

  // eBay自動出品は有料プラン（ライト以上）＋身内/管理者。UIでも隠すがサーバーでも弾く＝迂回防止。ユーザー指示2026-06-27（リリース監査）。
  // ※チーム出品(teamListing)はオーナーが出品権限を付与済み＝認可なのでプラン判定はスキップ。
  if (!teamListing && !planCanAutoList(plan)) {
    return Response.json({ ok: false, needsPlan: true, error: "eBay自動出品にはプランへのご加入が必要です。ライトは30日無料でお試しいただけます。" }, { status: 403 });
  }

  // 満了(SOLD)チェック：1商品につき最大 SOLD_THRESHOLD 人(出品者=アカウント)まで。既に出した本人は再出品OK(冪等)。
  // メンバーは台帳(ebay_deals:{actor})と同じ actor に統一。端末did基準だと複数端末で多重消費＋停止/売却で解放できない。
  if (!comp) {
    try {
      if (
        (await kv.scard(`listing_actors:${product.id}`)) >= SOLD_THRESHOLD &&
        !(await kv.sismember(`listing_actors:${product.id}`, actor))
      ) {
        return Response.json({ ok: false, error: `この商品は出品上限（${SOLD_THRESHOLD}人）に達しました（満了）。別の商品をお試しください。` });
      }
    } catch {
      /* KV障害時はブロックしない（出品は通す） */
    }
  }

  // プラン上限(同時出品数)ゲート。Stripe決済が稼働するまで PAYWALL_ENABLED=OFF で無効（既存挙動を壊さない）。
  // ※チーム出品はオーナーの枠/設定で出すため、メンバーのプラン上限ゲートはスキップ。
  if (PAYWALL_ENABLED && !comp && !teamListing) {
    const limit = PLANS[plan].listingLimit; // free=0 / amateur=10 / veteran=50 / pro=100（master/admin は comp で除外済み）
    if (limit <= 0) {
      // free(未購読=プラン未加入)は出品不可。0を「無制限」ではなく「出品できない」として明示的に弾く（PAYWALL ON時のみ到達）。
      // これが無いと free が上限ゲートを素通りして無制限出品できてしまう（課金の中核が機能しない）。
      // ※「プラン上限に到達(planLimitReached)」とは別フラグ(needsPlan)で返す＝未加入と到達でUI文言/導線を出し分ける。
      return Response.json({
        ok: false,
        needsPlan: true,
        error: `出品にはプランへのご加入が必要です。ライトは30日無料でお試しいただけます。`,
      });
    }
    const { live } = await listDealsForUser(actor);
    if (!live.some((d) => d.id === product.id) && live.length >= limit) {
      return Response.json({
        ok: false,
        planLimitReached: true,
        error: `現在のプラン（${PLANS[plan].name}）の同時出品上限（${limit}件）に達しました。プランをアップグレードしてください。`,
      });
    }
  }

  const title = (body.title || product.coreKeyword || product.title).slice(0, 80);
  // 必須項目（空値は送らない）。値は配列で渡す。
  const aspects: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(body.aspects ?? {})) {
    if (v && v.trim()) aspects[k] = [v.trim()];
  }
  // 製造国＝日本仕入れ前提。モーダルで指定済みなら尊重し、未指定でも全出品に「Made in Japan」を必ず付ける
  // （信頼/検索のシグナル＋返品低減。最適化フローと同じ既定）。
  if (!aspects["Country/Region of Manufacture"]) aspects["Country/Region of Manufacture"] = ["Japan"];

  const description =
    (body.description && body.description.trim()) ||
    `${title}\n\nShipped directly from Japan with tracking. Carefully packaged. Please check the photo.`;

  // 出品画像: ユーザーが出品画面で選んだ写真があればそれを使う（先頭=メイン）。
  // eBay上限＆EPS加工時間(maxDuration)を考え最大12枚に制限。重複は除去。
  // 選択が無ければ従来どおり 楽天ギャラリー(最大3)から「商品写真だけ」を自動選定。
  const picked = Array.isArray(body.selectedImages)
    ? Array.from(new Set(body.selectedImages.filter((u) => typeof u === "string" && /^https?:\/\//.test(u)))).slice(0, 12)
    : [];
  const baseImages = picked.length
    ? picked
    : await filterProductImages(product.images?.length ? product.images : [product.imageUrl]);
  // 品質加工(無料sharp): 楽天画像を取得→1600px正方白背景・シャープ→EPSへ載せ替え(全EPS化で混在も回避)。
  // 失敗時は元の楽天URLのまま出品(fail-open)＝出品は必ず通る。
  let images = baseImages;
  try {
    const enhanced = await enhanceToEps(token, baseImages);
    if (enhanced && enhanced.length) images = enhanced;
  } catch {
    /* fail-open: 元URLのまま */
  }

  // Best Offer（値下げ交渉）は廃止済み＝eBay自動出品は定額価格のみ（自動値下げ機能は付けない）。
  const result = await createAndPublish(token, {
    productId: product.id,
    title,
    description,
    imageUrl: product.imageUrl,
    images,
    priceUsd: price.toFixed(2),
    // 状態はモーダルの選択値。未指定でも中古サイト由来なら新品(NEW)にせずUSED_GOODを既定にする（中古品が新品で出る事故防止）。
    condition: body.condition || ((product.source?.site as string) === "hardoff" || (product.source?.site as string) === "2ndstreet" ? "USED_GOOD" : "NEW"),
    categoryId: body.categoryId,
    aspects,
    fulfillmentPolicyId: body.fulfillmentPolicyId,
    handlingDays: Number(body.handlingDays) > 0 ? Number(body.handlingDays) : undefined,
    quantity: Number(body.quantity) > 0 ? Number(body.quantity) : 1,
    ean: (product as { jan?: string }).jan, // JANがあればeBayに渡し公式ストック画像/必須項目を自動添付(fail-open)
  });

  // オファー作成(下書き含む)できたら出品者数を計上（満了=上限判定の元）。SADDで出品者(actor)単位・冪等。
  // コンプ枠は枠を消費しない（あなた＝身内が何度出してもSOLDにしない）。停止/やめた/売却で releaseListingSlot により解放。
  // 公開成功(result.ok)時だけ計上＝出品枠超過などで失敗した下書きは満了にカウントしない（幽霊で枠を食わない）。
  if (result.ok && result.offerId && !comp) {
    try {
      await kv.sadd(`listing_actors:${product.id}`, actor);
      await kv.expire(`listing_actors:${product.id}`, 90 * 24 * 60 * 60);
    } catch {
      /* noop */
    }
  }

  // 「出品完了」＝eBayに公開できたものだけ記録する。下書き/本人確認待ち(result.ok=false)は成績に数えない。
  // ・SKU→商品ID（売却検知の逆引き）
  // ・マイページ成績の出品（件数・仕入れ額）。仕入れは楽天価格＋国内送料（＝実際に払った額）。
  if (result.ok) {
    try {
      // 実際に公開に使ったSKU（自己修復で rr-{id}-{乱数} になり得る）で対応表を書く。SKU対応表は出品アカウント(ebayActor)基準。
      await kv.hset(SKU_MAP_KEY(ebayActorId), { [result.sku]: product.id });
      await kv.expire(SKU_MAP_KEY(ebayActorId), SKU_MAP_TTL);
    } catch {
      /* noop */
    }
    await recordListed(actor, product.id, {
      purchase: product.source.price + (product.source.shippingJpy ?? 0),
      points: product.source.pointAmount ?? 0,
      title: product.title,
      imageUrl: product.imageUrl,
      sourceUrl: toRakutenProductUrl(product.source.url) || undefined, // 「仕入れ」ボタンの直リンク。出品時に焼き込めば backfill 不要
      listedAt: new Date().toISOString(),
      listingId: result.listingId, // 「写真追加」でその出品へ直リンクするため公開IDを保存（再出品で変わったら更新）
      sku: result.sku, // アプリ内編集(価格/数量)の対象オファー特定に使う
    });
    // 出品できたら「仕入れ中」からは外す（→ 出品中一覧へ移る）。
    try {
      await removeSourcing(actor, product.id);
    } catch {
      /* noop */
    }
    // チーム出品：deal は共有名前空間(オーナー)に記録済みなので全員の「出品中」に出るが、
    // 「誰が出品したか(byActor)」を残すため team_listed にも焼く（個別モードで各自のeBayに出した分の追跡も兼ねる）。
    if (teamListing && owner) {
      try {
        await markTeamListed(owner, product.id, {
          byActor: viewer,
          title: product.title,
          imageUrl: product.imageUrl,
          buyJpy: product.source.price + (product.source.shippingJpy ?? 0),
          listingId: result.listingId,
          listedAt: new Date().toISOString(),
        });
      } catch {
        /* noop */
      }
    }
  }

  // 生のeBayエラーをユーザー向けの端的な文に変換（既知=要因／未知=「予期せぬエラー」＋報告ボタン）。
  // notready系(本人確認待ち/未登録/連携切れ)は専用UIで扱うので変換しない。生エラーは errorDetail に温存（報告用）。
  if (!result.ok && result.error && !result.needsSellerRegistration && !result.pendingVerification && !result.accountUnusable) {
    const f = friendlyEbayError(result.error);
    // ステップ一覧にも生eBayエラーが残るため、各失敗ステップも友好文化（生は errorDetail に温存）。
    const steps = result.steps?.map((s) =>
      s.ok || !s.error ? s : { ...s, error: friendlyEbayError(s.error).message, errorDetail: s.error }
    );
    // 未知(unexpected)エラーは「報告」ボタンが出ても押されないことが多い→サーバー側で自動的にKVへ記録し、
    // 開発者が生eBayエラーで原因を追えるようにする（既知のアカウント要因=出品枠超過等はノイズなので記録しない）。
    if (!f.known) {
      try {
        await kv.lpush(
          "error_reports",
          JSON.stringify({
            where: "ebay_listing_auto",
            productId: product.id,
            coreKeyword: product.coreKeyword,
            message: String(result.error).slice(0, 2000),
            steps: Array.isArray(result.steps) ? result.steps.slice(0, 30) : undefined,
            priceUsd: body.priceUsd,
            category: body.categoryId,
            auto: true,
            ts: new Date().toISOString(),
          })
        );
        await kv.ltrim("error_reports", 0, 199);
        await kv.expire("error_reports", 60 * 24 * 60 * 60);
      } catch {
        /* 記録失敗は無視（出品応答は返す） */
      }
    }
    return Response.json({ ...result, steps, error: f.message, errorKind: f.known ? "known" : "unexpected", errorDetail: result.error });
  }
  return Response.json(result);
}
