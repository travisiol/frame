import type { Address, TokenCategory, TokenInfo } from "@frame/types";
import { ROBINHOOD_MAINNET_ID, ROBINHOOD_TESTNET_ID } from "@frame/config";
import mainnet from "./data/robinhood-mainnet.json";
import testnet from "./data/robinhood-testnet.json";

interface RegistryEntry {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  category: string;
  underlying?: TokenInfo["underlying"];
  priceFeed?: TokenInfo["priceFeed"];
  verified: boolean;
  addedAt?: string;
  tags?: string[];
}

interface RegistryFile {
  chainId: number;
  updatedAt: string;
  method: string;
  tokens: RegistryEntry[];
  knownSpenders: { address: string; label: string }[];
}

const FILES: Record<number, RegistryFile> = {
  [ROBINHOOD_MAINNET_ID]: mainnet as RegistryFile,
  [ROBINHOOD_TESTNET_ID]: testnet as RegistryFile,
};

export const STOCK_LIKE_CATEGORIES: ReadonlySet<TokenCategory> = new Set<TokenCategory>(["stock-token", "etf", "rwa"]);

export function nativeToken(chainId: number): TokenInfo {
  return {
    chainId,
    address: "native",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    category: "native",
    verified: true,
    priceFeed: { provider: "coingecko", id: "ethereum" },
  };
}

const cache = new Map<number, TokenInfo[]>();

/** Verified tokens for a chain (native ETH first), addresses lowercased. */
export function getRegistry(chainId: number): TokenInfo[] {
  const hit = cache.get(chainId);
  if (hit) return hit;
  const file = FILES[chainId];
  const list: TokenInfo[] = [nativeToken(chainId)];
  if (file) {
    for (const t of file.tokens) {
      list.push({
        chainId,
        address: t.address.toLowerCase() as Address,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        category: t.category as TokenCategory,
        verified: t.verified === true,
        underlying: t.underlying,
        priceFeed: t.priceFeed,
        addedAt: t.addedAt,
        tags: t.tags,
      });
    }
  }
  cache.set(chainId, list);
  return list;
}

export function registryUpdatedAt(chainId: number): string | undefined {
  return FILES[chainId]?.updatedAt;
}

export function findToken(chainId: number, address: string): TokenInfo | undefined {
  if (address === "native") return nativeToken(chainId);
  const a = address.toLowerCase();
  return getRegistry(chainId).find((t) => t.address === a);
}

/** Symbol lookups can return several tokens — never treat a symbol match as verification. */
export function findBySymbol(chainId: number, symbol: string): TokenInfo[] {
  const s = symbol.trim().toUpperCase();
  return getRegistry(chainId).filter((t) => t.symbol.toUpperCase() === s);
}

/** True only when this exact contract address is in the verified registry. */
export function isVerified(chainId: number, address: string): boolean {
  const t = findToken(chainId, address);
  return t?.verified === true;
}

export function isAddressLike(query: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(query.trim());
}

export function searchRegistry(chainId: number, query: string, limit = 20): TokenInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  if (isAddressLike(q)) {
    const t = findToken(chainId, q);
    return t ? [t] : [];
  }
  const scored = getRegistry(chainId)
    .map((t) => {
      const sym = t.symbol.toLowerCase();
      const name = t.name.toLowerCase();
      const under = t.underlying?.ticker.toLowerCase() ?? "";
      const uname = t.underlying?.name.toLowerCase() ?? "";
      let score = 0;
      if (sym === q || under === q) score = 100;
      else if (sym.startsWith(q) || under.startsWith(q)) score = 80;
      else if (name.startsWith(q) || uname.startsWith(q)) score = 60;
      else if (name.includes(q) || uname.includes(q) || sym.includes(q)) score = 30;
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.t.symbol.localeCompare(b.t.symbol));
  return scored.slice(0, limit).map((x) => x.t);
}

/** Consumer-facing name. Stock Tokens are always described as tokenized exposure, never as the equity itself. */
export function displayName(token: TokenInfo): string {
  if (token.category === "native") return "Ether";
  if (STOCK_LIKE_CATEGORIES.has(token.category)) return `${token.symbol} Stock Token`;
  return token.name;
}

/** Secondary description, e.g. "Tokenized NVDA exposure". */
export function exposureLabel(token: TokenInfo): string {
  if (STOCK_LIKE_CATEGORIES.has(token.category) && token.underlying) {
    return `Tokenized ${token.underlying.ticker} exposure`;
  }
  if (token.category === "stable") return "Stablecoin";
  if (token.category === "native") return "Network gas token";
  if (token.category === "crypto") return "Crypto";
  if (token.category === "ecosystem") return "Ecosystem token";
  return "Unknown token";
}

export function categoryLabel(category: TokenCategory): string {
  switch (category) {
    case "stock-token":
      return "Stock Token";
    case "etf":
      return "ETF Token";
    case "rwa":
      return "RWA";
    case "stable":
      return "Stablecoin";
    case "native":
    case "crypto":
      return "Crypto";
    case "ecosystem":
      return "Ecosystem";
    default:
      return "Unknown";
  }
}

export type AllocationBucket = "stocks" | "crypto" | "stables";

export function allocationBucket(category: TokenCategory): AllocationBucket {
  if (STOCK_LIKE_CATEGORIES.has(category)) return "stocks";
  if (category === "stable") return "stables";
  return "crypto";
}

export function isStockLike(token: TokenInfo): boolean {
  return STOCK_LIKE_CATEGORIES.has(token.category);
}

/** Contracts deployed at the same address on every supported chain. A label, never a safety promise. */
export const GLOBAL_KNOWN_CONTRACTS: Record<string, string> = {
  "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": "LI.FI Diamond (swap & bridge router)",
};

export function knownSpenderLabel(chainId: number, address: string): string | undefined {
  const a = address.toLowerCase();
  return FILES[chainId]?.knownSpenders.find((s) => s.address === a)?.label ?? GLOBAL_KNOWN_CONTRACTS[a];
}

/**
 * Builds a TokenInfo for a contract that is NOT in the registry. It is
 * always unverified and "unknown" — even if its on-chain name mimics a
 * Robinhood Token — because a ticker or name proves nothing.
 */
export function makeUnknownToken(
  chainId: number,
  address: Address,
  meta: { symbol?: string; name?: string; decimals?: number },
  options: { custom?: boolean; category?: TokenCategory } = {},
): TokenInfo {
  return {
    chainId,
    address: address.toLowerCase() as Address,
    symbol: meta.symbol?.slice(0, 16) || "UNKNOWN",
    name: meta.name?.slice(0, 64) || "Unknown token",
    decimals: typeof meta.decimals === "number" ? meta.decimals : 18,
    category: options.category ?? "unknown",
    verified: false,
    custom: options.custom,
  };
}

/** Heuristic spam detection for unsolicited airdrops — used only to hide, never to interact. */
export function looksLikeSpam(token: TokenInfo): boolean {
  if (token.verified) return false;
  const text = `${token.name} ${token.symbol}`.toLowerCase();
  return /https?:\/\/|www\.|\.(com|io|xyz|net|org|app|finance)\b|claim|airdrop|reward|visit|bonus|free|voucher|redeem|\$\d/.test(
    text,
  );
}

/** A symbol that collides with a verified registry symbol but is a different contract. */
export function isImpersonatingSymbol(chainId: number, token: TokenInfo): boolean {
  if (token.verified) return false;
  return findBySymbol(chainId, token.symbol).some((t) => t.address !== token.address);
}
