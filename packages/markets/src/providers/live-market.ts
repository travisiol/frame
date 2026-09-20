import type { MarketMetadata, MarketStatus, PriceHistory, PriceQuote, PriceRange, TokenInfo } from "@frame/types";
import { type MarketDataProvider, priceKey, unavailableQuote, usEquityMarketStatus } from "../market-data";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface LiveMarketOptions {
  fetchImpl?: FetchLike;
  yahooBase?: string;
  coingeckoBase?: string;
}

const YAHOO_RANGE: Record<PriceRange, { range: string; interval: string }> = {
  "1H": { range: "1d", interval: "1m" },
  "1D": { range: "1d", interval: "5m" },
  "1W": { range: "5d", interval: "15m" },
  "1M": { range: "1mo", interval: "1h" },
  "1Y": { range: "1y", interval: "1d" },
};

const GECKO_DAYS: Record<PriceRange, string> = { "1H": "1", "1D": "1", "1W": "7", "1M": "30", "1Y": "365" };

/**
 * Live prices without API keys:
 *  - Stock Tokens → Yahoo Finance chart endpoint for the UNDERLYING ticker
 *    (a reference price for the equity; the token may trade at a different
 *    price on-chain — the UI says "reference price").
 *  - ETH / cbBTC → CoinGecko simple price.
 *  - Stablecoins → pegged 1.00 (labelled).
 *  - Everything else → unavailable.
 */
export class LiveMarketDataProvider implements MarketDataProvider {
  readonly id = "live";
  private readonly fetchImpl: FetchLike;
  private readonly yahooBase: string;
  private readonly coingeckoBase: string;

  constructor(options: LiveMarketOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.yahooBase = options.yahooBase ?? "https://query1.finance.yahoo.com/v8/finance/chart";
    this.coingeckoBase = options.coingeckoBase ?? "https://api.coingecko.com/api/v3";
  }

  private async json(url: string): Promise<unknown> {
    const res = await this.fetchImpl(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  private async yahooChart(ticker: string, range: PriceRange): Promise<{ meta: Record<string, unknown>; ts: number[]; close: (number | null)[] } | null> {
    const spec = YAHOO_RANGE[range];
    const url = `${this.yahooBase}/${encodeURIComponent(ticker)}?range=${spec.range}&interval=${spec.interval}&includePrePost=false`;
    try {
      const data = (await this.json(url)) as { chart?: { result?: { meta?: Record<string, unknown>; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] } };
      const r = data.chart?.result?.[0];
      if (!r?.meta) return null;
      return { meta: r.meta, ts: r.timestamp ?? [], close: r.indicators?.quote?.[0]?.close ?? [] };
    } catch {
      return null;
    }
  }

  async getTokenPrice(token: TokenInfo): Promise<PriceQuote> {
    const feed = token.priceFeed;
    if (!feed || feed.provider === "none") return unavailableQuote(this.id);
    if (feed.provider === "pegged") return { priceUsd: 1, change24hPct: 0, updatedAt: Date.now(), source: "pegged" };
    if (feed.provider === "yahoo") {
      const chart = await this.yahooChart(feed.id, "1D");
      if (!chart) return unavailableQuote("yahoo");
      const price = Number(chart.meta.regularMarketPrice);
      const prev = Number(chart.meta.chartPreviousClose ?? chart.meta.previousClose);
      if (!Number.isFinite(price)) return unavailableQuote("yahoo");
      const change = Number.isFinite(prev) && prev > 0 ? ((price - prev) / prev) * 100 : null;
      return { priceUsd: price, change24hPct: change, updatedAt: Date.now(), source: "yahoo" };
    }
    if (feed.provider === "coingecko") {
      const map = await this.geckoPrices([feed.id]);
      return map.get(feed.id) ?? unavailableQuote("coingecko");
    }
    return unavailableQuote(this.id);
  }

  private async geckoPrices(ids: string[]): Promise<Map<string, PriceQuote>> {
    const out = new Map<string, PriceQuote>();
    if (!ids.length) return out;
    try {
      const url = `${this.coingeckoBase}/simple/price?ids=${encodeURIComponent(ids.join(","))}&vs_currencies=usd&include_24hr_change=true`;
      const data = (await this.json(url)) as Record<string, { usd?: number; usd_24h_change?: number }>;
      for (const id of ids) {
        const row = data[id];
        if (row?.usd !== undefined) out.set(id, { priceUsd: row.usd, change24hPct: row.usd_24h_change ?? null, updatedAt: Date.now(), source: "coingecko" });
      }
    } catch {
      /* unavailable */
    }
    return out;
  }

  async getPrices(tokens: TokenInfo[]): Promise<Map<string, PriceQuote>> {
    const out = new Map<string, PriceQuote>();
    const geckoIds = new Set<string>();
    for (const t of tokens) if (t.priceFeed?.provider === "coingecko") geckoIds.add(t.priceFeed.id);
    const gecko = await this.geckoPrices([...geckoIds]);
    await Promise.all(
      tokens.map(async (t) => {
        if (t.priceFeed?.provider === "coingecko") {
          out.set(priceKey(t), gecko.get(t.priceFeed.id) ?? unavailableQuote("coingecko"));
          return;
        }
        out.set(priceKey(t), await this.getTokenPrice(t));
      }),
    );
    return out;
  }

  async getPriceHistory(token: TokenInfo, range: PriceRange): Promise<PriceHistory | null> {
    const feed = token.priceFeed;
    if (!feed) return null;
    if (feed.provider === "yahoo") {
      const chart = await this.yahooChart(feed.id, range);
      if (!chart) return null;
      let points = chart.ts.map((t, i) => ({ t: t * 1000, p: chart.close[i] })).filter((x): x is { t: number; p: number } => typeof x.p === "number" && Number.isFinite(x.p));
      if (range === "1H") points = points.filter((p) => p.t >= Date.now() - 60 * 60_000);
      return points.length ? { range, points, source: "yahoo" } : null;
    }
    if (feed.provider === "coingecko") {
      try {
        const url = `${this.coingeckoBase}/coins/${encodeURIComponent(feed.id)}/market_chart?vs_currency=usd&days=${GECKO_DAYS[range]}`;
        const data = (await this.json(url)) as { prices?: [number, number][] };
        let points = (data.prices ?? []).map(([t, p]) => ({ t, p }));
        if (range === "1H") points = points.filter((p) => p.t >= Date.now() - 60 * 60_000);
        return points.length ? { range, points, source: "coingecko" } : null;
      } catch {
        return null;
      }
    }
    if (feed.provider === "pegged") {
      const now = Date.now();
      return { range, points: [{ t: now - 86_400_000, p: 1 }, { t: now, p: 1 }], source: "pegged" };
    }
    return null;
  }

  async get24hChange(token: TokenInfo): Promise<number | null> {
    return (await this.getTokenPrice(token)).change24hPct;
  }

  async getMarketMetadata(token: TokenInfo): Promise<MarketMetadata> {
    const feed = token.priceFeed;
    if (feed?.provider === "yahoo") {
      const chart = await this.yahooChart(feed.id, "1D");
      const cap = chart?.meta.marketCap;
      const vol = chart?.meta.regularMarketVolume;
      return { marketCap: typeof cap === "number" ? cap : null, volume24h: typeof vol === "number" ? vol : null, source: "yahoo" };
    }
    return { source: this.id };
  }

  async getMarketStatus(token: TokenInfo): Promise<MarketStatus> {
    if (token.priceFeed?.provider === "yahoo") return usEquityMarketStatus();
    if (token.category === "native" || token.category === "crypto" || token.category === "stable" || token.category === "ecosystem") return "24-7";
    return "unknown";
  }
}
