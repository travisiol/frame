import type { AppMode, NetworkMode } from "@frame/types";
import { ARBITRUM_ONE_ID, BASE_ID, ETHEREUM_MAINNET_ID, ROBINHOOD_MAINNET_ID, ROBINHOOD_TESTNET_ID } from "./chains";

/** Public LI.FI API — the default route provider for swaps and bridges (no key required). */
export const DEFAULT_LIFI_API_URL = "https://li.quest/v1";

export interface AppEnv {
  /** "live" unless a developer explicitly builds the simulator (`VITE_APP_MODE=demo`, used by the test-suite). */
  appMode: AppMode;
  /** Default network for LIVE builds: Robinhood Chain mainnet unless `VITE_NETWORK_MODE=testnet`. */
  networkMode: NetworkMode;
  /** Dedicated RPC providers keyed by chain id (empty → public fallbacks). */
  rpc: Partial<Record<number, string | undefined>>;
  /** Route provider endpoint; null disables swaps/bridges entirely (`VITE_LIFI_API_URL=off`). */
  lifiApiUrl: string | null;
  marketData: "live" | "demo";
  /** Same-origin JSON-RPC relay for the web app (e.g. "/api/rpc"); "off" disables it. */
  rpcRelay: string | null | "off";
  /** Same-origin market-data relay for the web app (e.g. "/api/market"); "off" disables it. */
  marketRelay: string | null | "off";
  /** Where the website links to the web app. */
  appUrl: string;
  /** Where the website links to the download page. */
  downloadUrl: string;
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
const isOff = (v: string | undefined) => v !== undefined && /^(off|none|false|0)$/i.test(v);

function relaySetting(v: string | undefined): string | null | "off" {
  if (v === undefined) return null;
  return isOff(v) ? "off" : v;
}

export function readEnv(raw: RawEnv = rawViteEnv()): AppEnv {
  const appMode: AppMode = str(raw.VITE_APP_MODE) === "demo" ? "demo" : "live";
  const networkMode: NetworkMode = str(raw.VITE_NETWORK_MODE) === "testnet" ? "testnet" : "mainnet";
  const lifi = str(raw.VITE_LIFI_API_URL);
  return {
    appMode,
    networkMode,
    rpc: {
      [ROBINHOOD_MAINNET_ID]: str(raw.VITE_RPC_ROBINHOOD_MAINNET),
      [ROBINHOOD_TESTNET_ID]: str(raw.VITE_RPC_ROBINHOOD_TESTNET),
      [ETHEREUM_MAINNET_ID]: str(raw.VITE_RPC_ETHEREUM),
      [ARBITRUM_ONE_ID]: str(raw.VITE_RPC_ARBITRUM),
      [BASE_ID]: str(raw.VITE_RPC_BASE),
    },
    lifiApiUrl: lifi === undefined ? DEFAULT_LIFI_API_URL : isOff(lifi) ? null : lifi,
    marketData: str(raw.VITE_MARKET_DATA) === "demo" ? "demo" : "live",
    rpcRelay: relaySetting(str(raw.VITE_RPC_RELAY)),
    marketRelay: relaySetting(str(raw.VITE_MARKET_RELAY)),
    appUrl: str(raw.VITE_APP_URL) ?? "/app/",
    downloadUrl: str(raw.VITE_DOWNLOAD_URL) ?? "/download",
  };
}

/** Process-wide env snapshot (evaluated once per bundle). */
export const ENV: AppEnv = readEnv();
