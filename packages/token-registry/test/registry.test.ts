import { describe, expect, it } from "vitest";
import { ROBINHOOD_MAINNET_ID, ROBINHOOD_TESTNET_ID } from "@frame/config";
import {
  allocationBucket,
  displayName,
  exposureLabel,
  findBySymbol,
  findToken,
  getRegistry,
  isImpersonatingSymbol,
  isVerified,
  knownSpenderLabel,
  looksLikeSpam,
  makeUnknownToken,
  searchRegistry,
} from "../src";

const CHAIN = ROBINHOOD_MAINNET_ID;
const NVDA = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec";

describe("token registry", () => {
  it("is well formed: lowercase unique addresses, sane decimals, every Stock Token has an underlying", () => {
    const list = getRegistry(CHAIN).filter((t) => t.address !== "native");
    expect(list.length).toBeGreaterThanOrEqual(60);
    const addrs = list.map((t) => t.address);
    expect(new Set(addrs).size).toBe(addrs.length);
    for (const t of list) {
      expect(t.address).toMatch(/^0x[0-9a-f]{40}$/);
      expect([6, 8, 18]).toContain(t.decimals);
      expect(t.verified).toBe(true);
      if (t.category === "stock-token" || t.category === "etf" || t.category === "rwa") {
        expect(t.underlying?.ticker).toBeTruthy();
        expect(t.name).toMatch(/• Robinhood Token$/);
        expect(t.priceFeed?.provider).toBe("yahoo");
      }
    }
    expect(getRegistry(ROBINHOOD_TESTNET_ID).filter((t) => t.address !== "native")).toHaveLength(0);
  });

  it("verifies by contract address only", () => {
    expect(findToken(CHAIN, NVDA.toUpperCase().replace("0X", "0x"))?.symbol).toBe("NVDA");
    expect(isVerified(CHAIN, NVDA)).toBe(true);
    expect(isVerified(CHAIN, "0x1111111111111111111111111111111111111111")).toBe(false);
    expect(findToken(CHAIN, "native")?.category).toBe("native");
    const usdg = findToken(CHAIN, "0x5fc5360d0400a0fd4f2af552add042d716f1d168")!;
    expect(usdg.decimals).toBe(6);
    expect(usdg.category).toBe("stable");
  });

  it("a look-alike ticker is never verified and is flagged as impersonating", () => {
    const fake = makeUnknownToken(CHAIN, "0x2222222222222222222222222222222222222222", { symbol: "NVDA", name: "NVIDIA • Robinhood Token", decimals: 18 });
    expect(fake.verified).toBe(false);
    expect(fake.category).toBe("unknown");
    expect(isImpersonatingSymbol(CHAIN, fake)).toBe(true);
    expect(findBySymbol(CHAIN, "nvda")).toHaveLength(1);
    expect(findBySymbol(CHAIN, "nvda")[0]?.address).toBe(NVDA);
  });

  it("hides unsolicited spam by shape, never by interacting", () => {
    expect(looksLikeSpam(makeUnknownToken(CHAIN, "0x3333333333333333333333333333333333333333", { symbol: "CLAIM", name: "Visit claim-rewards.xyz to claim", decimals: 18 }))).toBe(true);
    expect(looksLikeSpam(makeUnknownToken(CHAIN, "0x3333333333333333333333333333333333333333", { symbol: "$500 BONUS", name: "Reward", decimals: 18 }))).toBe(true);
    // A short project name with a TLD is not, by itself, spam — the heuristic stays conservative.
    expect(looksLikeSpam(makeUnknownToken(CHAIN, "0x4444444444444444444444444444444444444444", { symbol: "ORBIO", name: "Orbio.so", decimals: 18 }))).toBe(false);
    expect(looksLikeSpam(makeUnknownToken(CHAIN, "0x5555555555555555555555555555555555555555", { symbol: "SHROOM", name: "MUSHROOM", decimals: 18 }))).toBe(false);
    expect(looksLikeSpam(findToken(CHAIN, NVDA)!)).toBe(false);
  });

  it("search ranks exact tickers first and resolves addresses", () => {
    expect(searchRegistry(CHAIN, "nvda")[0]?.symbol).toBe("NVDA");
    expect(searchRegistry(CHAIN, "apple")[0]?.symbol).toBe("AAPL");
    expect(searchRegistry(CHAIN, "s&p")[0]?.symbol).toBe("SPY");
    expect(searchRegistry(CHAIN, NVDA)).toHaveLength(1);
    expect(searchRegistry(CHAIN, "")).toHaveLength(0);
    expect(searchRegistry(CHAIN, "• Robinhood").length).toBe(20); // default page
    expect(searchRegistry(CHAIN, "• Robinhood", 100).length).toBeGreaterThan(50);
  });

  it("wording never claims ownership of the underlying share", () => {
    const nvda = findToken(CHAIN, NVDA)!;
    expect(displayName(nvda)).toBe("NVDA Stock Token");
    expect(exposureLabel(nvda)).toBe("Tokenized NVDA exposure");
    expect(allocationBucket(nvda.category)).toBe("stocks");
    expect(allocationBucket("stable")).toBe("stables");
    expect(allocationBucket("native")).toBe("crypto");
    expect(allocationBucket("rwa")).toBe("stocks");
  });

  it("labels known spenders", () => {
    expect(knownSpenderLabel(CHAIN, "0x7ED598BcEf8bd9Edd8C97A195C6d13f40801EC7e")).toBe("Pons V2 Factory");
    expect(knownSpenderLabel(CHAIN, "0x9999999999999999999999999999999999999999")).toBeUndefined();
  });
});
