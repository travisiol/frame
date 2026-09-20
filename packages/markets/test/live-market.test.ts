import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { findToken, makeUnknownToken, nativeToken } from "@frame/token-registry";
import { LiveMarketDataProvider } from "../src";

const CHAIN = 4663;
const NVDA = findToken(CHAIN, "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec")!;
const ZERO = "0x0000000000000000000000000000000000000000";

function fetchStub(routes: (url: string) => { status: number; body?: unknown }) {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    const r = routes(url);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}

const yahooOk = { chart: { result: [{ meta: { regularMarketPrice: 184.2, chartPreviousClose: 180 }, timestamp: [], indicators: { quote: [{ close: [] }] } }] } };
const lifiList = { tokens: { [String(CHAIN)]: [{ address: NVDA.address, priceUSD: "220.96" }, { address: ZERO, priceUSD: "2576.6" }] } };

describe("live market data", () => {
  it("uses Yahoo as the reference price for Stock Tokens", async () => {
    const { fetchImpl } = fetchStub((url) => (url.includes("finance.yahoo.com") ? { status: 200, body: yahooOk } : { status: 404 }));
    const q = await new LiveMarketDataProvider({ fetchImpl }).getTokenPrice(NVDA);
    expect(q.source).toBe("yahoo");
    expect(q.priceUsd).toBe(184.2);
    expect(q.change24hPct).toBeCloseTo(2.333, 2);
  });

  it("falls back to the onchain LI.FI price when the reference source is rate-limited — and never invents a 24h change", async () => {
    const { fetchImpl, calls } = fetchStub((url) => (url.includes("finance.yahoo.com") ? { status: 429 } : url.includes("li.quest/v1/tokens") ? { status: 200, body: lifiList } : { status: 404 }));
    const p = new LiveMarketDataProvider({ fetchImpl });
    expect(await p.getTokenPrice(NVDA)).toMatchObject({ priceUsd: 220.96, change24hPct: null, source: "lifi" });
    // CoinGecko down too → native ETH comes from the same list (zero address)
    expect(await p.getTokenPrice(nativeToken(CHAIN))).toMatchObject({ priceUsd: 2576.6, source: "lifi" });
    // one token-list request serves every fallback
    expect(calls.filter((u) => u.includes("li.quest/v1/tokens")).length).toBe(1);
  });

  it("prices tokens without any feed from the onchain list, and stays unavailable when nothing knows them", async () => {
    const { fetchImpl } = fetchStub((url) => (url.includes("li.quest/v1/tokens") ? { status: 200, body: lifiList } : { status: 429 }));
    const p = new LiveMarketDataProvider({ fetchImpl });
    const listed = makeUnknownToken(CHAIN, NVDA.address as Address, { symbol: "X", name: "Impostor", decimals: 18 });
    expect((await p.getTokenPrice(listed)).priceUsd).toBe(220.96);
    const unknown = makeUnknownToken(CHAIN, "0x000000000000000000000000000000000000beef", { symbol: "?", name: "?", decimals: 18 });
    expect((await p.getTokenPrice(unknown)).priceUsd).toBeNull();
  });

  it("routes reference prices through the relay but calls LI.FI directly (it allows browsers)", async () => {
    const { fetchImpl, calls } = fetchStub((url) => (url.startsWith("/api/market?url=") ? { status: 429 } : url.includes("li.quest") ? { status: 200, body: lifiList } : { status: 404 }));
    const p = new LiveMarketDataProvider({ fetchImpl, relay: (u) => `/api/market?url=${encodeURIComponent(u)}` });
    await p.getTokenPrice(NVDA);
    expect(calls.some((u) => u.startsWith("/api/market?url=https%3A%2F%2Fquery1.finance.yahoo.com"))).toBe(true);
    expect(calls.some((u) => u.startsWith("https://li.quest/v1/tokens?chains=4663"))).toBe(true);
  });

  it("limits concurrent reference-price requests so a long markets list never bursts", async () => {
    let active = 0;
    let peak = 0;
    const fetchImpl = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 1, chartPreviousClose: 1 } }] } }), { status: 200 });
    };
    const p = new LiveMarketDataProvider({ fetchImpl, concurrency: 3, lifiBase: null });
    const tokens = Array.from({ length: 12 }, (_, i) => ({ ...NVDA, address: `0x${String(i + 1).padStart(40, "0")}` as Address, priceFeed: { provider: "yahoo" as const, id: `T${i}` } }));
    const prices = await p.getPrices(tokens);
    expect(prices.size).toBe(12);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("trips a circuit breaker after repeated reference failures so a portfolio never waits on dozens of doomed requests", async () => {
    let clock = 1_000_000;
    const { fetchImpl, calls } = fetchStub((url) => (url.includes("finance.yahoo.com") ? { status: 429 } : url.includes("li.quest/v1/tokens") ? { status: 200, body: lifiList } : { status: 404 }));
    const p = new LiveMarketDataProvider({ fetchImpl, now: () => clock, concurrency: 1 });
    const tokens = Array.from({ length: 8 }, (_, i) => ({ ...NVDA, priceFeed: { provider: "yahoo" as const, id: "T" + i } }));
    const prices = await p.getPrices(tokens);
    // every token still gets the onchain price…
    expect([...prices.values()].every((q) => q.priceUsd === 220.96 && q.source === "lifi")).toBe(true);
    // …but Yahoo was only asked three times before being paused
    expect(calls.filter((u) => u.includes("finance.yahoo.com")).length).toBe(3);
    expect(p.referencePaused).toBe(true);
    // a minute later the reference source is tried again
    clock += 61_000;
    await p.getTokenPrice(NVDA);
    expect(calls.filter((u) => u.includes("finance.yahoo.com")).length).toBe(4);
  });
});
