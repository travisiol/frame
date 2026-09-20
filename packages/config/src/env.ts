import type { AppMode, NetworkMode } from "@frame/types";
import { ETHEREUM_MAINNET_ID, ROBINHOOD_MAINNET_ID, ROBINHOOD_TESTNET_ID } from "./chains";

export interface AppEnv {
  appMode: AppMode;
  /** Default network for LIVE builds. Testnet unless mainnet is deliberately configured. */
  networkMode: NetworkMode;
  /** Dedicated RPC providers keyed by chain id (empty → public fallbacks). */
  rpc: Partial<Record<number, string | undefined>>;
  lifiApiUrl: string | null;
  marketData: "live" | "demo";
  demoUrl: string;
}

type RawEnv = Record<string, string | boolean | undefined>;

/** Reads Vite's import.meta.env when available; safe under Node/tests where it is undefined. */
export function rawViteEnv(): RawEnv {
  try {
    const meta = import.meta as unknown as { env?: RawEnv };
    return meta.env ?? {};
  } catch {
    return {};
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

export function readEnv(raw: RawEnv = rawViteEnv()): AppEnv {
  const appMode: AppMode = str(raw.VITE_APP_MODE) === "live" ? "live" : "demo";
  const networkMode: NetworkMode = str(raw.VITE_NETWORK_MODE) === "mainnet" ? "mainnet" : "testnet";
  return {
    appMode,
    networkMode,
    rpc: {
      [ROBINHOOD_MAINNET_ID]: str(raw.VITE_RPC_ROBINHOOD_MAINNET),
      [ROBINHOOD_TESTNET_ID]: str(raw.VITE_RPC_ROBINHOOD_TESTNET),
      [ETHEREUM_MAINNET_ID]: str(raw.VITE_RPC_ETHEREUM),
    },
    lifiApiUrl: str(raw.VITE_LIFI_API_URL) ?? null,
    marketData: str(raw.VITE_MARKET_DATA) === "demo" ? "demo" : "live",
    demoUrl: str(raw.VITE_DEMO_URL) ?? "/demo/",
  };
}

/** Process-wide env snapshot (evaluated once per bundle). */
export const ENV: AppEnv = readEnv();
