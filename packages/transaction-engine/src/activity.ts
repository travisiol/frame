import type { IncomingFunds as IncomingFundsItem } from "@frame/types";
import { chainName as chainLabel } from "@frame/config";
import { formatTokenAmount as formatAmount } from "@frame/chain";
import { formatUnits, type Hex } from "viem";
import type { ActivityItem, ActivityKind, Address, AssetChange, TokenInfo, TxIntentKind } from "@frame/types";
import { explorerTxUrl } from "@frame/config";
import { formatTokenAmount, sameAddress, shortAddress } from "@frame/chain";

/** What the wallet remembers about a transaction it sent itself. Stored unencrypted — contains no secrets. */
export interface LocalTxRecord {
  hash: Hex;
  chainId: number;
  from: Address;
  to?: Address;
  intent: TxIntentKind;
  title: string;
  changes: AssetChange[];
  createdAt: number;
  status: ActivityItem["status"];
  demo?: boolean;
  origin?: string;
  counterparty?: Address;
  counterpartyLabel?: string;
  meta?: Record<string, string>;
}

const KIND_BY_INTENT: Record<TxIntentKind, ActivityKind> = {
  native_transfer: "send",
  erc20_transfer: "send",
  approve: "approve",
  swap: "swap",
  bridge: "bridge",
  contract_call: "contract",
  contract_deploy: "contract",
};

export function activityFromRecord(rec: LocalTxRecord): ActivityItem {
  const kind = rec.meta?.kind === "bridge" ? "bridge" : KIND_BY_INTENT[rec.intent];
  const subtitle = rec.origin
    ? `via ${rec.origin.replace(/^https?:\/\//, "")}`
    : kind === "send" && rec.counterparty
      ? `To ${rec.counterpartyLabel ?? shortAddress(rec.counterparty)}`
      : rec.meta?.label;
  return {
    id: `local:${rec.chainId}:${rec.hash}`,
    hash: rec.hash,
    kind,
    title: rec.title,
    subtitle,
    amounts: rec.changes.map((c) => ({ symbol: c.symbol, amount: c.amount, sign: c.direction === "in" ? "+" : "-", tokenAddress: c.tokenAddress })),
    counterparty: rec.counterparty,
    counterpartyLabel: rec.counterpartyLabel,
    timestamp: rec.createdAt,
    status: rec.status,
    chainId: rec.chainId,
    explorerUrl: rec.demo ? undefined : explorerTxUrl(rec.chainId, rec.hash),
    demo: rec.demo,
    tokenAddresses: rec.changes.map((c) => c.tokenAddress.toLowerCase()),
    source: rec.demo ? "demo" : "local",
  };
}

/** Minimal shape of a Blockscout v2 `/addresses/{a}/transactions` item (defensive: every field optional). */
export interface ExplorerTx {
  hash?: string;
  from?: { hash?: string } | string;
  to?: { hash?: string; name?: string; is_contract?: boolean } | string | null;
  value?: string;
  timestamp?: string;
  status?: string;
  method?: string | null;
  block?: number;
  fee?: { value?: string };
  token_transfers?: ExplorerTokenTransfer[] | null;
}

/** Minimal shape of a Blockscout v2 token transfer item. */
export interface ExplorerTokenTransfer {
  transaction_hash?: string;
  from?: { hash?: string } | string;
  to?: { hash?: string } | string;
  token?: { address?: string; address_hash?: string; symbol?: string; decimals?: string | number; name?: string };
  total?: { value?: string; decimals?: string | number };
  timestamp?: string;
  block_number?: number;
}

const addr = (v: { hash?: string } | string | null | undefined): Address | undefined => {
  if (!v) return undefined;
  const h = typeof v === "string" ? v : v.hash;
  return h ? (h.toLowerCase() as Address) : undefined;
};

export type TokenLookup = (chainId: number, address: Address | "native") => TokenInfo | undefined;

export function activityFromExplorerTx(tx: ExplorerTx, me: Address, chainId: number, lookup: TokenLookup): ActivityItem | null {
  if (!tx.hash) return null;
  const from = addr(tx.from);
  const to = addr(tx.to);
  const toName = typeof tx.to === "object" && tx.to ? tx.to.name : undefined;
  const value = BigInt(tx.value ?? "0");
  const ts = tx.timestamp ? Date.parse(tx.timestamp) : Date.now();
  const status: ActivityItem["status"] = tx.status === "ok" ? "confirmed" : tx.status === "error" ? "failed" : "pending";
  const outgoing = sameAddress(from, me);
  const amounts: ActivityItem["amounts"] = [];
  const tokens: string[] = [];

  for (const t of tx.token_transfers ?? []) {
    const tokenAddr = (t.token?.address ?? t.token?.address_hash)?.toLowerCase() as Address | undefined;
    if (!tokenAddr) continue;
    const known = lookup(chainId, tokenAddr);
    const decimals = Number(t.total?.decimals ?? t.token?.decimals ?? known?.decimals ?? 18);
    const raw = BigInt(t.total?.value ?? "0");
    const tFrom = addr(t.from);
    const tTo = addr(t.to);
    const sym = known?.symbol ?? t.token?.symbol ?? "?";
    tokens.push(tokenAddr);
    if (sameAddress(tFrom, me)) amounts.push({ symbol: sym, amount: formatTokenAmount(raw, decimals), sign: "-", tokenAddress: tokenAddr });
    if (sameAddress(tTo, me)) amounts.push({ symbol: sym, amount: formatTokenAmount(raw, decimals), sign: "+", tokenAddress: tokenAddr });
  }
  if (value > 0n) {
    amounts.push({ symbol: "ETH", amount: formatTokenAmount(value, 18), sign: outgoing ? "-" : "+", tokenAddress: "native" });
    tokens.push("native");
  }

  let kind: ActivityKind;
  let title: string;
  const method = (tx.method ?? "").toLowerCase();
  const hasIn = amounts.some((a) => a.sign === "+");
  const hasOut = amounts.some((a) => a.sign === "-");
  if (method.includes("approve")) {
    kind = "approve";
    title = "Token permission";
  } else if (hasIn && hasOut) {
    kind = "swap";
    const out = amounts.find((a) => a.sign === "-");
    const inn = amounts.find((a) => a.sign === "+");
    title = `Swapped ${out?.symbol ?? ""} for ${inn?.symbol ?? ""}`.trim();
  } else if (hasIn && !outgoing) {
    kind = "receive";
    title = `Received ${amounts[0]?.symbol ?? ""}`.trim();
  } else if (hasOut && (!tx.method || method === "transfer" || tx.method === null)) {
    kind = "send";
    title = `Sent ${amounts[0]?.symbol ?? ""}`.trim();
  } else if (outgoing) {
    kind = "contract";
    title = toName ? `Interacted with ${toName}` : tx.method ? `Called ${tx.method}` : "Contract interaction";
  } else {
    kind = "receive";
    title = "Received";
  }

  const counterparty = outgoing ? to : from;
  return {
    id: `explorer:${chainId}:${tx.hash}`,
    hash: tx.hash as Hex,
    kind,
    title,
    subtitle: counterparty ? `${outgoing ? "To" : "From"} ${toName && outgoing ? toName : shortAddress(counterparty)}` : undefined,
    amounts,
    counterparty,
    counterpartyLabel: outgoing ? toName : undefined,
    timestamp: ts,
    status,
    chainId,
    explorerUrl: explorerTxUrl(chainId, tx.hash),
    tokenAddresses: tokens,
    source: "explorer",
  };
}

/** Builds items from ERC-20 Transfer logs (fallback when no explorer API is reachable). */
export function activityFromTransferLog(
  log: { address: Address; from: Address; to: Address; value: bigint; transactionHash: Hex; timestamp: number },
  me: Address,
  chainId: number,
  lookup: TokenLookup,
): ActivityItem | null {
  const token = lookup(chainId, log.address);
  const outgoing = sameAddress(log.from, me);
  const incoming = sameAddress(log.to, me);
  if (!outgoing && !incoming) return null;
  const sym = token?.symbol ?? shortAddress(log.address);
  const amount = token ? formatTokenAmount(log.value, token.decimals) : formatUnits(log.value, 18);
  return {
    id: `logs:${chainId}:${log.transactionHash}:${log.address}`,
    hash: log.transactionHash,
    kind: outgoing ? "send" : "receive",
    title: outgoing ? `Sent ${sym}` : `Received ${sym}`,
    subtitle: outgoing ? `To ${shortAddress(log.to)}` : `From ${shortAddress(log.from)}`,
    amounts: [{ symbol: sym, amount, sign: outgoing ? "-" : "+", tokenAddress: log.address.toLowerCase() as Address }],
    counterparty: outgoing ? log.to : log.from,
    timestamp: log.timestamp,
    status: "confirmed",
    chainId,
    explorerUrl: explorerTxUrl(chainId, log.transactionHash),
    tokenAddresses: [log.address.toLowerCase()],
    source: "logs",
  };
}

/** Merges sources, de-duplicating by hash. Local records win (they carry intent + status), then explorer, then logs. */
export function mergeActivity(...lists: ActivityItem[][]): ActivityItem[] {
  const rank = { local: 0, demo: 0, watcher: 0, explorer: 1, logs: 2 } as const;
  const byHash = new Map<string, ActivityItem>();
  const noHash: ActivityItem[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (!item.hash) {
        noHash.push(item);
        continue;
      }
      const key = `${item.chainId}:${item.hash.toLowerCase()}`;
      const existing = byHash.get(key);
      if (!existing || rank[item.source] < rank[existing.source]) {
        byHash.set(key, existing ? { ...item, status: existing.source === "explorer" ? existing.status : item.status } : item);
      } else if (existing.source === "local" && item.source === "explorer" && existing.status === "pending") {
        byHash.set(key, { ...existing, status: item.status });
      }
    }
  }
  return [...byHash.values(), ...noHash].sort((a, b) => b.timestamp - a.timestamp);
}

export type ActivityFilter = "all" | "swaps" | "send" | "receive" | "bridge" | "approvals" | "stock-tokens";

export function filterActivity(items: ActivityItem[], filter: ActivityFilter, isStockToken: (address: string) => boolean): ActivityItem[] {
  switch (filter) {
    case "all":
      return items;
    case "swaps":
      return items.filter((i) => i.kind === "swap" || i.kind === "buy" || i.kind === "sell");
    case "send":
      return items.filter((i) => i.kind === "send");
    case "receive":
      return items.filter((i) => i.kind === "receive");
    case "bridge":
      return items.filter((i) => i.kind === "bridge");
    case "approvals":
      return items.filter((i) => i.kind === "approve");
    case "stock-tokens":
      return items.filter((i) => (i.tokenAddresses ?? []).some(isStockToken));
  }
}

/** Funds the watcher saw arriving. No hash (a native transfer leaves no log), so it never merges with explorer items. */
export function activityFromIncoming(item: IncomingFundsItem): ActivityItem {
  const amount = formatAmount(item.amountRaw, item.decimals);
  return {
    id: `in:${item.id}`,
    kind: "receive",
    title: `Received ${amount} ${item.symbol}`,
    subtitle: `on ${chainLabel(item.chainId)} · detected by the wallet`,
    amounts: [{ symbol: item.symbol, amount, sign: "+", tokenAddress: item.tokenAddress }],
    timestamp: item.detectedAt,
    status: "confirmed",
    chainId: item.chainId,
    tokenAddresses: item.tokenAddress === "native" ? [] : [item.tokenAddress.toLowerCase()],
    source: "watcher",
  };
}
