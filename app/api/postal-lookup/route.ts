import { kv } from "@vercel/kv";
import { Ratelimit } from "@upstash/ratelimit";
import { headers } from "next/headers";
import { romanizeAddress } from "../../lib/jpAddress";

// 郵便番号 → 住所（zipcloud）。日本語の都道府県/市区町村/町名 + eBay用ローマ字を返す。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ZipResult {
  address1?: string; // 都道府県（漢字）
  address2?: string; // 市区町村（漢字）
  address3?: string; // 町域（漢字）
  kana2?: string; // 市区町村（カナ）
  kana3?: string; // 町域（カナ）
  prefcode?: string;
}

// 認証なしの外部API中継のため、IP単位でレート制限（zipcloud濫用・関数コスト膨張を防ぐ）。
const rlPerIp = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(40, "10 m"),
  prefix: "rl:zip:ip",
  analytics: false,
});

function clientIp(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "0.0.0.0";
}

const NO_STORE = { "Cache-Control": "no-store" };

// 町域として無効な値（市区一括コード等）か
function isFillerTown(s: string): boolean {
  return !s || /掲載がない|以下に|場合|その他|^一円$/.test(s);
}
// 末尾の括弧注記のみ除去（中間の文字は残す）
function cleanTown(s: string): string {
  return (s || "").replace(/[（(][^）)]*[）)]\s*$/, "").trim();
}

export async function GET(req: Request) {
  const zip = (new URL(req.url).searchParams.get("zip") ?? "").replace(/[^0-9]/g, "");
  if (zip.length !== 7) {
    return Response.json({ ok: false, error: "郵便番号は7桁で入力してください。" }, { status: 400, headers: NO_STORE });
  }

  // レート制限（KV障害時はフェイルオープンで可用性優先）
  try {
    const h = await headers();
    const { success } = await rlPerIp.limit(clientIp(h));
    if (!success) {
      return Response.json(
        { ok: false, error: "アクセスが集中しています。少し待ってから再度お試しください。" },
        { status: 429, headers: NO_STORE }
      );
    }
  } catch {
    /* フェイルオープン */
  }

  try {
    const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return Response.json({ ok: false, error: "住所検索に失敗しました。" }, { status: 502, headers: NO_STORE });
    }
    const data = (await res.json().catch(() => null)) as { results?: ZipResult[] | null } | null;
    const results = data?.results ?? [];
    const r = results[0];
    if (!r) {
      return Response.json({ ok: false, error: "該当する住所が見つかりませんでした。" }, { status: 404, headers: NO_STORE });
    }

    // 町域の候補（同一郵便番号で複数の町域が返ることがある）。一括コード・重複を除く。
    const seen = new Set<string>();
    const townCandidates: { ja: string; en: string }[] = [];
    for (const x of results) {
      const ja = isFillerTown(x.address3 ?? "") ? "" : cleanTown(x.address3 ?? "");
      if (!ja || seen.has(ja)) continue;
      seen.add(ja);
      townCandidates.push({ ja, en: romanizeAddress({ townKana: x.kana3 ?? "" }).town });
      if (townCandidates.length >= 20) break;
    }
    const primary = townCandidates[0] ?? { ja: "", en: "" };

    const en = romanizeAddress({
      prefKanji: r.address1,
      prefcode: r.prefcode,
      cityKanji: r.address2,
      cityKana: r.kana2,
      townKana: "", // town は候補側（primary）から採用するためここでは空
    });

    return Response.json(
      {
        ok: true,
        // 後方互換: ja.town/en.town は先頭候補（既存の EbayLocationSetup が参照）
        ja: { prefecture: r.address1 ?? "", city: r.address2 ?? "", town: primary.ja },
        en: { stateOrProvince: en.stateOrProvince, city: en.city, town: primary.en },
        townCandidates, // 複数あればUI側で選ばせる
      },
      { headers: NO_STORE }
    );
  } catch {
    return Response.json({ ok: false, error: "住所検索に失敗しました。" }, { status: 502, headers: NO_STORE });
  }
}
