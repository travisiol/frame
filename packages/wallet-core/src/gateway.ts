import { parseAbiItem, type PublicClient } from "viem";
import type { ActivityItem, Address, Allowance, TokenInfo } from "@frame/types";
import { getChainConfig, type RpcOverrides } from "@frame/config";
import { createChainClient, formatTokenAmount, isUnlimitedAllowance, readAllowance, sameAddress } from "@frame/chain";
import { findToken, isVerified, knownSpenderLabel, makeUnknownToken } from "@frame/token-registry";
import { activityFromExplorerTx, activityFromTransferLog, type ExplorerTx, type TokenLookup } from "@frame/transaction-engine";
import type { ChainGateway } from "./demo-chain";

/** JSON-RPC methods dApps and the UI may proxy through the wallet. Signing methods never reach here. */
export const READ_ONLY_METHODS: ReadonlySet<string> = new Set([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionCount",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
  "eth_getTransactionByBlockNumberAndIndex",
  "eth_getBlockTransactionCountByNumber",
  "web3_clientVersion",
]);

/** Real RPC access with per-chain clients, ordered fallback and a method allowlist. */
export class LiveChainGateway implements ChainGateway {
  private readonly clients = new Map<number, PublicClient>();

  constructor(private readonly overrides: () => RpcOverrides) {}

  client(chainId: number): PublicClient {
    let c = this.clients.get(chainId);
    if (!c) {
      c = createChainClient(chainId, { overrides: this.overrides() });
      this.clients.set(chainId, c);
    }
    return c;
  }

  /** Drops cached clients so new RPC settings take effect. */
  invalidate(): void {
    this.clients.clear();
  }

  async request(chainId: number, method: string, params: unknown[] = []): Promise<unknown> {
    if (!READ_ONLY_METHODS.has(method) && method !== "eth_sendRawTransaction") {
      throw new Error(`Method ${method} is not proxied by the wallet.`);
    }
    return this.client(chainId).request({ method, params } as never);
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const explorerApi = (chainId: number) => {
  const cfg = getChainConfig(chainId);
  return cfg.explorerUrl ? `${cfg.explorerUrl}/api/v2` : null;
};

/** Blockscout v2 transactions for an address. Returns null when the API is unreachable (e.g. behind a challenge). */
export async function fetchExplorerActivity(
  chainId: number,
  address: Address,
  lookup: TokenLookup,
  fetchImpl: FetchLike = (i, init) => fetch(i, init),
): Promise<ActivityItem[] | null> {
  const base = explorerApi(chainId);
  if (!base) return null;
  try {
    const res = await fetchImpl(`${base}/addresses/${address}/transactions`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: ExplorerTx[] };
    return (data.items ?? []).map((tx) => activityFromExplorerTx(tx, address, chainId, lookup)).filter((x): x is ActivityItem => !!x);
  } catch {
    return null;
  }
}

/** Blockscout v2 token balances → tokens the address holds that are NOT in the registry (always unverified). */
export async function fetchExplorerTokenBalances(
  chainId: number,
  address: Address,
  fetchImpl: FetchLike = (i, init) => fetch(i, init),
): Promise<TokenInfo[] | null> {
  const base = explorerApi(chainId);
  if (!base) return null;
  try {
    const res = await fetchImpl(`${base}/addresses/${address}/token-balances`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: { address?: string; address_hash?: string; symbol?: string; name?: string; decimals?: string; type?: string } }[];
    const out: TokenInfo[] = [];
    for (const row of Array.isArray(data) ? data : []) {
      const t = row.token;
      const addr = (t?.address ?? t?.address_hash)?.toLowerCase() as Address | undefined;
      if (!addr || (t?.type && t.type !== "ERC-20")) continue;
      if (isVerified(chainId, addr)) continue;
      out.push(makeUnknownToken(chainId, addr, { symbol: t?.symbol, name: t?.name, decimals: t?.decimals ? Number(t.decimals) : 18 }));
    }
    return out;
  } catch {
    return null;
  }
}

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const APPROVAL_EVENT = parseAbiItem("event Approval(address indexed owner, address indexed spender, uint256 value)");

/** Fallback activity source: ERC-20 Transfer logs to/from the address over the last `span` blocks, in chunks. */
export async function scanTransferLogs(
  client: PublicClient,
  chainId: number,
  address: Address,
  lookup: TokenLookup,
  options: { span?: number; chunk?: number; maxBlocksForTimestamps?: number } = {},
): Promise<ActivityItem[]> {
  const span = options.span ?? 400_000;
  const chunk = options.chunk ?? 100_000;
  const latest = Number(await client.getBlockNumber());
  const items: ActivityItem[] = [];
  const blockTs = new Map<bigint, number>();
  for (let end = latest; end > latest - span; end -= chunk) {
    const from = Math.max(end - chunk + 1, latest - span + 1);
    const [incoming, outgoing] = await Promise.all([
      client.getLogs({ event: TRANSFER_EVENT, args: { to: address }, fromBlock: BigInt(from), toBlock: BigInt(end) }).catch(() => []),
      client.getLogs({ event: TRANSFER_EVENT, args: { from: address }, fromBlock: BigInt(from), toBlock: BigInt(end) }).catch(() => []),
    ]);
    for (const log of [...incoming, ...outgoing]) {
      if (!log.args.from || !log.args.to || log.args.value === undefined || !log.transactionHash) continue;
      let ts = blockTs.get(log.blockNumber);
      if (ts === undefined) {
        if (blockTs.size < (options.maxBlocksForTimestamps ?? 40)) {
          const b = await client.getBlock({ blockNumber: log.blockNumber }).catch(() => undefined);
          ts = b ? Number(b.timestamp) * 1000 : Date.now();
          blockTs.set(log.blockNumber, ts);
        } else ts = Date.now();
      }
      const item = activityFromTransferLog(
        { address: log.address, from: log.args.from, to: log.args.to, value: log.args.value, transactionHash: log.transactionHash, timestamp: ts },
        address,
        chainId,
        lookup,
      );
      if (item) items.push(item);
    }
  }
  return items;
}

/** Existing ERC-20 allowances: Approval logs by owner → current allowance per (token, spender). */
export async function scanApprovals(
  client: PublicClient,
  chainId: number,
  owner: Address,
  customTokens: TokenInfo[],
  options: { span?: number; chunk?: number } = {},
): Promise<Allowance[]> {
  const span = options.span ?? 400_000;
  const chunk = options.chunk ?? 100_000;
  const latest = Number(await client.getBlockNumber());
  const pairs = new Map<string, { token: Address; spender: Address }>();
  for (let end = latest; end > latest - span; end -= chunk) {
    const from = Math.max(end - chunk + 1, latest - span + 1);
    const logs = await client.getLogs({ event: APPROVAL_EVENT, args: { owner }, fromBlock: BigInt(from), toBlock: BigInt(end) }).catch(() => []);
    for (const log of logs) {
      if (!log.args.spender) continue;
      pairs.set(`${log.address.toLowerCase()}:${log.args.spender.toLowerCase()}`, { token: log.address, spender: log.args.spender });
    }
  }
  const out: Allowance[] = [];
  await Promise.all(
    [...pairs.values()].map(async ({ token, spender }) => {
      const current = await readAllowance(client, token, owner, spender).catch(() => 0n);
      if (current === 0n) return;
      const info =
        findToken(chainId, token) ??
        customTokens.find((t) => sameAddress(t.address, token)) ??
        makeUnknownToken(chainId, token, { symbol: "?", name: "Unknown token", decimals: 18 });
      const unlimited = isUnlimitedAllowance(current);
      const label = knownSpenderLabel(chainId, spender);
      out.push({
        token: info,
        spender,
        spenderLabel: label,
        raw: current.toString(),
        formatted: unlimited ? "Unlimited" : formatTokenAmount(current, info.decimals),
        unlimited,
        risk: unlimited && !label ? "high" : unlimited || !label ? "caution" : "low",
      });
    }),
  );
  return out.sort((a, b) => (a.risk === b.risk ? 0 : a.risk === "high" ? -1 : b.risk === "high" ? 1 : a.risk === "caution" ? -1 : 1));
}
