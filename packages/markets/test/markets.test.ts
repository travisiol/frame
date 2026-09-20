import { describe, expect, it } from "vitest";
import { parseUnits, type Address } from "viem";
import type { ActivityItem, SwapQuoteRequest } from "@frame/types";
import { findToken, nativeToken } from "@frame/token-registry";
import { decodeTransaction, filterActivity, mergeActivity } from "@frame/transaction-engine";
import { DEMO_ROUTER_A, DEMO_ROUTER_B, DemoMarketDataProvider, LifiAdapter, MockBridgeProvider, MockSwapProvider, bestBridgeQuote, bestSwapQuote, CachedMarketData, LocalRiskProvider, usEquityMarketStatus } from "../src";

const CHAIN = 4663;
const ME: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const USDG = findToken(CHAIN, "0x5fc5360d0400a0fd4f2af552add042d716f1d168")!;
const NVDA = findToken(CHAIN, "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec")!;
const market = new DemoMarketDataProvider();

describe("swap routing", () => {
  const req: SwapQuoteRequest = { chainId: CHAIN, fromToken: USDG, toToken: NVDA, amountIn: parseUnits("100", 6).toString(), slippageBps: 50, account: ME };

  it("mock quotes are labelled demo and respect decimals", async () => {
    const q = await new MockSwapProvider("a", "A", DEMO_ROUTER_A, market, 30, 0.14).quote(req);
    expect(q?.demo).toBe(true);
    const out = Number(q!.amountOut) / 1e18;
    expect(out).toBeCloseTo(100 / 184.2, 1);
    expect(BigInt(q!.amountOutMin)).toBeLessThan(BigInt(q!.amountOut));
    expect(q?.approval?.spender).toBe(DEMO_ROUTER_A);
  });

  it("picks the best net output across providers", async () => {
    const a = new MockSwapProvider("a", "A", DEMO_ROUTER_A, market, 30, 0.14);
    const b = new MockSwapProvider("b", "B", DEMO_ROUTER_B, market, 25, 0.09);
    const { best, all } = await bestSwapQuote([a, b], req, 184.2);
    expect(all).toHaveLength(2);
    expect(best?.providerId).toBe("b");
  });

  it("builds an approve + swap the reviewer can decode", async () => {
    const a = new MockSwapProvider("a", "A", DEMO_ROUTER_A, market, 30, 0.14);
    const q = (await a.quote(req))!;
    const steps = await a.buildTransaction(q, req);
    expect(steps.map((s) => s.kind)).toEqual(["approve", "swap"]);
    const approve = decodeTransaction({ to: steps[0]!.tx.to, data: steps[0]!.tx.data });
    expect(approve).toMatchObject({ intent: "approve", spender: DEMO_ROUTER_A, unlimited: false });
    const swap = decodeTransaction({ to: steps[1]!.tx.to, data: steps[1]!.tx.data });
    expect(swap.intent).toBe("swap");
    expect(swap.swap?.tokenOut).toBe(NVDA.address);
    // ETH-in swaps need no approval.
    const ethReq = { ...req, fromToken: nativeToken(CHAIN), amountIn: parseUnits("1", 18).toString() };
    const ethSteps = await a.buildTransaction((await a.quote(ethReq))!, ethReq);
    expect(ethSteps.map((s) => s.kind)).toEqual(["swap"]);
    expect(ethSteps[0]!.tx.value).toBe(parseUnits("1", 18).toString());
  });

  it("LI.FI adapter only claims a route when the API returns one", async () => {
    const good = new LifiAdapter("https://li.quest/v1", {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            tool: "1inch",
            toolDetails: { name: "1inch" },
            estimate: { toAmount: "543000000000000000", toAmountMin: "540000000000000000", approvalAddress: "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae", executionDuration: 30, feeCosts: [{ amountUSD: "0.10" }], gasCosts: [{ amountUSD: "0.04" }] },
            transactionRequest: { to: "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae", data: "0xabcdef", value: "0x0", gasLimit: "0x30d40", chainId: 4663 },
            includedSteps: [{ tool: "1inch" }],
          }),
          { status: 200 },
        ),
    });
    const q = await good.quote(req);
    expect(q).toMatchObject({ providerId: "lifi", amountOut: "543000000000000000", feeUsd: 0.1, gasUsd: 0.04, estimatedSeconds: 30 });
    expect(q?.tx?.gas).toBe("200000");
    expect(q?.approval?.spender).toBe("0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae");
    const none = new LifiAdapter("https://li.quest/v1", { fetchImpl: async () => new Response("{}", { status: 404 }) });
    expect(await none.quote(req)).toBeNull();
  });

  it("bridge quotes rank by amount out", async () => {
    const fast = new MockBridgeProvider("fast", "Fast", market, 13, 45);
    const canonical = new MockBridgeProvider("canon", "Canonical", market, 4, 900);
    const { best, all } = await bestBridgeQuote([fast, canonical], { fromChainId: 1, toChainId: CHAIN, token: nativeToken(1), amountIn: parseUnits("1", 18).toString(), account: ME });
    expect(all).toHaveLength(2);
    expect(best?.providerId).toBe("canon");
    expect(BigInt(best!.amountOut)).toBe(parseUnits("0.9996", 18));
  });
});

describe("market data", () => {
  it("demo provider labels everything and is deterministic", async () => {
    const q = await market.getTokenPrice(NVDA);
    expect(q).toMatchObject({ priceUsd: 184.2, demo: true });
    const h1 = await market.getPriceHistory(NVDA, "1D");
    const h2 = await market.getPriceHistory(NVDA, "1D");
    expect(h1?.points.map((p) => p.p)).toEqual(h2?.points.map((p) => p.p));
    expect(h1?.points.at(-1)?.p).toBeCloseTo(184.2, 6);
    expect(h1?.demo).toBe(true);
    const unknown = await market.getTokenPrice({ ...NVDA, symbol: "ZZZ", address: "0x1234567890123456789012345678901234567890" });
    expect(unknown.priceUsd).toBeNull();
  });

  it("cache coalesces calls and does not pin failures", async () => {
    let calls = 0;
    const counting = new CachedMarketData({
      ...market,
      id: "counting",
      getTokenPrice: async (t) => {
        calls++;
        return market.getTokenPrice(t);
      },
      getPrices: market.getPrices.bind(market),
      getPriceHistory: market.getPriceHistory.bind(market),
      get24hChange: market.get24hChange.bind(market),
      getMarketMetadata: market.getMarketMetadata.bind(market),
      getMarketStatus: market.getMarketStatus.bind(market),
    });
    await Promise.all([counting.getTokenPrice(NVDA), counting.getTokenPrice(NVDA), counting.getTokenPrice(NVDA)]);
    expect(calls).toBe(1);
  });

  it("market status follows New York hours", () => {
    expect(usEquityMarketStatus(new Date("2026-09-21T14:00:00Z"))).toBe("open"); // Monday 10:00 ET
    expect(usEquityMarketStatus(new Date("2026-09-21T21:00:00Z"))).toBe("after-hours"); // 17:00 ET
    expect(usEquityMarketStatus(new Date("2026-09-19T15:00:00Z"))).toBe("closed"); // Saturday
    expect(usEquityMarketStatus(new Date("2026-09-21T09:00:00Z"))).toBe("pre-market"); // 05:00 ET
  });

  it("local risk provider says unknown, never scam", async () => {
    const risk = new LocalRiskProvider({ blockedOrigins: ["https://evil.example"], blockedContracts: [], allowedOrigins: [] });
    expect((await risk.checkOrigin("https://evil.example")).level).toBe("high");
    expect((await risk.checkOrigin("http://plain.example")).level).toBe("caution");
    expect((await risk.checkContract(CHAIN, NVDA.address as Address)).level).toBe("low");
    const unknown = await risk.checkContract(CHAIN, "0x9999999999999999999999999999999999999999");
    expect(unknown.level).toBe("caution");
    expect(unknown.reasons.join(" ")).not.toMatch(/scam/i);
  });
});

describe("activity", () => {
  const base: ActivityItem = { id: "x", kind: "send", title: "Sent ETH", amounts: [], timestamp: 1, status: "pending", chainId: CHAIN, source: "local", hash: "0xaa" };
  it("merges sources by hash and prefers local intent with explorer status", () => {
    const local = { ...base };
    const explorer: ActivityItem = { ...base, id: "e", title: "Contract interaction", status: "confirmed", source: "explorer", timestamp: 2 };
    const merged = mergeActivity([local], [explorer]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ title: "Sent ETH", status: "confirmed", source: "local" });
  });
  it("filters by kind and by Stock Token involvement", () => {
    const items: ActivityItem[] = [
      { ...base, id: "1", kind: "swap", tokenAddresses: [NVDA.address as string] },
      { ...base, id: "2", kind: "approve", hash: "0xbb" },
      { ...base, id: "3", kind: "bridge", hash: "0xcc" },
    ];
    expect(filterActivity(items, "swaps", () => false)).toHaveLength(1);
    expect(filterActivity(items, "approvals", () => false)).toHaveLength(1);
    expect(filterActivity(items, "bridge", () => false)).toHaveLength(1);
    expect(filterActivity(items, "stock-tokens", (a) => a === NVDA.address)).toHaveLength(1);
  });
});
