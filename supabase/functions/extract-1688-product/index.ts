const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ProductDetails = {
  title: string;
  url: string;
  image: string;
  price: string;
  moq: string;
  supplier: string;
  variant: string;
  note: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function readMatch(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  return match ? decodeEntities(match[1].replace(/\\u002F/g, "/").replace(/\\"/g, '"').trim()) : "";
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function offerIdFrom(value: string) {
  return (
    value.match(/detail\.1688\.com\/offer\/(\d+)\.html/i)?.[1] ||
    value.match(/offer[\/=](\d+)/i)?.[1] ||
    value.match(/offerId["'=:%20]+(\d+)/i)?.[1] ||
    value.match(/"offerId":(\d+)/)?.[1] ||
    ""
  );
}

function normalize1688Url(value: string) {
  const id = offerIdFrom(value);
  return id ? `https://detail.1688.com/offer/${id}.html` : value.trim();
}

function assertAllowedUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(normalize1688Url(rawUrl));
  } catch {
    throw new Error("Invalid product URL");
  }

  const hostname = parsed.hostname.toLowerCase();
  const allowed =
    hostname === "detail.1688.com" ||
    hostname.endsWith(".1688.com") ||
    hostname === "1688.com";

  if (!allowed) throw new Error("Only 1688 product URLs are supported");
  return parsed.toString();
}

function extractFromHtml(html: string, sourceUrl: string): ProductDetails {
  const url = normalize1688Url(sourceUrl || html);
  const title =
    readMatch(html, /"subject":"([^"]+)"/) ||
    readMatch(html, /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
    readMatch(html, /<title>(.*?)\s*-\s*[^<]*<\/title>/is) ||
    readMatch(html, /<title>(.*?)<\/title>/is);

  const image =
    readMatch(html, /"fullPathImageURI":"([^"]+)"/) ||
    readMatch(html, /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
    readMatch(html, /"imageUrl":"(https?:\/\/[^"]+)"/) ||
    readMatch(html, /(https?:\/\/cbu01\.alicdn\.com\/[^"'<\s]+?\.(?:jpg|jpeg|png|webp))/i);

  const price =
    readMatch(html, /"priceDisplay":"([^"]+)"/) ||
    readMatch(html, /"originalPriceDisplay":"([^"]+)"/) ||
    readMatch(html, /"minPrice":"([^"]+)"/);

  const supplier =
    readMatch(html, /"companyName":"([^"]+)"/) ||
    readMatch(html, /"loginId":"([^"]+)"/);

  const color = readMatch(html, /"prop":"Color","value":\[\{"(?:imageUrl":"[^"]+",)?"name":"([^"]+)"/);
  const sizesBlock = readMatch(html, /"prop":"Size","value":\[(.*?)\]/);
  const sizes = [...sizesBlock.matchAll(/"name":"([^"]+)"/g)].map((match) => decodeEntities(match[1])).join(", ");
  const beginAmount = readMatch(html, /"beginAmount":(\d+)/);
  const offerId = offerIdFrom(url || html);

  return {
    title,
    url,
    image,
    price: price ? `CNY ${price}` : "",
    moq: beginAmount ? `MOQ ${beginAmount}` : "",
    supplier,
    variant: [color && `Color: ${color}`, sizes && `Sizes: ${sizes}`].filter(Boolean).join(" | "),
    note: offerId ? `Extracted from 1688 offer ${offerId}` : "Extracted from 1688 page",
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const rawUrl = String(body.url || "").trim();
    const pastedHtml = String(body.html || "").trim();

    if (!rawUrl && !pastedHtml) {
      return jsonResponse({ error: "Provide a 1688 product URL or page HTML" }, 400);
    }

    if (pastedHtml) {
      return jsonResponse({ product: extractFromHtml(pastedHtml, rawUrl) });
    }

    const url = assertAllowedUrl(rawUrl);
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
      },
    });

    if (!response.ok) {
      return jsonResponse({ error: `1688 fetch failed with status ${response.status}` }, 502);
    }

    const html = await response.text();
    const product = extractFromHtml(html, url);
    return jsonResponse({ product });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected extraction error" }, 500);
  }
});
