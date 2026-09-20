import type { PriceQuote, TokenInfo } from "@frame/types";
import { formatTokenAmount } from "@frame/chain";
import { allocationBucket, type AllocationBucket } from "@frame/token-registry";
import { priceKey } from "@frame/markets";

export interface Holding {
  token: TokenInfo;
  raw: bigint;
  formatted: string;
  units: number;
  priceUsd: number | null;
  change24hPct: number | null;
  valueUsd: number | null;
  /** USD change over 24h attributable to this holding (null when price or change unknown). */
  change24hUsd: number | null;
  bucket: AllocationBucket;
  demoPrice: boolean;
}

export interface Portfolio {
  holdings: Holding[];
  /** Sum of holdings that have a price. */
  totalUsd: number;
  change24hUsd: number | null;
  change24hPct: number | null;
  allocation: Record<AllocationBucket, number>;
  /** Some held tokens have no price → the total is a lower bound. */
  partial: boolean;
  /** No token has a price at all. */
  pricesUnavailable: boolean;
  gasBalanceWei: bigint;
}

export function composePortfolio(tokens: TokenInfo[], balances: Map<string, bigint>, prices: Map<string, PriceQuote>): Portfolio {
  const holdings: Holding[] = [];
  let total = 0;
  let change = 0;
  let changeKnown = false;
  let partial = false;
  let anyPrice = false;
  const allocation: Record<AllocationBucket, number> = { stocks: 0, crypto: 0, stables: 0 };
  let gas = 0n;

  for (const token of tokens) {
    const key = token.address === "native" ? "native" : token.address.toLowerCase();
    const raw = balances.get(key);
    if (token.address === "native") gas = raw ?? 0n;
    if (raw === undefined || raw === 0n) continue;
    const units = Number(raw) / 10 ** token.decimals;
    const quote = prices.get(priceKey(token));
    const priceUsd = quote?.priceUsd ?? null;
    const valueUsd = priceUsd !== null ? units * priceUsd : null;
    const change24hPct = quote?.change24hPct ?? null;
    let change24hUsd: number | null = null;
    if (valueUsd !== null) {
      anyPrice = true;
      total += valueUsd;
      allocation[allocationBucket(token.category)] += valueUsd;
      if (change24hPct !== null) {
        // value now = value_yesterday × (1 + pct) → change = value − value/(1+pct)
        change24hUsd = valueUsd - valueUsd / (1 + change24hPct / 100);
        change += change24hUsd;
        changeKnown = true;
      }
    } else partial = true;
    holdings.push({
      token,
      raw,
      formatted: formatTokenAmount(raw, token.decimals),
      units,
      priceUsd,
      change24hPct,
      valueUsd,
      change24hUsd,
      bucket: allocationBucket(token.category),
      demoPrice: quote?.demo === true,
    });
  }

  holdings.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1) || b.units - a.units);
  const previous = total - change;
  return {
    holdings,
    totalUsd: total,
    change24hUsd: changeKnown ? change : null,
    change24hPct: changeKnown && previous > 0 ? (change / previous) * 100 : null,
    allocation,
    partial,
    pricesUnavailable: holdings.length > 0 && !anyPrice,
    gasBalanceWei: gas,
  };
}
