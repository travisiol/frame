/**
 * Same-origin JSON-RPC relay for the web app (Vercel Function).
 *
 * Why it exists: browsers cannot use the public Robinhood Chain RPC reliably —
 * its rate-limit responses carry a duplicated CORS header that Chrome rejects,
 * and some public Ethereum endpoints refuse browser origins outright. The web
 * app therefore sends its reads and its already-signed transactions through
 * this endpoint, which forwards them verbatim to the chain's own RPC.
 *
 * What it never sees: private keys, recovery phrases, passwords or vault
 * material. Signing happens in the browser; only signed payloads pass here.
 * Bodies are not logged or stored.
 *
 *   POST /api/rpc?chain=4663   body: JSON-RPC request or batch
 */

const UPSTREAMS: Record<string, string[]> = {
  "4663": ["https://rpc.mainnet.chain.robinhood.com"],
  "46630": ["https://rpc.testnet.chain.robinhood.com"],
  "1": ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://rpc.ankr.com/eth"],
  "42161": ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"],
  "8453": ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
};

/** Everything a self-custodial wallet needs, and nothing that could turn the relay into an open proxy. */
export const ALLOWED_METHODS = new Set([
  "eth_chainId",
  "net_version",
  "web3_clientVersion",
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
  "eth_sendRawTransaction",
]);

const MAX_BODY = 512 * 1024;
const MAX_BATCH = 100;

export type Validation = { ok: true; chain: string; body: string } | { ok: false; status: number; error: string };

/** Pure request validation — exported so it can be unit-tested without a server. */
export function validate(chainParam: string | null, rawBody: string): Validation {
  const chain = chainParam ?? "";
  if (!(chain in UPSTREAMS)) return { ok: false, status: 400, error: `Unsupported chain "${chain}".` };
  if (rawBody.length > MAX_BODY) return { ok: false, status: 413, error: "Request body too large." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, error: "Body is not JSON." };
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  if (items.length === 0 || items.length > MAX_BATCH) return { ok: false, status: 400, error: "Invalid batch size." };
  for (const item of items) {
    const method = (item as { method?: unknown })?.method;
    if (typeof method !== "string" || !ALLOWED_METHODS.has(method)) {
      return { ok: false, status: 403, error: `Method ${typeof method === "string" ? method : "?"} is not relayed.` };
    }
  }
  return { ok: true, chain, body: rawBody };
}

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const raw = await request.text();
  const v = validate(url.searchParams.get("chain"), raw);
  if (!v.ok) return json(v.status, { jsonrpc: "2.0", id: null, error: { code: -32600, message: v.error } });

  let lastError = "No upstream answered.";
  for (const upstream of UPSTREAMS[v.chain]!) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      const res = await fetch(upstream, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: v.body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        lastError = `Upstream ${new URL(upstream).host} answered ${res.status}.`;
        continue;
      }
      const text = await res.text();
      return new Response(text, { status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Upstream request failed.";
    }
  }
  return json(502, { jsonrpc: "2.0", id: null, error: { code: -32603, message: lastError } });
}

export function GET(): Response {
  return json(405, { error: "POST a JSON-RPC request with ?chain=<id>." });
}
