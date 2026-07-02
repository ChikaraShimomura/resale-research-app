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
import { PLANS, PAYWALL_ENABLED, planCanAutoList, planCanDropship } from "../../../../lib/plans";
import { toRakutenProductUrl } from "../../../../lib/utils";
import { breakevenTotalUsd } from "../../../../lib/ebay/priceModel";
import { estimateWeightG, USD_JPY } from "../../../../lib/ebay/landedCost";

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
  totalUsd?: string; // 買い手総額(送料込み・申告価値)。サーバー側の赤字ガードで損益分岐と照合する基準（priceUsdは商品価格＝送料別だと総額未満になる）。
  acceptLoss?: boolean; // 損益分岐を下回る価格でも「承知の上で」出品する（モーダルで確認済み）。trueなら赤字ガードを通す。
  dropship?: boolean; // 無在庫出品（仕入れ前にeBay出品）。trueならプロMAX以上(身内/管理者含む)を要求する上位ゲート。
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
  // ※ ハードオフは"有在庫"＝ユーザーが先に買って(仕入れた)手元に持ってから出品する。仕入れた品はハードオフ上で
  //   売切になるのが当たり前なので、売切を理由に出品をブロックしてはいけない（初版の誤ガードは撤去・2026-06-28）。

  // ── 赤字ガード（サーバー側・多層防御）─────────────────────────────────────────────
  // 出品モーダルは損益分岐未満を acceptLoss 無しでブロックするが、直叩き/クライアント不具合で割れた価格が来た時も
  // サーバーで弾く＝「絶対に赤字にならない」をサーバーでも担保。floor は priceModel SSOT(breakevenTotalUsd・総額基準)で
  // 独立に再計算し、クライアントが送る買い手総額(totalUsd)と照合する。
  // ・原価/重量は prepare と同一基準(effBuyJpy=品代+国内送料／weight:{id}キャッシュ→カテゴリ概算)＝floor が一致し正規出品を誤ブロックしない。
  // ・totalUsd 未送出（直叩き）や floor が出せない時はブロックしない（fail-open＝正規の出品を絶対に止めない）。
  if (!body.acceptLoss && body.totalUsd != null) {
    const totalUsd = Number(body.totalUsd);
    if (Number.isFinite(totalUsd) && totalUsd > 0) {
      try {
        const effBuyJpy = (Number(product.source?.price) || 0) + (Number(product.source?.shippingJpy) || 0);
        const wRaw = await kv.get<number>(`weight:${product.id}`);
        const category = (product as { category?: string }).category;
        // weight:{id}キャッシュ(prepare が保存)優先→無ければカテゴリ概算。カテゴリ不明は安全側(1800g)でfloorを甘くしない（editルートと同基準）。
        const weightG = typeof wRaw === "number" && wRaw > 0 ? wRaw : (category ? estimateWeightG(category) : 1800);
        if (effBuyJpy > 0 && weightG > 0) {
          const floor = Math.round(breakevenTotalUsd(effBuyJpy, weightG) * 100) / 100;
          if (floor > 0 && totalUsd < floor) {
            return Response.json({ ok: false, belowFloor: true, floorUsd: floor, error: `この価格は損益分岐（約¥${Math.round(floor * USD_JPY).toLocaleString("ja-JP")}）を下回り、赤字になります。` }, { status: 400 });
          }
        }
      } catch { /* floor算出失敗はブロックしない（fail-open） */ }
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

  // 無在庫出品（仕入れ前にeBay出品）はプロMAX以上（身内/管理者含む）に限定＝canAutoListより上位のゲート。
  // クライアント(DropshipListButton)でも押下時に弾くが、直叩き/迂回を防ぐためサーバーでも本人のプランで再判定する。
  // ※teamListingは対象外にしない＝「実行できるのはプロMAX以上を持っている人だけ」＝押した本人(viewer)のプランで判定する（ユーザー指示）。
  if (body.dropship && !planCanDropship(plan)) {
    return Response.json({ ok: false, needsPlan: true, planNeeded: "promax", error: "無在庫出品はプロMAX以上のプランでご利用いただけます。" }, { status: 403 });
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
  // 選択が無ければ従来どおり 仕入れ元ギャラリー(最大3)から「商品写真だけ」を自動選定。
  const picked = Array.isArray(body.selectedImages)
    ? Array.from(new Set(body.selectedImages.filter((u) => typeof u === "string" && /^https?:\/\//.test(u)))).slice(0, 12)
    : [];
  const baseImages = picked.length
    ? picked
    : await filterProductImages(product.images?.length ? product.images : [product.imageUrl]);
  // 品質加工(無料sharp): 仕入れ元の画像を取得→1600px正方白背景・シャープ→EPSへ載せ替え(全EPS化で混在も回避)。
  // 失敗時は元の画像URLのまま出品(fail-open)＝出品は必ず通る。
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
  // ・マイページ成績の出品（件数・仕入れ額）。仕入れは仕入れ価格＋国内送料（＝実際に払った額）。
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
      dropship: !!body.dropship, // 無在庫出品なら台帳に記録＝「無在庫」ラベル＋売り切れ検知→自動停止の対象。false明示で有在庫再出品時に確実に解除。
    });
    // 出品できたら「仕入れ中」からは外す（→ 出品中一覧へ移る）。
    try {
      await removeSourcing(actor, product.id);
    } catch {
      /* noop */
    }
    // 無在庫出品した品は、出品した本人(チーム=共有名前空間)のカタログから隠す＝もう自分は仕入れ検討しない品を二重表示しない。
    // getHiddenCatalogKeys が used_dropship を読んで /catalog・/ranking から差し引く（他ユーザーのカタログには影響しない）。
    // 有在庫(仕入れた)は used_bought で既に隠れる。停止/取消(catalog undo・stop)で解除＝再びカタログに戻る。
    if (body.dropship) {
      try {
        await kv.sadd(`used_dropship:${actor}`, product.id);
        await kv.expire(`used_dropship:${actor}`, 365 * 24 * 60 * 60);
      } catch {
        /* 非表示の焼き込み失敗は致命でない（出品自体は成功） */
      }
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
