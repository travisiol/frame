/**
 * Same-origin market-data relay for the web app (Vercel Function).
 *
 * Yahoo Finance's chart endpoint has no CORS headers, so a web page cannot
 * read reference prices for Stock Tokens directly. This endpoint forwards a
 * strictly allow-listed set of read-only URLs (Yahoo chart, CoinGecko simple
 * price / market chart) and caches responses at the edge for a short time.
 * Upstream rate limits (429) are passed through untouched: the wallet then
 * falls back to onchain prices instead of waiting on retries.
 *
 *   GET /api/market?url=<encoded upstream URL>
 *
 * Nothing about the wallet is sent here besides the ticker being looked up.
 */

const ALLOWED: { host: string; path: RegExp }[] = [
  { host: "query1.finance.yahoo.com", path: /^\/v8\/finance\/chart\/[A-Za-z0-9.^=%-]+$/ },
  { host: "query2.finance.yahoo.com", path: /^\/v8\/finance\/chart\/[A-Za-z0-9.^=%-]+$/ },
  { host: "api.coingecko.com", path: /^\/api\/v3\/(simple\/price|coins\/[a-z0-9-]+\/market_chart)$/ },
];

export type Validation = { ok: true; target: string } | { ok: false; status: number; error: string };

/** Pure validation — exported for unit tests. */
export function validate(urlParam: string | null): Validation {
  if (!urlParam) return { ok: false, status: 400, error: "Missing url." };
  let target: URL;
  try {
    target = new URL(urlParam);
  } catch {
    return { ok: false, status: 400, error: "Invalid url." };
  }
  if (target.protocol !== "https:") return { ok: false, status: 400, error: "Only https upstreams." };
  const rule = ALLOWED.find((r) => r.host === target.host && r.path.test(target.pathname));
  if (!rule) return { ok: false, status: 403, error: "Upstream not allowed." };
  return { ok: true, target: target.href };
}

const HEADERS = {
  accept: "application/json",
  // Yahoo refuses requests without a browser-like user agent.
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const v = validate(url.searchParams.get("url"));
  if (!v.ok) return new Response(JSON.stringify({ error: v.error }), { status: v.status, headers: { "content-type": "application/json" } });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9_000);
  try {
    const res = await fetch(v.target, { headers: HEADERS, signal: controller.signal });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
        // Reference prices are fine a couple of minutes old; the edge cache keeps the upstream quiet.
        "cache-control": res.ok ? "public, s-maxage=120, stale-while-revalidate=600" : "no-store",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Upstream request failed." }), { status: 502, headers: { "content-type": "application/json" } });
  } finally {
    clearTimeout(timer);
  }
}
