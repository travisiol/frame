import { createPublicClient, custom, fallback, http, type PublicClient, type Transport } from "viem";
import { getChain, getChainConfig, type RpcOverrides } from "@frame/config";

export class ChainMismatchError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number | null,
  ) {
    super(
      actual === null
        ? `The RPC did not report a chain id (expected ${expected}).`
        : `The RPC reports chain ${actual} but this wallet is configured for chain ${expected}.`,
    );
    this.name = "ChainMismatchError";
  }
}

export interface ClientOptions {
  /** Explicit RPC list; otherwise resolved from config + overrides. */
  rpcUrls?: string[];
  overrides?: RpcOverrides;
  timeoutMs?: number;
  /** Batches JSON-RPC calls made within the wait window into one HTTP request. */
  batch?: boolean;
}

/** Public client with ordered RPC fallback (dedicated provider → custom → public). No ranking: order is intent. */
export function createChainClient(chainId: number, options: ClientOptions = {}): PublicClient {
  const cfg = getChainConfig(chainId, options.overrides);
  const urls = options.rpcUrls?.length ? options.rpcUrls : cfg.rpcUrls;
  const transports = urls.map((url) =>
    http(url, {
      timeout: options.timeoutMs ?? 15_000,
      retryCount: 1,
      retryDelay: 400,
      batch: options.batch === false ? false : { wait: 16, batchSize: 50 },
    }),
  );
  return createPublicClient({
    chain: cfg.chain,
    transport: fallback(transports, { rank: false, retryCount: 0 }),
  });
}

/** Client whose requests are served by a function — used by the UI to talk to the background, and by tests to stub RPC. */
export function createProxiedClient(
  chainId: number,
  request: (args: { method: string; params?: unknown }) => Promise<unknown>,
): PublicClient {
  const transport: Transport = custom({ request: (args) => request(args as { method: string; params?: unknown }) });
  return createPublicClient({ chain: getChain(chainId), transport });
}

/**
 * RPC spoofing guard: refuses an endpoint that does not report the configured
 * chain id. Called when a custom RPC is saved and on client warm-up, so a
 * mis-pointed or malicious endpoint can never sign us onto the wrong chain.
 */
export async function verifyChainId(client: PublicClient, expected: number): Promise<number> {
  let actual: number | null = null;
  try {
    const hex = (await client.request({ method: "eth_chainId" })) as string;
    actual = typeof hex === "string" && /^0x[0-9a-fA-F]+$/.test(hex) ? Number.parseInt(hex, 16) : null;
  } catch {
    actual = null;
  }
  if (actual !== expected) throw new ChainMismatchError(expected, actual);
  return actual;
}

/** Quick health probe for the developer panel / RPC settings. */
export async function probeRpc(url: string, expectedChainId: number): Promise<{ ok: boolean; latencyMs: number; chainId: number | null; error?: string }> {
  const started = Date.now();
  try {
    const client = createChainClient(expectedChainId, { rpcUrls: [url], batch: false, timeoutMs: 8_000 });
    const chainId = await verifyChainId(client, expectedChainId);
    return { ok: true, latencyMs: Date.now() - started, chainId };
  } catch (e) {
    const chainId = e instanceof ChainMismatchError ? e.actual : null;
    return { ok: false, latencyMs: Date.now() - started, chainId, error: e instanceof Error ? e.message : "RPC unreachable" };
  }
}

export function isRateLimitError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /429|too many requests|rate limit/i.test(msg);
}

export function isNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /fetch|network|timeout|timed out|ECONN|failed to fetch|HTTP request failed|502|503|504/i.test(msg);
}
