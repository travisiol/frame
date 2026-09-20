import { describe, expect, it } from "vitest";
import { ARBITRUM_ONE_ID, BASE_ID, BRIDGE_SOURCE_CHAIN_IDS, DEFAULT_LIFI_API_URL, ETHEREUM_MAINNET_ID, ROBINHOOD_MAINNET_ID, ROBINHOOD_TESTNET_ID, getChainConfig, isBridgeSourceChain, isPrimaryChain, readEnv, relayRpcOverrides } from "../src";

describe("environment defaults — the shipped product is live, on mainnet, with real routes", () => {
  it("defaults to LIVE mode on Robinhood Chain mainnet with LI.FI enabled", () => {
    const env = readEnv({});
    expect(env.appMode).toBe("live");
    expect(env.networkMode).toBe("mainnet");
    expect(env.lifiApiUrl).toBe(DEFAULT_LIFI_API_URL);
    expect(env.marketData).toBe("live");
    expect(env.rpcRelay).toBeNull();
    expect(env.appUrl).toBe("/app/");
    expect(env.downloadUrl).toBe("/download");
  });

  it("only opts into the simulator, the testnet or no routes when explicitly asked", () => {
    const env = readEnv({ VITE_APP_MODE: "demo", VITE_NETWORK_MODE: "testnet", VITE_LIFI_API_URL: "off", VITE_RPC_RELAY: "off", VITE_MARKET_RELAY: "/api/market" });
    expect(env.appMode).toBe("demo");
    expect(env.networkMode).toBe("testnet");
    expect(env.lifiApiUrl).toBeNull();
    expect(env.rpcRelay).toBe("off");
    expect(env.marketRelay).toBe("/api/market");
  });

  it("ignores junk values", () => {
    const env = readEnv({ VITE_APP_MODE: "banana", VITE_NETWORK_MODE: "", VITE_LIFI_API_URL: "  " });
    expect(env.appMode).toBe("live");
    expect(env.networkMode).toBe("mainnet");
    expect(env.lifiApiUrl).toBe(DEFAULT_LIFI_API_URL);
  });

  it("reads dedicated RPC providers for every chain", () => {
    const env = readEnv({ VITE_RPC_ARBITRUM: "https://arb.example", VITE_RPC_BASE: "https://base.example" });
    expect(env.rpc[ARBITRUM_ONE_ID]).toBe("https://arb.example");
    expect(env.rpc[BASE_ID]).toBe("https://base.example");
    expect(env.rpc[ROBINHOOD_MAINNET_ID]).toBeUndefined();
  });
});

describe("chains", () => {
  it("bridge sources are Ethereum, Arbitrum One and Base — never switchable primaries", () => {
    expect([...BRIDGE_SOURCE_CHAIN_IDS]).toEqual([ETHEREUM_MAINNET_ID, ARBITRUM_ONE_ID, BASE_ID]);
    for (const id of BRIDGE_SOURCE_CHAIN_IDS) {
      expect(isBridgeSourceChain(id)).toBe(true);
      expect(isPrimaryChain(id)).toBe(false);
      expect(getChainConfig(id).rpcUrls.length).toBeGreaterThan(0);
    }
    expect(isPrimaryChain(ROBINHOOD_MAINNET_ID)).toBe(true);
    expect(isPrimaryChain(ROBINHOOD_TESTNET_ID)).toBe(true);
  });

  it("orders RPCs: dedicated → custom → relay → public", () => {
    const cfg = getChainConfig(ROBINHOOD_MAINNET_ID, {
      env: { [ROBINHOOD_MAINNET_ID]: "https://dedicated.example" },
      custom: { [ROBINHOOD_MAINNET_ID]: "https://custom.example" },
      relay: { [ROBINHOOD_MAINNET_ID]: "https://frame.example/api/rpc?chain=4663" },
    });
    expect(cfg.rpcUrls).toEqual(["https://dedicated.example", "https://custom.example", "https://frame.example/api/rpc?chain=4663", "https://rpc.mainnet.chain.robinhood.com"]);
  });

  it("builds a relay override for every supported chain from a relative path", () => {
    const relay = relayRpcOverrides("/api/rpc", "https://frame.example");
    expect(relay[ROBINHOOD_MAINNET_ID]).toBe("https://frame.example/api/rpc?chain=4663");
    expect(relay[BASE_ID]).toBe("https://frame.example/api/rpc?chain=8453");
    expect(getChainConfig(ETHEREUM_MAINNET_ID, { relay }).rpcUrls[0]).toBe("https://frame.example/api/rpc?chain=1");
  });
});
