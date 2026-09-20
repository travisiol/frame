import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicClient } from "viem";
import type { Account, Address, PriceHistory, PriceQuote, PriceRange, TokenInfo } from "@frame/types";
import { ARBITRUM_ONE_ID, BASE_ID, ETHEREUM_MAINNET_ID } from "@frame/config";
import { createProxiedClient, readTokenBalances } from "@frame/chain";
import { getRegistry, isStockLike, looksLikeSpam, nativeToken, isImpersonatingSymbol } from "@frame/token-registry";
import { priceKey } from "@frame/markets";
import { useApp } from "../context";
import { useAppStore, useSnapshot } from "../state/store";
import { composePortfolio, type Portfolio } from "./portfolio";

export function useSelectedAccount(): Account | null {
  const snap = useSnapshot();
  if (!snap) return null;
  return snap.accounts.find((a) => a.id === snap.selectedAccountId) ?? snap.accounts[0] ?? null;
}

export function useChainId(): number {
  return useSnapshot()?.chainId ?? 4663;
}

const clientCache = new Map<string, PublicClient>();

/** viem client whose transport is the wallet backend's read-only RPC proxy. */
export function useChainClient(chainId?: number): PublicClient {
  const { backend } = useApp();
  const current = useChainId();
  const id = chainId ?? current;
  return useMemo(() => {
    const key = `${id}`;
    let c = clientCache.get(key);
    if (!c) {
      c = createProxiedClient(id, ({ method, params }) => backend.rpcRequest({ chainId: id, method, params: (params as unknown[]) ?? [] }));
      clientCache.set(key, c);
    }
    return c;
  }, [backend, id]);
}

export interface TokenSets {
  /** Registry + custom + detected, minus hidden. */
  visible: TokenInfo[];
  /** Hidden by the user or auto-hidden as suspicious. */
  hidden: TokenInfo[];
  /** Everything known (for lookups). */
  all: TokenInfo[];
  lookup: (address: Address | "native") => TokenInfo | undefined;
}

export function useTokens(): TokenSets {
  const snap = useSnapshot();
  const chainId = useChainId();
  const account = useSelectedAccount();
  const { backend } = useApp();
  const detected = useQuery({
    queryKey: ["detected", chainId, account?.address],
    queryFn: () => (account ? backend.getDetectedTokens({ address: account.address, chainId }) : Promise.resolve([])),
    enabled: !!account,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  return useMemo(() => {
    const registry = getRegistry(chainId);
    const custom = (snap?.customTokens ?? []).filter((t) => t.chainId === chainId);
    const found = (detected.data ?? []).filter((t) => !registry.some((r) => r.address === t.address) && !custom.some((c) => c.address === t.address));
    const all = [...registry, ...custom, ...found];
    const hiddenSet = new Set(snap?.hiddenTokens ?? []);
    const visible: TokenInfo[] = [];
    const hidden: TokenInfo[] = [];
    for (const t of all) {
      const key = t.address === "native" ? "native" : t.address.toLowerCase();
      const userHidden = hiddenSet.has(key);
      const autoHidden = !t.custom && !t.verified && (looksLikeSpam(t) || isImpersonatingSymbol(chainId, t));
      if (userHidden || autoHidden) hidden.push(t);
      else visible.push(t);
    }
    const lookup = (address: Address | "native") => {
      if (address === "native") return nativeToken(chainId);
      const a = address.toLowerCase();
      return all.find((t) => t.address === a);
    };
    return { visible, hidden, all, lookup };
  }, [snap?.customTokens, snap?.hiddenTokens, chainId, detected.data]);
}

export function useBalances(tokens: TokenInfo[], address?: Address, chainId?: number) {
  const client = useChainClient(chainId);
  const current = useChainId();
  const id = chainId ?? current;
  const revealing = useAppStore((s) => s.revealingSecret);
  const keys = tokens.map((t) => t.address).join(",");
  return useQuery({
    queryKey: ["balances", id, address, keys],
    queryFn: async () => {
      const map = await readTokenBalances(client, address!, tokens);
      return Object.fromEntries([...map.entries()].map(([k, v]) => [k, v.toString()])) as Record<string, string>;
    },
    enabled: !!address && tokens.length > 0 && !revealing,
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  });
}

export function usePrices(tokens: TokenInfo[]) {
  const { market } = useApp();
  const keys = tokens.map(priceKey).join(",");
  return useQuery({
    queryKey: ["prices", market.id, keys],
    queryFn: async () => {
      const map = await market.getPrices(tokens);
      return Object.fromEntries(map.entries()) as Record<string, PriceQuote>;
    },
    enabled: tokens.length > 0,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}

export interface PortfolioState {
  portfolio: Portfolio | null;
  loading: boolean;
  /** Balances are known but prices are still being fetched — show "loading", never "unavailable". */
  pricesPending: boolean;
  balancesError: boolean;
  pricesError: boolean;
  refresh: () => void;
}

export function usePortfolio(address?: Address): PortfolioState {
  const account = useSelectedAccount();
  const owner = address ?? account?.address;
  const { visible } = useTokens();
  const balances = useBalances(visible, owner);
  const held = useMemo(() => {
    if (!balances.data) return [];
    return visible.filter((t) => {
      const raw = balances.data[t.address === "native" ? "native" : t.address];
      return raw !== undefined && raw !== "0";
    });
  }, [balances.data, visible]);
  const prices = usePrices(held);
  const qc = useQueryClient();
  const portfolio = useMemo(() => {
    if (!balances.data) return null;
    const bal = new Map<string, bigint>();
    for (const [k, v] of Object.entries(balances.data)) bal.set(k, BigInt(v));
    const px = new Map<string, PriceQuote>(Object.entries(prices.data ?? {}));
    return composePortfolio(visible, bal, px);
  }, [balances.data, prices.data, visible]);
  return {
    portfolio,
    loading: balances.isPending || (held.length > 0 && prices.isPending),
    pricesPending: held.length > 0 && prices.isPending,
    balancesError: balances.isError,
    pricesError: prices.isError,
    refresh: () => {
      void qc.invalidateQueries({ queryKey: ["balances"] });
      void qc.invalidateQueries({ queryKey: ["prices"] });
    },
  };
}

export function useTokenPrice(token: TokenInfo | undefined) {
  const { market } = useApp();
  return useQuery({
    queryKey: ["price", market.id, token ? priceKey(token) : "none"],
    queryFn: () => market.getTokenPrice(token!),
    enabled: !!token,
    refetchInterval: 60_000,
  });
}

export function usePriceHistory(token: TokenInfo | undefined, range: PriceRange) {
  const { market } = useApp();
  return useQuery<PriceHistory | null>({
    queryKey: ["history", market.id, token ? priceKey(token) : "none", range],
    queryFn: () => market.getPriceHistory(token!, range),
    enabled: !!token,
    staleTime: 5 * 60_000,
  });
}

export function useMarketStatus(token: TokenInfo | undefined) {
  const { market } = useApp();
  return useQuery({
    queryKey: ["market-status", token ? priceKey(token) : "none"],
    queryFn: () => market.getMarketStatus(token!),
    enabled: !!token,
    refetchInterval: 60_000,
  });
}

export function useMarketMetadata(token: TokenInfo | undefined) {
  const { market } = useApp();
  return useQuery({
    queryKey: ["market-meta", market.id, token ? priceKey(token) : "none"],
    queryFn: () => market.getMarketMetadata(token!),
    enabled: !!token,
    staleTime: 10 * 60_000,
  });
}

export function useActivity(address?: Address) {
  const { backend } = useApp();
  const account = useSelectedAccount();
  const owner = address ?? account?.address;
  const chainId = useChainId();
  return useQuery({
    queryKey: ["activity", chainId, owner],
    queryFn: () => backend.getActivity({ address: owner!, chainId }),
    enabled: !!owner,
    refetchInterval: 20_000,
    placeholderData: (prev) => prev,
  });
}

export function useAllowances(address?: Address) {
  const { backend } = useApp();
  const account = useSelectedAccount();
  const owner = address ?? account?.address;
  const chainId = useChainId();
  return useQuery({
    queryKey: ["allowances", chainId, owner],
    queryFn: () => backend.getAllowances({ address: owner!, chainId }),
    enabled: !!owner,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}

/** ETH balance on Ethereum mainnet (bridge source). */
export function useSourceChainBalance(address?: Address, chainId: number = ETHEREUM_MAINNET_ID) {
  const client = useChainClient(chainId);
  return useQuery({
    queryKey: ["balances", chainId, address, "native"],
    queryFn: async () => (await client.getBalance({ address: address! })).toString(),
    enabled: !!address,
    refetchInterval: 20_000,
  });
}

export function isStockToken(token: TokenInfo | undefined): boolean {
  return !!token && isStockLike(token);
}

// ---------------------------------------------------------------------------
// Funds on other networks (bridge sources) — same address, different chain.
// ---------------------------------------------------------------------------

export interface OtherChainFunds {
  chainId: number;
  wei: bigint;
  usd: number | null;
}

/** ETH held by the address on Ethereum, Arbitrum One and Base — what can be moved to Robinhood Chain. */
export function useOtherChainFunds(address?: Address): { funds: OtherChainFunds[]; totalUsd: number | null; loading: boolean } {
  const eth = useMemo(() => nativeToken(ETHEREUM_MAINNET_ID), []);
  const price = useTokenPrice(eth);
  const a = useSourceChainBalance(address, ETHEREUM_MAINNET_ID);
  const b = useSourceChainBalance(address, ARBITRUM_ONE_ID);
  const c = useSourceChainBalance(address, BASE_ID);
  const p = price.data?.priceUsd ?? null;
  return useMemo(() => {
    const funds: OtherChainFunds[] = [];
    const rows: [number, string | undefined][] = [
      [ETHEREUM_MAINNET_ID, a.data],
      [ARBITRUM_ONE_ID, b.data],
      [BASE_ID, c.data],
    ];
    for (const [chainId, raw] of rows) {
      const wei = raw ? BigInt(raw) : 0n;
      if (wei > 0n) funds.push({ chainId, wei, usd: p === null ? null : (Number(wei) / 1e18) * p });
    }
    const totalUsd = p === null ? null : funds.reduce((s, f) => s + (f.usd ?? 0), 0);
    return { funds, totalUsd, loading: a.isPending || b.isPending || c.isPending };
  }, [a.data, b.data, c.data, a.isPending, b.isPending, c.isPending, p]);
}

/** Gas to keep aside on a source chain before bridging a whole balance (≈ one bridge deposit, with margin). */
export function useGasReserve(chainId: number) {
  const client = useChainClient(chainId);
  return useQuery({
    queryKey: ["gas-reserve", chainId],
    queryFn: async () => {
      const fees = await client.estimateFeesPerGas().catch(() => null);
      const perGas = fees?.maxFeePerGas ?? fees?.gasPrice ?? 0n;
      return ((perGas * 120_000n * 125n) / 100n).toString();
    },
    staleTime: 30_000,
  });
}
