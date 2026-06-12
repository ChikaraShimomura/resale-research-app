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

export async function GET(req: Request) {
  const zip = (new URL(req.url).searchParams.get("zip") ?? "").replace(/[^0-9]/g, "");
  if (zip.length !== 7) {
    return Response.json({ ok: false, error: "郵便番号は7桁で入力してください。" }, { status: 400 });
  }
  try {
    const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { results?: ZipResult[] | null };
    const r = data.results?.[0];
    if (!r) {
      return Response.json({ ok: false, error: "該当する住所が見つかりませんでした。" }, { status: 404 });
    }
    const en = romanizeAddress({
      prefcode: r.prefcode,
      cityKanji: r.address2,
      cityKana: r.kana2,
      townKana: r.kana3,
    });
    return Response.json(
      {
        ok: true,
        ja: { prefecture: r.address1 ?? "", city: r.address2 ?? "", town: r.address3 ?? "" },
        en, // { stateOrProvince, city, town }
      },
      { headers: { "Cache-Control": "public, max-age=86400" } }
    );
  } catch {
    return Response.json({ ok: false, error: "住所検索に失敗しました。" }, { status: 502 });
  }
}
