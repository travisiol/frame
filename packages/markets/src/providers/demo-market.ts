import type { MarketMetadata, MarketStatus, PriceHistory, PriceQuote, PriceRange, TokenInfo } from "@frame/types";
import { type MarketDataProvider, priceKey, unavailableQuote, usEquityMarketStatus } from "../market-data";

/**
 * Demo prices. Every quote and every history point is flagged `demo: true`
 * so the UI can label it — they are illustrative, not market data.
 */
export const DEMO_PRICES: Record<string, { price: number; change: number }> = {
  ETH: { price: 2642.0, change: 3.12 },
  NVDA: { price: 184.2, change: 2.41 },
  TSLA: { price: 350.8, change: -0.72 },
  AAPL: { price: 228.08, change: 1.18 },
  USDG: { price: 1.0, change: 0 },
  cbBTC: { price: 97240.0, change: 1.64 },
  SPY: { price: 571.4, change: 0.63 },
  QQQ: { price: 496.2, change: 0.91 },
  META: { price: 612.33, change: -1.24 },
  AMZN: { price: 203.87, change: 0.42 },
  MSFT: { price: 421.14, change: 0.28 },
  GOOGL: { price: 176.91, change: 1.02 },
  AMD: { price: 156.6, change: 3.44 },
  COIN: { price: 244.5, change: -2.1 },
  MSTR: { price: 318.7, change: 4.8 },
  PLTR: { price: 88.42, change: 2.05 },
  NFLX: { price: 902.1, change: -0.35 },
  GME: { price: 24.11, change: 6.2 },
  AMC: { price: 3.41, change: -3.9 },
  GLD: { price: 248.3, change: 0.55 },
  SLV: { price: 28.94, change: 1.1 },
  SGOV: { price: 100.61, change: 0.01 },
  USO: { price: 71.2, change: -1.4 },
  HIMS: { price: 31.9, change: 5.3 },
  RDDT: { price: 141.7, change: -2.7 },
  DEMO: { price: 0.1, change: 12.4 },
};

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const RANGE_SPEC: Record<PriceRange, { points: number; stepMs: number; vol: number }> = {
  "1H": { points: 60, stepMs: 60_000, vol: 0.0006 },
  "1D": { points: 96, stepMs: 15 * 60_000, vol: 0.0025 },
  "1W": { points: 84, stepMs: 2 * 60 * 60_000, vol: 0.006 },
  "1M": { points: 90, stepMs: 8 * 60 * 60_000, vol: 0.012 },
  "1Y": { points: 120, stepMs: 3 * 24 * 60 * 60_000, vol: 0.03 },
};

export class DemoMarketDataProvider implements MarketDataProvider {
  readonly id = "demo";

  private lookup(token: TokenInfo) {
    return DEMO_PRICES[token.symbol] ?? (token.category === "stable" ? { price: 1, change: 0 } : undefined);
  }

  async getTokenPrice(token: TokenInfo): Promise<PriceQuote> {
    const p = this.lookup(token);
    if (!p) return { ...unavailableQuote(this.id), demo: true };
    return { priceUsd: p.price, change24hPct: p.change, updatedAt: Date.now(), source: "demo", demo: true };
  }

  async getPrices(tokens: TokenInfo[]): Promise<Map<string, PriceQuote>> {
    const out = new Map<string, PriceQuote>();
    for (const t of tokens) out.set(priceKey(t), await this.getTokenPrice(t));
    return out;
  }

  /** Deterministic random walk that ends at the current demo price. Labelled demo. */
  async getPriceHistory(token: TokenInfo, range: PriceRange): Promise<PriceHistory | null> {
    const p = this.lookup(token);
    if (!p) return null;
    const spec = RANGE_SPEC[range];
    const rand = mulberry32(seedFrom(`${token.symbol}:${range}`));
    const now = Date.now();
    const rel: number[] = [1];
    for (let i = 1; i < spec.points; i++) {
      const last = rel[i - 1] ?? 1;
      rel.push(last * (1 + (rand() - 0.5) * 2 * spec.vol));
    }
    const end = rel[rel.length - 1] ?? 1;
    const base = rel.map((r) => (p.price * r) / end);
    // 1D must agree with the quoted 24h change: tilt the walk so it starts where yesterday's price was.
    const start = range === "1D" ? p.price / (1 + p.change / 100) : base[0]!;
    const n = base.length;
    const points = base.map((v, i) => ({ t: now - (n - 1 - i) * spec.stepMs, p: v + (start - base[0]!) * (1 - i / (n - 1)) }));
    return { range, points, source: "demo", demo: true };
  }

  async get24hChange(token: TokenInfo): Promise<number | null> {
    return this.lookup(token)?.change ?? null;
  }

  async getMarketMetadata(token: TokenInfo): Promise<MarketMetadata> {
    const p = this.lookup(token);
    if (!p) return { source: "demo" };
    const seed = seedFrom(token.symbol);
    return {
      marketCap: token.category === "stable" ? 1_250_000_000 : p.price * (1_000_000 + (seed % 9_000_000)),
      volume24h: p.price * (10_000 + (seed % 90_000)),
      holders: 1_200 + (seed % 48_000),
      liquidityUsd: token.category === "ecosystem" ? 42_000 + (seed % 200_000) : 1_500_000 + (seed % 5_000_000),
      ageDays: token.category === "ecosystem" ? 3 + (seed % 40) : 120 + (seed % 300),
      source: "demo",
    };
  }

  async getMarketStatus(token: TokenInfo): Promise<MarketStatus> {
    if (token.priceFeed?.provider === "yahoo") return usEquityMarketStatus();
    if (token.category === "unknown" || token.category === "ecosystem") return "24-7";
    return "24-7";
  }
}
