import type { MarketMetadata, MarketStatus, PriceHistory, PriceQuote, PriceRange, TokenInfo } from "@frame/types";
import { type MarketDataProvider, priceKey, unavailableQuote, usEquityMarketStatus } from "../market-data";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface LiveMarketOptions {
  fetchImpl?: FetchLike;
  yahooBase?: string;
  coingeckoBase?: string;
  /**
   * LI.FI token list — onchain USD prices for every token it knows on a chain,
   * in one request. Used as the fallback when a reference source is unavailable
   * (Yahoo rate-limits datacenter IPs) and as the only source for tokens without
   * a reference feed. `null` disables it.
   */
  lifiBase?: string | null;
  /**
   * Rewrites reference-price URLs before they are fetched — the web app routes
   * Yahoo/CoinGecko through its same-origin relay (`/api/market?url=…`) because
   * Yahoo has no CORS headers. LI.FI allows browsers directly and is never relayed.
   */
  relay?: (url: string) => string;
  /** Max concurrent reference-price requests (a 60-row markets list must not fire 60 at once). */
  concurrency?: number;
  /** Clock, for tests. */
  now?: () => number;
}

const YAHOO_RANGE: Record<PriceRange, { range: string; interval: string }> = {
  "1H": { range: "1d", interval: "1m" },
  "1D": { range: "1d", interval: "5m" },
  "1W": { range: "5d", interval: "15m" },
  "1M": { range: "1mo", interval: "1h" },
  "1Y": { range: "1y", interval: "1d" },
};

const GECKO_DAYS: Record<PriceRange, string> = { "1H": "1", "1D": "1", "1W": "7", "1M": "30", "1Y": "365" };
const ONCHAIN_TTL_MS = 60_000;
const ZERO = "0x0000000000000000000000000000000000000000";
/** After this many consecutive HTTP failures, the reference source is skipped for a while (circuit breaker). */
const YAHOO_TRIP_AFTER = 3;
const YAHOO_PAUSE_MS = 60_000;

/** Tiny semaphore: at most `limit` calls in flight, the rest wait their turn. */
class Gate {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly limit: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

interface OnchainCache {
  at: number;
  prices: Map<string, number>;
  inflight?: Promise<Map<string, number>>;
}

interface Chart {
  meta: Record<string, unknown>;
  ts: number[];
  close: (number | null)[];
}

/**
 * Live prices without API keys:
 *  - Stock Tokens → Yahoo Finance chart endpoint for the UNDERLYING ticker
 *    (a reference price for the equity; the token may trade at a different
 *    price on-chain — the UI says "reference price").
 *  - ETH / cbBTC → CoinGecko simple price.
 *  - Stablecoins → pegged 1.00 (labelled).
 *  - Fallback for all of the above, and the only source for tokens without a
 *    feed → the onchain price LI.FI reports for the token itself (`source:
 *    "lifi"`, no 24h change — nothing is fabricated).
 *  - Otherwise → unavailable.
 *
 * When the reference source fails repeatedly (rate limit), it is skipped for a
 * minute so a portfolio never waits on dozens of doomed requests.
 */
export class LiveMarketDataProvider implements MarketDataProvider {
  readonly id = "live";
  private readonly fetchImpl: FetchLike;
  private readonly yahooBase: string;
  private readonly coingeckoBase: string;
  private readonly lifiBase: string | null;
  private readonly relay: (url: string) => string;
  private readonly gate: Gate;
  private readonly now: () => number;
  private readonly onchain = new Map<number, OnchainCache>();
  private yahooFailures = 0;
  private yahooPausedUntil = 0;

  constructor(options: LiveMarketOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.yahooBase = options.yahooBase ?? "https://query1.finance.yahoo.com/v8/finance/chart";
    this.coingeckoBase = options.coingeckoBase ?? "https://api.coingecko.com/api/v3";
    this.lifiBase = options.lifiBase === undefined ? "https://li.quest/v1" : options.lifiBase;
    this.relay = options.relay ?? ((u) => u);
    this.gate = new Gate(options.concurrency ?? 4);
    this.now = options.now ?? (() => Date.now());
  }

  private async json(url: string, direct = false): Promise<unknown> {
    const res = await this.fetchImpl(direct ? url : this.relay(url), { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /** True while the reference source is paused after repeated failures. */
  get referencePaused(): boolean {
    return this.now() < this.yahooPausedUntil;
  }

  private async yahooChart(ticker: string, spec: { range: string; interval: string }): Promise<Chart | null> {
    if (this.referencePaused) return null;
    const url = `${this.yahooBase}/${encodeURIComponent(ticker)}?range=${spec.range}&interval=${spec.interval}&includePrePost=false`;
    try {
      const res = await this.fetchImpl(this.relay(url), { headers: { accept: "application/json" } });
      if (!res.ok) {
        this.noteReferenceFailure();
        return null;
      }
      this.yahooFailures = 0;
      const data = (await res.json()) as { chart?: { result?: { meta?: Record<string, unknown>; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] } };
      const r = data.chart?.result?.[0];
      if (!r?.meta) return null;
      return { meta: r.meta, ts: r.timestamp ?? [], close: r.indicators?.quote?.[0]?.close ?? [] };
    } catch {
      this.noteReferenceFailure();
      return null;
    }
  }

  private noteReferenceFailure() {
    this.yahooFailures++;
    if (this.yahooFailures >= YAHOO_TRIP_AFTER) {
      this.yahooPausedUntil = this.now() + YAHOO_PAUSE_MS;
      this.yahooFailures = 0;
    }
  }

  /** Reference quote for an underlying ticker — a small 5-day daily chart carries the current price and previous close. */
  private async yahooQuote(ticker: string): Promise<PriceQuote | null> {
    if (this.referencePaused) return null;
    const chart = await this.gate.run(() => this.yahooChart(ticker, { range: "5d", interval: "1d" }));
    if (!chart) return null;
    const price = Number(chart.meta.regularMarketPrice);
    const prev = Number(chart.meta.chartPreviousClose ?? chart.meta.previousClose);
    if (!Number.isFinite(price)) return null;
    const change = Number.isFinite(prev) && prev > 0 ? ((price - prev) / prev) * 100 : null;
    return { priceUsd: price, change24hPct: change, updatedAt: this.now(), source: "yahoo" };
  }

  /** Onchain USD prices from LI.FI's token list: one request per chain, cached a minute, de-duplicated while in flight. */
  private async onchainPrices(chainId: number): Promise<Map<string, number>> {
    if (!this.lifiBase) return new Map();
    const entry = this.onchain.get(chainId);
    if (entry && this.now() - entry.at < ONCHAIN_TTL_MS) return entry.prices;
    if (entry?.inflight) return entry.inflight;
    const inflight = (async () => {
      const prices = new Map<string, number>();
      try {
        const data = (await this.json(`${this.lifiBase}/tokens?chains=${chainId}`, true)) as { tokens?: Record<string, { address?: string; priceUSD?: string }[]> };
        for (const t of data.tokens?.[String(chainId)] ?? []) {
          const p = Number(t.priceUSD);
          if (t.address && Number.isFinite(p) && p > 0) prices.set(t.address.toLowerCase(), p);
        }
      } catch {
        /* unavailable — quotes fall through to "unavailable" */
      }
      this.onchain.set(chainId, { at: this.now(), prices });
      return prices;
    })();
    this.onchain.set(chainId, { at: entry?.at ?? 0, prices: entry?.prices ?? new Map(), inflight });
    return inflight;
  }

  private async onchainQuote(token: TokenInfo): Promise<PriceQuote | null> {
    const key = token.address === "native" ? ZERO : token.address.toLowerCase();
    const price = (await this.onchainPrices(token.chainId)).get(key);
    return price === undefined ? null : { priceUsd: price, change24hPct: null, updatedAt: this.now(), source: "lifi" };
  }

  async getTokenPrice(token: TokenInfo): Promise<PriceQuote> {
    const feed = token.priceFeed;
    if (feed?.provider === "pegged") return { priceUsd: 1, change24hPct: 0, updatedAt: this.now(), source: "pegged" };
    if (feed?.provider === "yahoo") {
      const q = await this.yahooQuote(feed.id);
      if (q) return q;
    } else if (feed?.provider === "coingecko") {
      const q = (await this.geckoPrices([feed.id])).get(feed.id);
      if (q) return q;
    }
    return (await this.onchainQuote(token)) ?? unavailableQuote(feed?.provider === "yahoo" ? "yahoo" : feed?.provider === "coingecko" ? "coingecko" : this.id);
  }

  private async geckoPrices(ids: string[]): Promise<Map<string, PriceQuote>> {
    const out = new Map<string, PriceQuote>();
    if (!ids.length) return out;
    try {
      const url = `${this.coingeckoBase}/simple/price?ids=${encodeURIComponent(ids.join(","))}&vs_currencies=usd&include_24hr_change=true`;
      const data = (await this.json(url)) as Record<string, { usd?: number; usd_24h_change?: number }>;
      for (const id of ids) {
        const row = data[id];
        if (row?.usd !== undefined) out.set(id, { priceUsd: row.usd, change24hPct: row.usd_24h_change ?? null, updatedAt: this.now(), source: "coingecko" });
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
          out.set(priceKey(t), gecko.get(t.priceFeed.id) ?? (await this.onchainQuote(t)) ?? unavailableQuote("coingecko"));
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
      const chart = await this.gate.run(() => this.yahooChart(feed.id, YAHOO_RANGE[range]));
      if (!chart) return null;
      let points = chart.ts.map((t, i) => ({ t: t * 1000, p: chart.close[i] })).filter((x): x is { t: number; p: number } => typeof x.p === "number" && Number.isFinite(x.p));
      if (range === "1H") points = points.filter((p) => p.t >= this.now() - 60 * 60_000);
      return points.length ? { range, points, source: "yahoo" } : null;
    }
    if (feed.provider === "coingecko") {
      try {
        const url = `${this.coingeckoBase}/coins/${encodeURIComponent(feed.id)}/market_chart?vs_currency=usd&days=${GECKO_DAYS[range]}`;
        const data = (await this.json(url)) as { prices?: [number, number][] };
        let points = (data.prices ?? []).map(([t, p]) => ({ t, p }));
        if (range === "1H") points = points.filter((p) => p.t >= this.now() - 60 * 60_000);
        return points.length ? { range, points, source: "coingecko" } : null;
      } catch {
        return null;
      }
    }
    if (feed.provider === "pegged") {
      const now = this.now();
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
      const chart = await this.gate.run(() => this.yahooChart(feed.id, { range: "5d", interval: "1d" }));
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
