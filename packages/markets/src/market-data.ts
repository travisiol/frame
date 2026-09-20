import type { MarketMetadata, MarketStatus, PriceHistory, PriceQuote, PriceRange, TokenInfo } from "@frame/types";

/**
 * MarketDataProvider — the UI never talks to a price API directly.
 * Implementations: DemoMarketDataProvider (labelled demo data) and
 * LiveMarketDataProvider (Yahoo Finance for underlying equities, CoinGecko
 * for crypto, pegged for stables). Anything unknown is "PRICE UNAVAILABLE".
 */
export interface MarketDataProvider {
  readonly id: string;
  getTokenPrice(token: TokenInfo): Promise<PriceQuote>;
  getPrices(tokens: TokenInfo[]): Promise<Map<string, PriceQuote>>;
  getPriceHistory(token: TokenInfo, range: PriceRange): Promise<PriceHistory | null>;
  get24hChange(token: TokenInfo): Promise<number | null>;
  getMarketMetadata(token: TokenInfo): Promise<MarketMetadata>;
  getMarketStatus(token: TokenInfo): Promise<MarketStatus>;
}

export function priceKey(token: TokenInfo): string {
  return token.address === "native" ? "native" : token.address.toLowerCase();
}

export function unavailableQuote(source: string): PriceQuote {
  return { priceUsd: null, change24hPct: null, updatedAt: Date.now(), source };
}

/**
 * Approximate US equity session status from wall-clock time in New York.
 * Holidays are not modelled — the label is contextual information about the
 * underlying market, never a statement about whether the token can move.
 */
export function usEquityMarketStatus(now: Date = new Date()): MarketStatus {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const mins = hour * 60 + minute;
  if (weekday === "Sat" || weekday === "Sun") return "closed";
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return "pre-market";
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return "open";
  if (mins >= 16 * 60 && mins < 20 * 60) return "after-hours";
  return "closed";
}

export function marketStatusLabel(status: MarketStatus): string {
  switch (status) {
    case "open":
      return "MARKET OPEN";
    case "pre-market":
      return "PRE-MARKET";
    case "after-hours":
      return "AFTER HOURS";
    case "closed":
      return "MARKET CLOSED";
    case "24-7":
      return "TRADES 24/7";
    default:
      return "STATUS UNKNOWN";
  }
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** TTL cache wrapper so popup re-renders never hammer a price API. */
export class CachedMarketData implements MarketDataProvider {
  readonly id: string;
  private readonly prices = new Map<string, CacheEntry<PriceQuote>>();
  private readonly history = new Map<string, CacheEntry<PriceHistory | null>>();
  private readonly metadata = new Map<string, CacheEntry<MarketMetadata>>();
  private inflight = new Map<string, Promise<PriceQuote>>();

  constructor(
    private readonly inner: MarketDataProvider,
    private readonly ttl = { priceMs: 60_000, historyMs: 5 * 60_000, metadataMs: 10 * 60_000 },
  ) {
    this.id = inner.id;
  }

  async getTokenPrice(token: TokenInfo): Promise<PriceQuote> {
    const key = priceKey(token);
    const hit = this.prices.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    let p = this.inflight.get(key);
    if (!p) {
      p = this.inner
        .getTokenPrice(token)
        .then((q) => {
          // Never cache a failed lookup for long — the user should see prices come back.
          this.prices.set(key, { value: q, expiresAt: Date.now() + (q.priceUsd === null ? 10_000 : this.ttl.priceMs) });
          return q;
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  async getPrices(tokens: TokenInfo[]): Promise<Map<string, PriceQuote>> {
    const out = new Map<string, PriceQuote>();
    const missing: TokenInfo[] = [];
    for (const t of tokens) {
      const hit = this.prices.get(priceKey(t));
      if (hit && hit.expiresAt > Date.now()) out.set(priceKey(t), hit.value);
      else missing.push(t);
    }
    if (missing.length) {
      const fresh = await this.inner.getPrices(missing);
      for (const [k, q] of fresh) {
        this.prices.set(k, { value: q, expiresAt: Date.now() + (q.priceUsd === null ? 10_000 : this.ttl.priceMs) });
        out.set(k, q);
      }
      for (const t of missing) if (!out.has(priceKey(t))) out.set(priceKey(t), unavailableQuote(this.id));
    }
    return out;
  }

  async getPriceHistory(token: TokenInfo, range: PriceRange): Promise<PriceHistory | null> {
    const key = `${priceKey(token)}:${range}`;
    const hit = this.history.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = await this.inner.getPriceHistory(token, range);
    this.history.set(key, { value, expiresAt: Date.now() + (value ? this.ttl.historyMs : 15_000) });
    return value;
  }

  async get24hChange(token: TokenInfo): Promise<number | null> {
    return (await this.getTokenPrice(token)).change24hPct;
  }

  async getMarketMetadata(token: TokenInfo): Promise<MarketMetadata> {
    const key = priceKey(token);
    const hit = this.metadata.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = await this.inner.getMarketMetadata(token);
    this.metadata.set(key, { value, expiresAt: Date.now() + this.ttl.metadataMs });
    return value;
  }

  getMarketStatus(token: TokenInfo): Promise<MarketStatus> {
    return this.inner.getMarketStatus(token);
  }
}
