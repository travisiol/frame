import { defineChain, type Chain } from "viem";
import type { NetworkMode } from "@frame/types";

export const ROBINHOOD_MAINNET_ID = 4663;
export const ROBINHOOD_TESTNET_ID = 46630;
/** Ethereum mainnet is supported ONLY as a bridge source chain. */
export const ETHEREUM_MAINNET_ID = 1;

/** Canonical Multicall3 deployment — verified present on Robinhood Chain mainnet (3808 bytes of code). */
export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export const robinhoodChain: Chain = defineChain({
  id: ROBINHOOD_MAINNET_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://robinhoodchain.blockscout.com",
      apiUrl: "https://robinhoodchain.blockscout.com/api",
    },
  },
  contracts: {
    multicall3: { address: MULTICALL3_ADDRESS },
  },
  testnet: false,
});

export const robinhoodTestnet: Chain = defineChain({
  id: ROBINHOOD_TESTNET_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: {
      name: "Explorer",
      url: "https://explorer.testnet.chain.robinhood.com",
      apiUrl: "https://explorer.testnet.chain.robinhood.com/api",
    },
  },
  testnet: true,
});

export const ethereumMainnet: Chain = defineChain({
  id: ETHEREUM_MAINNET_ID,
  name: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://ethereum-rpc.publicnode.com"] },
  },
  blockExplorers: {
    default: { name: "Etherscan", url: "https://etherscan.io" },
  },
  contracts: {
    multicall3: { address: MULTICALL3_ADDRESS, blockCreated: 14353601 },
  },
});

export type ChainRole = "primary" | "bridge-source";

export interface ChainConfig {
  chain: Chain;
  chainId: number;
  role: ChainRole;
  /** Ordered RPC list: dedicated provider (env) → user custom RPC → public fallback. */
  rpcUrls: string[];
  explorerUrl: string;
  explorerApiUrl?: string;
  testnet: boolean;
}

export interface RpcOverrides {
  /** From environment (VITE_RPC_*). */
  env?: Partial<Record<number, string | undefined>>;
  /** From user settings (Advanced → Custom RPC). */
  custom?: Partial<Record<number, string | undefined>>;
}

const CHAINS: Record<number, { chain: Chain; role: ChainRole }> = {
  [ROBINHOOD_MAINNET_ID]: { chain: robinhoodChain, role: "primary" },
  [ROBINHOOD_TESTNET_ID]: { chain: robinhoodTestnet, role: "primary" },
  [ETHEREUM_MAINNET_ID]: { chain: ethereumMainnet, role: "bridge-source" },
};

export function isSupportedChain(chainId: number): boolean {
  return chainId in CHAINS;
}

/** Chains the wallet can be switched to (Robinhood Chain mainnet / testnet only). */
export function isPrimaryChain(chainId: number): boolean {
  return CHAINS[chainId]?.role === "primary";
}

export function chainIdForNetworkMode(mode: NetworkMode): number {
  return mode === "mainnet" ? ROBINHOOD_MAINNET_ID : ROBINHOOD_TESTNET_ID;
}

export function networkModeForChainId(chainId: number): NetworkMode {
  return chainId === ROBINHOOD_MAINNET_ID ? "mainnet" : "testnet";
}

export function getChainConfig(chainId: number, overrides: RpcOverrides = {}): ChainConfig {
  const entry = CHAINS[chainId];
  if (!entry) throw new Error(`Unsupported chain ${chainId}`);
  const { chain, role } = entry;
  const urls: string[] = [];
  const push = (u: string | undefined) => {
    if (u && /^https?:\/\//.test(u) && !urls.includes(u)) urls.push(u);
  };
  push(overrides.env?.[chainId]);
  push(overrides.custom?.[chainId]);
  for (const u of chain.rpcUrls.default.http) push(u);
  return {
    chain,
    chainId,
    role,
    rpcUrls: urls,
    explorerUrl: chain.blockExplorers?.default.url ?? "",
    explorerApiUrl: chain.blockExplorers?.default.apiUrl,
    testnet: chain.testnet === true,
  };
}

export function getChain(chainId: number): Chain {
  const entry = CHAINS[chainId];
  if (!entry) throw new Error(`Unsupported chain ${chainId}`);
  return entry.chain;
}

export function chainName(chainId: number): string {
  return CHAINS[chainId]?.chain.name ?? `Chain ${chainId}`;
}

export function explorerTxUrl(chainId: number, hash: string): string {
  const base = CHAINS[chainId]?.chain.blockExplorers?.default.url;
  return base ? `${base}/tx/${hash}` : "";
}

export function explorerAddressUrl(chainId: number, address: string): string {
  const base = CHAINS[chainId]?.chain.blockExplorers?.default.url;
  return base ? `${base}/address/${address}` : "";
}

export function explorerTokenUrl(chainId: number, address: string): string {
  const base = CHAINS[chainId]?.chain.blockExplorers?.default.url;
  return base ? `${base}/token/${address}` : "";
}

/** Hex chain id as used by EIP-1193 (`eth_chainId`, `wallet_switchEthereumChain`). */
export function toHexChainId(chainId: number): `0x${string}` {
  return `0x${chainId.toString(16)}`;
}

export function parseHexChainId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) return Number.parseInt(value, 16);
  return null;
}

/** Payload for `wallet_addEthereumChain`, so dApps can offer to add Robinhood Chain. */
export function addChainParams(chainId: number) {
  const cfg = getChainConfig(chainId);
  return {
    chainId: toHexChainId(chainId),
    chainName: cfg.chain.name,
    nativeCurrency: cfg.chain.nativeCurrency,
    rpcUrls: cfg.chain.rpcUrls.default.http,
    blockExplorerUrls: cfg.explorerUrl ? [cfg.explorerUrl] : [],
  };
}
