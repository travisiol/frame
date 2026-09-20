import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import { ETHEREUM_MAINNET_ID, ROBINHOOD_MAINNET_ID, ROBINHOOD_TESTNET_ID, addChainParams, getChainConfig, isPrimaryChain, parseHexChainId, toHexChainId } from "@frame/config";
import { ChainMismatchError, classifyAddressInput, createProxiedClient, formatTokenAmount, isLowGas, isUnlimitedAllowance, shortAddress, verifyChainId } from "../src";

describe("address safety", () => {
  it("classifies recipient input without rewriting it", () => {
    expect(classifyAddressInput("")).toEqual({ kind: "empty" });
    expect(classifyAddressInput("f39Fd6e51aad88F6F4ce6aB8827279cffFb92266")).toMatchObject({ kind: "invalid", reason: expect.stringContaining("0x") });
    expect(classifyAddressInput("0x1234")).toMatchObject({ kind: "invalid", reason: expect.stringContaining("42 characters") });
    expect(classifyAddressInput("vitalik.eth")).toMatchObject({ kind: "invalid", reason: expect.stringContaining("not configured") });
    const ok = classifyAddressInput("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
    expect(ok).toMatchObject({ kind: "address", address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", checksumMismatch: false, isZero: false });
    // Mixed case with a wrong checksum is a typo signal.
    const bad = classifyAddressInput("0xF39fd6e51aad88F6F4ce6aB8827279cffFb92266");
    expect(bad).toMatchObject({ kind: "address", checksumMismatch: true });
    expect(classifyAddressInput("0x0000000000000000000000000000000000000000")).toMatchObject({ kind: "address", isZero: true });
  });

  it("shortens with enough characters to spot substitutions", () => {
    expect(shortAddress("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266")).toBe("0xf39F…2266");
    expect(shortAddress("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", 6)).toBe("0xf39Fd6…b92266");
  });
});

describe("token amounts", () => {
  it("formats by decimals without fabricated digits", () => {
    expect(formatTokenAmount(parseUnits("25", 6), 6)).toBe("25");
    expect(formatTokenAmount(parseUnits("3128.5", 6), 6)).toBe("3,128.5");
    expect(formatTokenAmount(parseUnits("26.17", 18), 18)).toBe("26.17");
    expect(formatTokenAmount(1n, 18)).toBe("0.000000000000000001");
    expect(formatTokenAmount(0n, 18)).toBe("0");
    expect(formatTokenAmount(parseUnits("1234567.891", 18), 18)).toBe("1,234,567.891");
    // Grouping must not go through Number(): 2^256-1 with 6 decimals keeps every digit.
    expect(formatTokenAmount((1n << 256n) - 1n, 6)).toBe("115,792,089,237,316,195,423,570,985,008,687,907,853,269,984,665,640,564,039,457,584,007,913,129.63");
  });

  it("treats 2^96-1 and above as unlimited", () => {
    expect(isUnlimitedAllowance((1n << 96n) - 1n)).toBe(true);
    expect(isUnlimitedAllowance((1n << 256n) - 1n)).toBe(true);
    expect(isUnlimitedAllowance(parseUnits("1000000000", 18))).toBe(false);
  });

  it("low gas threshold", () => {
    expect(isLowGas(parseUnits("0.0005", 18), "0.001")).toBe(true);
    expect(isLowGas(parseUnits("0.05", 18), "0.001")).toBe(false);
    expect(isLowGas(0n, "not-a-number")).toBe(false);
  });
});

describe("chain configuration", () => {
  it("orders RPCs: dedicated env → user custom → public fallback", () => {
    const cfg = getChainConfig(ROBINHOOD_MAINNET_ID, { env: { [ROBINHOOD_MAINNET_ID]: "https://dedicated.example/rpc" }, custom: { [ROBINHOOD_MAINNET_ID]: "https://mine.example/rpc" } });
    expect(cfg.rpcUrls).toEqual(["https://dedicated.example/rpc", "https://mine.example/rpc", "https://rpc.mainnet.chain.robinhood.com"]);
    expect(cfg.explorerUrl).toBe("https://robinhoodchain.blockscout.com");
    expect(getChainConfig(ROBINHOOD_TESTNET_ID).testnet).toBe(true);
    expect(getChainConfig(ROBINHOOD_TESTNET_ID).rpcUrls).toEqual(["https://rpc.testnet.chain.robinhood.com"]);
    expect(() => getChainConfig(999)).toThrow(/Unsupported/);
  });

  it("only Robinhood Chain networks are switchable; Ethereum is a bridge source", () => {
    expect(isPrimaryChain(ROBINHOOD_MAINNET_ID)).toBe(true);
    expect(isPrimaryChain(ROBINHOOD_TESTNET_ID)).toBe(true);
    expect(isPrimaryChain(ETHEREUM_MAINNET_ID)).toBe(false);
    expect(toHexChainId(4663)).toBe("0x1237");
    expect(parseHexChainId("0x1237")).toBe(4663);
    expect(parseHexChainId("1237")).toBeNull();
    expect(addChainParams(ROBINHOOD_MAINNET_ID)).toMatchObject({ chainId: "0x1237", chainName: "Robinhood Chain", rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"] });
  });

  it("refuses an RPC that reports another chain id (spoofing guard)", async () => {
    const spoofed = createProxiedClient(ROBINHOOD_MAINNET_ID, async ({ method }) => (method === "eth_chainId" ? "0x1" : null));
    await expect(verifyChainId(spoofed, ROBINHOOD_MAINNET_ID)).rejects.toBeInstanceOf(ChainMismatchError);
    const silent = createProxiedClient(ROBINHOOD_MAINNET_ID, async () => {
      throw new Error("boom");
    });
    await expect(verifyChainId(silent, ROBINHOOD_MAINNET_ID)).rejects.toMatchObject({ actual: null });
    const honest = createProxiedClient(ROBINHOOD_MAINNET_ID, async ({ method }) => (method === "eth_chainId" ? "0x1237" : null));
    expect(await verifyChainId(honest, ROBINHOOD_MAINNET_ID)).toBe(4663);
  });
});
