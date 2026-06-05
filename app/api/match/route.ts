import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ========== キャッシュ（24時間TTL） ==========
const cache = new Map<string, { matched: boolean; confidence: number; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function getCached(key: string) {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry;
}
function setCache(key: string, data: { matched: boolean; confidence: number }) {
  if (cache.size >= 1000) { const k = cache.keys().next().value; if (k) cache.delete(k); }
  cache.set(key, { ...data, expiresAt: Date.now() + CACHE_TTL });
}

// ========== 型番・商品コード抽出 ==========
function extractProductCode(title: string): string[] {
  const patterns = [
    /[A-Z]{2,}-?\d{3,}/g,          // SW-1234, PS5, SV1S
    /\b[A-Z]\d{4,}[A-Z]?\b/g,      // F4567A
    /\b\d{4}-\d{4}\b/g,            // 1234-5678
    /(?:第\d+弾|Vol\.\d+|BOX\d*)/g, // 第3弾, Vol.2
  ];
  const codes: string[] = [];
  for (const pattern of patterns) {
    const matches = title.match(pattern) ?? [];
    codes.push(...matches);
  }
  return [...new Set(codes)];
}

// ========== pHash（簡易版：ピクセルサンプリング） ==========
async function fetchImageBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mimeType = res.headers.get("content-type") ?? "image/jpeg";
    return { base64, mimeType };
  } catch {
    return null;
  }
}

// ========== Gemini画像マッチング ==========
async function matchWithGemini(
  rakutenTitle: string,
  rakutenImageUrl: string,
  mercariTitle: string,
  mercariImageUrl: string
): Promise<{ matched: boolean; confidence: number }> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return { matched: false, confidence: 0 };

  try {
    const [img1, img2] = await Promise.all([
      fetchImageBase64(rakutenImageUrl),
      fetchImageBase64(mercariImageUrl),
    ]);

    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const parts: any[] = [
      {
        text: `以下の2つの商品が同じ商品かどうか判定してください。
楽天商品名: ${rakutenTitle}
メルカリ商品名: ${mercariTitle}

画像も参考にしてください。
同じ商品なら "YES"、違うなら "NO" と、信頼度を0-100で答えてください。
形式: YES:85 または NO:20`
      },
    ];

    if (img1) parts.push({ inlineData: { data: img1.base64, mimeType: img1.mimeType } });
    if (img2) parts.push({ inlineData: { data: img2.base64, mimeType: img2.mimeType } });

    const result = await model.generateContent(parts);
    const text = result.response.text().trim();

    const match = text.match(/(YES|NO):(\d+)/i);
    if (!match) return { matched: false, confidence: 0 };

    const matched = match[1].toUpperCase() === "YES";
    const confidence = parseInt(match[2]);
    return { matched, confidence };
  } catch {
    return { matched: false, confidence: 0 };
  }
}

// ========== メルカリ売り切れ商品取得（画像付き） ==========
async function getMercariSoldItems(keyword: string): Promise<Array<{ title: string; price: number; imageUrl: string }>> {
  try {
    const body = {
      pageSize: 10,
      pageToken: "",
      searchSessionId: Math.random().toString(36).slice(2),
      indexRouting: "INDEX_ROUTING_UNSPECIFIED",
      thumbnailTypes: [],
      searchCondition: {
        keyword,
        excludeKeyword: "",
        sort: "SORT_SCORE",
        order: "ORDER_DESC",
        status: ["STATUS_SOLD_OUT"],
        sizeId: [], categoryId: [], brandId: [], sellerId: [],
        priceMin: 0, priceMax: 0,
        itemConditionId: [], shippingPayerId: [], shippingFromArea: [],
        shippingMethod: [], colorId: [], hasCoupon: false,
        attributes: [], itemTypes: [], skuIds: [],
      },
      userId: "",
    };

    const res = await fetch("https://api.mercari.jp/v2/entities:search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://jp.mercari.com",
        "Referer": `https://jp.mercari.com/search?keyword=${encodeURIComponent(keyword)}&status=sold_out`,
        "X-Platform": "web",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) return [];
    const data = await res.json();
    return (data.items ?? []).map((item: any) => ({
      title: item.name ?? "",
      price: item.price ?? 0,
      imageUrl: item.thumbnails?.[0] ?? "",
    }));
  } catch {
    return [];
  }
}

// ========== メインAPIハンドラー ==========
export async function POST(req: NextRequest) {
  const { rakutenTitle, rakutenImageUrl, rakutenPrice } = await req.json();

  if (!rakutenTitle) return Response.json({ avgPrice: null, count: 0 });

  const cacheKey = `match_${rakutenTitle.slice(0, 30)}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json({ ...cached, fromCache: true });

  // Step1: タイトル正規化
  const codes = extractProductCode(rakutenTitle);
  const cleanTitle = rakutenTitle
    .replace(/【[^】]*】/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/（[^）]*）/g, "")
    .replace(/送料無料|新品|未開封|未使用|正規品|セール|互換|風/g, "")
    .replace(/\s+/g, " ").trim();

  // 型番がある場合は型番を主キーワードに
  // 英字ブランド名（LEGO, Pokemon等）を優先
  const brandMatch = cleanTitle.match(/\b[A-Z][A-Za-z]{2,}(?:\s+[A-Z][A-Za-z]+)?\b/);
  const brand = brandMatch ? brandMatch[0] : "";
  const jpWords = cleanTitle.replace(/[A-Za-z0-9]/g, " ").split(/\s+/).filter((w) => w.length >= 2).slice(0, 2).join(" ");

  let searchKeyword: string;
  if (codes.length > 0) {
    // 型番あり: 型番 + ブランドor日本語
    searchKeyword = brand ? `${brand} ${codes[0]}` : `${jpWords} ${codes[0]}`;
  } else if (brand) {
    // ブランド名あり
    searchKeyword = `${brand} ${jpWords}`.trim();
  } else {
    // 日本語のみ
    searchKeyword = jpWords || cleanTitle.split(/\s+/).slice(0, 3).join(" ");
  }

  // Step2: メルカリ売り切れ商品取得（通常 + リトライ用短縮キーワード）
  let mercariItems = await getMercariSoldItems(searchKeyword);
  if (mercariItems.length === 0 && searchKeyword.includes(" ")) {
    // キーワードを短縮してリトライ
    const shorter = searchKeyword.split(" ").slice(0, 2).join(" ");
    mercariItems = await getMercariSoldItems(shorter);
  }
  if (mercariItems.length === 0) {
    setCache(cacheKey, { matched: false, confidence: 0 });
    return Response.json({ matched: false, avgPrice: null, count: 0, confidence: 0 });
  }

  // Step3: 価格フィルター（仕入れ価格の50%〜400%）
  const priceFiltered = mercariItems.filter(
    (item) => item.price >= rakutenPrice * 0.5 && item.price <= rakutenPrice * 4
  );
  if (priceFiltered.length === 0) {
    setCache(cacheKey, { matched: false, confidence: 0 });
    return Response.json({ matched: false, avgPrice: null, count: 0, confidence: 0 });
  }

  // Step4: 型番一致 → 高信頼度で即確定
  if (codes.length > 0) {
    const codeMatches = priceFiltered.filter((item) =>
      codes.some((code) => item.title.toUpperCase().includes(code.toUpperCase()))
    );
    if (codeMatches.length > 0) {
      const prices = codeMatches.map((i) => i.price).sort((a, b) => a - b);
      // 外れ値除去（中央値の50〜200%）
      const median = prices[Math.floor(prices.length / 2)];
      const valid = prices.filter((p) => p >= median * 0.5 && p <= median * 2);
      const avgPrice = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
      const result = { matched: true, avgPrice, count: valid.length, confidence: 95 };
      setCache(cacheKey, { matched: true, confidence: 95 });
      return Response.json(result);
    }
  }

  // Step5: タイトル類似度チェック（Gemini前の簡易フィルター）
  // ブランド名または主要語が両方のタイトルに含まれるか確認
  const keyTokens = searchKeyword.toLowerCase().split(/\s+/);
  const titleMatches = priceFiltered.filter((item) => {
    const t = item.title.toLowerCase();
    const matchCount = keyTokens.filter((tok) => t.includes(tok)).length;
    return matchCount >= Math.ceil(keyTokens.length * 0.5); // 50%以上一致
  });
  const candidates = titleMatches.length > 0 ? titleMatches : priceFiltered;
  const bestMatch = candidates[0];

  // Step6: Gemini画像認識でマッチング
  if (rakutenImageUrl && bestMatch.imageUrl) {
    const geminiResult = await matchWithGemini(
      rakutenTitle, rakutenImageUrl,
      bestMatch.title, bestMatch.imageUrl
    );

    if (geminiResult.matched && geminiResult.confidence >= 65) {
      const prices = candidates.map((i) => i.price).sort((a, b) => a - b);
      const median = prices[Math.floor(prices.length / 2)];
      const valid = prices.filter((p) => p >= median * 0.5 && p <= median * 2);
      const avgPrice = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
      const result = { matched: true, avgPrice, count: valid.length, confidence: geminiResult.confidence };
      setCache(cacheKey, { matched: true, confidence: geminiResult.confidence });
      return Response.json(result);
    }
  }

  setCache(cacheKey, { matched: false, confidence: 0 });
  return Response.json({ matched: false, avgPrice: null, count: 0, confidence: 0 });
}
