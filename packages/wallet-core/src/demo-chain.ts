import {
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  keccak256,
  multicall3Abi,
  parseTransaction,
  parseUnits,
  recoverTransactionAddress,
  toHex,
  type Hex,
} from "viem";
import type { ActivityItem, Address, TokenInfo, WalletEvent } from "@frame/types";
import { ETHEREUM_MAINNET_ID, MULTICALL3_ADDRESS, ROBINHOOD_MAINNET_ID } from "@frame/config";
import { DEMO_BRIDGE, DEMO_PRICES, DEMO_ROUTER_A, DEMO_ROUTER_B } from "@frame/markets";
import { findToken, getRegistry, makeUnknownToken, nativeToken } from "@frame/token-registry";
import { decodeTransaction } from "@frame/transaction-engine";
import { formatTokenAmount, sameAddress } from "@frame/chain";

/**
 * DemoChain — an in-memory JSON-RPC subset used in DEMO mode.
 *
 * It serves balances, fees, nonces, eth_call for ERC-20 reads and accepts
 * signed transactions from the real signing pipeline, applying them to a
 * simulated ledger. Nothing is ever broadcast; every result is flagged demo.
 */
export interface ChainGateway {
  request(chainId: number, method: string, params: unknown[]): Promise<unknown>;
}

export const DEMO_TOKEN: Address = "0x00000000000000000000000000000000000d3a0d";
export const DEMO_SPAM_TOKEN: Address = "0x00000000000000000000000000000000000d3a0e";
const DEMO_EXAMPLE_DAPP: Address = "0x00000000000000000000000000000000000dab01";

interface Ledger {
  eth: Map<string, bigint>;
  tokens: Map<string, Map<string, bigint>>;
  allowances: Map<string, bigint>;
  nonces: Map<string, number>;
}

interface DemoTx {
  hash: Hex;
  chainId: number;
  from: Address;
  to?: Address;
  value: bigint;
  data: Hex;
  nonce: number;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  blockNumber: number;
  timestamp: number;
  status: 0 | 1;
}

const BASE_FEE = 100_000_000n; // 0.1 gwei
const PRIORITY_FEE = 1_000_000n;
const START_BLOCK = 67_398_302;

const lc = (a: string) => a.toLowerCase();

export class DemoChain implements ChainGateway {
  private readonly ledgers = new Map<number, Ledger>();
  private readonly txs = new Map<string, DemoTx>();
  private readonly activity = new Map<string, ActivityItem[]>();
  private readonly seeded = new Set<string>();
  private readonly startedAt: number;
  private txCount = 0;
  private readonly extraTokens: TokenInfo[];

  constructor(private readonly onEvent?: (event: WalletEvent) => void) {
    this.startedAt = Date.now();
    this.extraTokens = [
      makeUnknownToken(ROBINHOOD_MAINNET_ID, DEMO_TOKEN, { symbol: "DEMO", name: "Demo Ecosystem Token", decimals: 18 }, { category: "ecosystem" }),
      makeUnknownToken(ROBINHOOD_MAINNET_ID, DEMO_SPAM_TOKEN, { symbol: "CLAIM", name: "Visit claim-rewards.xyz to claim", decimals: 18 }),
    ];
  }

  reset(): void {
    this.ledgers.clear();
    this.txs.clear();
    this.activity.clear();
    this.seeded.clear();
    this.txCount = 0;
  }

  private ledger(chainId: number): Ledger {
    let l = this.ledgers.get(chainId);
    if (!l) {
      l = { eth: new Map(), tokens: new Map(), allowances: new Map(), nonces: new Map() };
      this.ledgers.set(chainId, l);
    }
    return l;
  }

  private blockNumber(): number {
    return START_BLOCK + Math.floor((Date.now() - this.startedAt) / 2000) + this.txCount;
  }

  private tokenInfo(chainId: number, address: string): TokenInfo | undefined {
    return findToken(chainId, address) ?? this.extraTokens.find((t) => t.address === lc(address) && t.chainId === chainId);
  }

  private tokenBalance(chainId: number, token: string, owner: string): bigint {
    return this.ledger(chainId).tokens.get(lc(token))?.get(lc(owner)) ?? 0n;
  }

  private setTokenBalance(chainId: number, token: string, owner: string, value: bigint) {
    const l = this.ledger(chainId);
    let m = l.tokens.get(lc(token));
    if (!m) {
      m = new Map();
      l.tokens.set(lc(token), m);
    }
    m.set(lc(owner), value);
  }

  private ethBalance(chainId: number, owner: string): bigint {
    return this.ledger(chainId).eth.get(lc(owner)) ?? 0n;
  }

  setEth(chainId: number, owner: string, value: bigint) {
    this.ledger(chainId).eth.set(lc(owner), value);
  }

  private allowanceKey(token: string, owner: string, spender: string) {
    return `${lc(token)}:${lc(owner)}:${lc(spender)}`;
  }

  private pushActivity(address: string, item: ActivityItem) {
    const list = this.activity.get(lc(address)) ?? [];
    list.unshift(item);
    this.activity.set(lc(address), list);
  }

  private priceOf(token: TokenInfo | undefined): number | undefined {
    if (!token) return undefined;
    return DEMO_PRICES[token.symbol]?.price ?? (token.category === "stable" ? 1 : undefined);
  }

  /** Seeds the demo portfolio for an address the first time it is seen. */
  seedAccount(address: Address): void {
    const a = lc(address);
    if (this.seeded.has(a)) return;
    this.seeded.add(a);
    const chainId = ROBINHOOD_MAINNET_ID;
    const reg = getRegistry(chainId);
    const bySymbol = (s: string) => reg.find((t) => t.symbol === s);
    const seedToken = (symbol: string, amount: string) => {
      const t = bySymbol(symbol);
      if (t && t.address !== "native") this.setTokenBalance(chainId, t.address, a, parseUnits(amount, t.decimals));
    };
    this.setEth(chainId, a, parseUnits("2", 18));
    seedToken("NVDA", "26.17");
    seedToken("TSLA", "6");
    seedToken("AAPL", "7.2");
    seedToken("USDG", "3128");
    this.setTokenBalance(chainId, DEMO_TOKEN, a, parseUnits("14410.3", 18));
    this.setTokenBalance(chainId, DEMO_SPAM_TOKEN, a, parseUnits("1000000", 18));
    this.setEth(ETHEREUM_MAINNET_ID, a, parseUnits("1.25", 18));

    const usdg = bySymbol("USDG");
    const nvda = bySymbol("NVDA");
    if (usdg && usdg.address !== "native") {
      this.ledger(chainId).allowances.set(this.allowanceKey(usdg.address, a, DEMO_ROUTER_A), (1n << 256n) - 1n);
    }
    if (nvda && nvda.address !== "native") {
      this.ledger(chainId).allowances.set(this.allowanceKey(nvda.address, a, DEMO_ROUTER_B), parseUnits("500", 18));
    }

    const now = Date.now();
    const h = (n: number) => keccak256(toHex(`${a}:seed:${n}`)) as Hex;
    const seed: ActivityItem[] = [
      {
        id: `demo:${chainId}:${h(1)}`,
        hash: h(1),
        kind: "receive",
        title: "Received USDG",
        subtitle: "From 0x83A1…4F2E",
        amounts: [{ symbol: "USDG", amount: "250", sign: "+", tokenAddress: usdg?.address }],
        timestamp: now - 2 * 3600_000,
        status: "confirmed",
        chainId,
        demo: true,
        tokenAddresses: usdg ? [usdg.address] : [],
        source: "demo",
      },
      {
        id: `demo:${chainId}:${h(2)}`,
        hash: h(2),
        kind: "buy",
        title: "Bought NVDA",
        subtitle: "via Demo Router A",
        amounts: [
          { symbol: "NVDA", amount: "2.41", sign: "+", tokenAddress: nvda?.address },
          { symbol: "USDG", amount: "450", sign: "-", tokenAddress: usdg?.address },
        ],
        timestamp: now - 26 * 3600_000,
        status: "confirmed",
        chainId,
        demo: true,
        tokenAddresses: [nvda?.address ?? "", usdg?.address ?? ""].filter(Boolean),
        source: "demo",
      },
      {
        id: `demo:${chainId}:${h(3)}`,
        hash: h(3),
        kind: "send",
        title: "Sent ETH",
        subtitle: "To 0x71C4…5D22",
        amounts: [{ symbol: "ETH", amount: "0.42", sign: "-", tokenAddress: "native" }],
        counterparty: "0x71c4a9b2e13f0d6c8a4b5e2f1d3c4b5a6f7e5d22",
        timestamp: now - 2 * 86_400_000,
        status: "confirmed",
        chainId,
        demo: true,
        tokenAddresses: ["native"],
        source: "demo",
      },
      {
        id: `demo:${chainId}:${h(4)}`,
        hash: h(4),
        kind: "swap",
        title: "Swapped USDG for NVDA",
        subtitle: "via Demo Router A",
        amounts: [
          { symbol: "USDG", amount: "1,000", sign: "-", tokenAddress: usdg?.address },
          { symbol: "NVDA", amount: "5.43", sign: "+", tokenAddress: nvda?.address },
        ],
        timestamp: now - 4 * 86_400_000,
        status: "confirmed",
        chainId,
        demo: true,
        tokenAddresses: [nvda?.address ?? "", usdg?.address ?? ""].filter(Boolean),
        source: "demo",
      },
      {
        id: `demo:${chainId}:connect:1`,
        kind: "connect",
        title: "Connected to Example Protocol",
        subtitle: "example-protocol.demo",
        amounts: [],
        counterparty: DEMO_EXAMPLE_DAPP,
        timestamp: now - 5 * 86_400_000,
        status: "confirmed",
        chainId,
        demo: true,
        source: "demo",
      },
    ];
    this.activity.set(a, seed);
  }

  getActivity(address: Address): ActivityItem[] {
    return [...(this.activity.get(lc(address)) ?? [])];
  }

  /** Tokens with a non-zero balance that are not in the registry (demo ecosystem + spam sample). */
  getDetectedTokens(chainId: number, address: Address): TokenInfo[] {
    return this.extraTokens.filter((t) => t.chainId === chainId && this.tokenBalance(chainId, t.address as string, address) > 0n);
  }

  /** Non-zero allowances granted by `owner` on the demo ledger. */
  getAllowances(chainId: number, owner: Address): { token: TokenInfo; spender: Address; raw: bigint }[] {
    const out: { token: TokenInfo; spender: Address; raw: bigint }[] = [];
    for (const [key, raw] of this.ledger(chainId).allowances) {
      const [token, o, spender] = key.split(":") as [string, string, string];
      if (o !== lc(owner) || raw === 0n) continue;
      const info = this.tokenInfo(chainId, token);
      if (info) out.push({ token: info, spender: spender as Address, raw });
    }
    return out;
  }

  async request(chainId: number, method: string, params: unknown[] = []): Promise<unknown> {
    const p = params as [unknown, unknown?];
    switch (method) {
      case "eth_chainId":
        return toHex(chainId);
      case "net_version":
        return String(chainId);
      case "eth_blockNumber":
        return toHex(this.blockNumber());
      case "eth_gasPrice":
        return toHex(BASE_FEE + PRIORITY_FEE);
      case "eth_maxPriorityFeePerGas":
        return toHex(PRIORITY_FEE);
      case "eth_feeHistory":
        return { oldestBlock: toHex(this.blockNumber() - 1), baseFeePerGas: [toHex(BASE_FEE), toHex(BASE_FEE)], gasUsedRatio: [0.2], reward: [[toHex(PRIORITY_FEE)]] };
      case "eth_getBlockByNumber":
      case "eth_getBlockByHash":
        return this.block();
      case "eth_getBalance":
        return toHex(this.ethBalance(chainId, String(p[0])));
      case "eth_getTransactionCount":
        return toHex(this.ledger(chainId).nonces.get(lc(String(p[0]))) ?? 0);
      case "eth_getCode": {
        const addr = lc(String(p[0]));
        const known = this.tokenInfo(chainId, addr) || [DEMO_ROUTER_A, DEMO_ROUTER_B, DEMO_BRIDGE, DEMO_EXAMPLE_DAPP, MULTICALL3_ADDRESS].map(lc).includes(addr);
        return known ? "0x6080604052600080fd" : "0x";
      }
      case "eth_estimateGas": {
        const tx = (p[0] ?? {}) as { data?: string; to?: string };
        if (!tx.data || tx.data === "0x") return toHex(21_000);
        const sel = tx.data.slice(0, 10);
        if (sel === "0x095ea7b3") return toHex(46_000);
        if (sel === "0xa9059cbb") return toHex(52_000);
        return toHex(150_000);
      }
      case "eth_call":
        return this.call(chainId, (p[0] ?? {}) as { to?: string; data?: string; from?: string });
      case "eth_getLogs":
        return [];
      case "eth_sendRawTransaction":
        return this.sendRaw(chainId, String(p[0]) as Hex);
      case "eth_getTransactionReceipt": {
        const tx = this.txs.get(lc(String(p[0])));
        return tx ? this.receipt(tx) : null;
      }
      case "eth_getTransactionByHash": {
        const tx = this.txs.get(lc(String(p[0])));
        return tx ? this.txObject(tx) : null;
      }
      default:
        throw new Error(`Demo chain does not support ${method}`);
    }
  }

  private block() {
    const n = this.blockNumber();
    const hash = keccak256(toHex(`demo-block-${n}`));
    return {
      number: toHex(n),
      hash,
      parentHash: keccak256(toHex(`demo-block-${n - 1}`)),
      baseFeePerGas: toHex(BASE_FEE),
      timestamp: toHex(Math.floor(Date.now() / 1000)),
      gasLimit: toHex(30_000_000),
      gasUsed: toHex(1_200_000),
      miner: "0x0000000000000000000000000000000000000000",
      difficulty: "0x0",
      totalDifficulty: "0x0",
      extraData: "0x",
      logsBloom: `0x${"0".repeat(512)}`,
      mixHash: `0x${"0".repeat(64)}`,
      nonce: "0x0000000000000000",
      receiptsRoot: `0x${"0".repeat(64)}`,
      sha3Uncles: `0x${"0".repeat(64)}`,
      size: "0x400",
      stateRoot: `0x${"0".repeat(64)}`,
      transactionsRoot: `0x${"0".repeat(64)}`,
      transactions: [],
      uncles: [],
    };
  }

  private call(chainId: number, tx: { to?: string; data?: string; from?: string }): Hex {
    if (!tx.to || !tx.data || tx.data === "0x") return "0x";
    // Multicall3 exists on the real chain, so viem batches reads through it; serve aggregate3 here too.
    if (lc(tx.to) === lc(MULTICALL3_ADDRESS)) {
      let decoded: { functionName: string; args?: readonly unknown[] };
      try {
        decoded = decodeFunctionData({ abi: multicall3Abi, data: tx.data as Hex });
      } catch {
        return "0x";
      }
      if (decoded.functionName !== "aggregate3") return "0x";
      const calls = (decoded.args?.[0] ?? []) as readonly { target: Address; allowFailure: boolean; callData: Hex }[];
      const results = calls.map((c) => {
        const returnData = this.call(chainId, { to: c.target, data: c.callData });
        return { success: returnData !== "0x", returnData };
      });
      return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results });
    }
    const token = this.tokenInfo(chainId, tx.to);
    if (token && token.address !== "native") {
      let decoded: { functionName: string; args?: readonly unknown[] };
      try {
        decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data as Hex });
      } catch {
        return "0x";
      }
      const enc = (functionName: "balanceOf" | "allowance" | "decimals" | "symbol" | "name" | "totalSupply", result: unknown) =>
        encodeFunctionResult({ abi: erc20Abi, functionName, result: result as never });
      switch (decoded.functionName) {
        case "balanceOf":
          return enc("balanceOf", this.tokenBalance(chainId, tx.to, String(decoded.args?.[0])));
        case "allowance":
          return enc("allowance", this.ledger(chainId).allowances.get(this.allowanceKey(tx.to, String(decoded.args?.[0]), String(decoded.args?.[1]))) ?? 0n);
        case "decimals":
          return enc("decimals", token.decimals);
        case "symbol":
          return enc("symbol", token.symbol);
        case "name":
          return enc("name", token.name);
        case "totalSupply":
          return enc("totalSupply", parseUnits("1000000000", token.decimals));
        default:
          return "0x";
      }
    }
    return "0x";
  }

  private async sendRaw(chainId: number, raw: Hex): Promise<Hex> {
    const parsed = parseTransaction(raw);
    const from = await recoverTransactionAddress({ serializedTransaction: raw as never });
    if (parsed.chainId !== undefined && parsed.chainId !== chainId) throw new Error(`Transaction chain id ${parsed.chainId} does not match ${chainId}.`);
    const hash = keccak256(raw);
    if (this.txs.has(lc(hash))) throw new Error("already known");
    const ledger = this.ledger(chainId);
    const expectedNonce = ledger.nonces.get(lc(from)) ?? 0;
    const nonce = parsed.nonce ?? expectedNonce;
    if (nonce < expectedNonce) throw new Error("nonce too low");
    const value = parsed.value ?? 0n;
    const data = (parsed.data ?? "0x") as Hex;
    const to = parsed.to as Address | undefined;
    const gasUsed = BigInt((await this.request(chainId, "eth_estimateGas", [{ data, to }])) as string);
    const gasPrice = BASE_FEE + PRIORITY_FEE;
    const fee = gasUsed * gasPrice;
    const ethBefore = this.ethBalance(chainId, from);
    if (ethBefore < fee + value) throw new Error("insufficient funds for gas * price + value");

    ledger.nonces.set(lc(from), nonce + 1);
    this.txCount++;
    const record: DemoTx = { hash, chainId, from, to, value, data, nonce, gasUsed, effectiveGasPrice: gasPrice, blockNumber: this.blockNumber(), timestamp: Date.now(), status: 1 };
    this.setEth(chainId, from, ethBefore - fee);
    const ok = this.apply(chainId, record);
    record.status = ok ? 1 : 0;
    this.txs.set(lc(hash), record);
    return hash;
  }

  /** Applies a decoded transaction to the ledger. Returns false when it "reverts" (balance/allowance checks). */
  private apply(chainId: number, tx: DemoTx): boolean {
    const decoded = decodeTransaction({ to: tx.to, data: tx.data, value: tx.value });
    const from = tx.from;
    switch (decoded.intent) {
      case "native_transfer": {
        const to = decoded.recipient!;
        if (this.ethBalance(chainId, from) < tx.value) return false;
        this.setEth(chainId, from, this.ethBalance(chainId, from) - tx.value);
        this.setEth(chainId, to, this.ethBalance(chainId, to) + tx.value);
        if (sameAddress(to, DEMO_BRIDGE)) return this.bridge(chainId, tx);
        return true;
      }
      case "erc20_transfer": {
        const token = this.tokenInfo(chainId, decoded.token!);
        const amount = decoded.amount ?? 0n;
        if (!token || this.tokenBalance(chainId, decoded.token!, from) < amount) return false;
        this.setTokenBalance(chainId, decoded.token!, from, this.tokenBalance(chainId, decoded.token!, from) - amount);
        this.setTokenBalance(chainId, decoded.token!, decoded.recipient!, this.tokenBalance(chainId, decoded.token!, decoded.recipient!) + amount);
        return true;
      }
      case "approve": {
        this.ledger(chainId).allowances.set(this.allowanceKey(decoded.token!, from, decoded.spender!), decoded.approvalAmount ?? 0n);
        return true;
      }
      case "swap": {
        const s = decoded.swap!;
        const tokenIn = s.tokenIn === "native" ? nativeToken(chainId) : s.tokenIn ? this.tokenInfo(chainId, s.tokenIn) : undefined;
        const tokenOut = s.tokenOut === "native" ? nativeToken(chainId) : s.tokenOut ? this.tokenInfo(chainId, s.tokenOut) : undefined;
        const pIn = this.priceOf(tokenIn);
        const pOut = this.priceOf(tokenOut);
        if (!tokenIn || !tokenOut || !pIn || !pOut || s.amountIn === undefined) return false;
        const amountIn = s.amountIn;
        if (tokenIn.address === "native") {
          if (this.ethBalance(chainId, from) < amountIn) return false;
          this.setEth(chainId, from, this.ethBalance(chainId, from) - amountIn);
        } else {
          const allowance = this.ledger(chainId).allowances.get(this.allowanceKey(tokenIn.address, from, s.router)) ?? 0n;
          if (allowance < amountIn || this.tokenBalance(chainId, tokenIn.address, from) < amountIn) return false;
          this.ledger(chainId).allowances.set(this.allowanceKey(tokenIn.address, from, s.router), allowance - amountIn);
          this.setTokenBalance(chainId, tokenIn.address, from, this.tokenBalance(chainId, tokenIn.address, from) - amountIn);
        }
        const inUnits = Number(amountIn) / 10 ** tokenIn.decimals;
        const outUnits = ((inUnits * pIn) / pOut) * 0.997;
        const amountOut = parseUnits(outUnits.toFixed(tokenOut.decimals), tokenOut.decimals);
        if (s.amountOutMin !== undefined && amountOut < s.amountOutMin) return false;
        if (tokenOut.address === "native") this.setEth(chainId, from, this.ethBalance(chainId, from) + amountOut);
        else this.setTokenBalance(chainId, tokenOut.address, from, this.tokenBalance(chainId, tokenOut.address, from) + amountOut);
        return true;
      }
      default:
        return true;
    }
  }

  /** Demo bridge: funds leave the source chain now and arrive on Robinhood Chain a few seconds later. */
  private bridge(fromChainId: number, tx: DemoTx): boolean {
    const amountOut = (tx.value * 9987n) / 10_000n;
    setTimeout(() => {
      this.setEth(ROBINHOOD_MAINNET_ID, tx.from, this.ethBalance(ROBINHOOD_MAINNET_ID, tx.from) + amountOut);
      this.pushActivity(tx.from, {
        id: `demo:${ROBINHOOD_MAINNET_ID}:bridge:${tx.hash}`,
        hash: tx.hash,
        kind: "bridge",
        title: "Bridge completed",
        subtitle: `From chain ${fromChainId}`,
        amounts: [{ symbol: "ETH", amount: formatTokenAmount(amountOut, 18), sign: "+", tokenAddress: "native" }],
        timestamp: Date.now(),
        status: "confirmed",
        chainId: ROBINHOOD_MAINNET_ID,
        demo: true,
        tokenAddresses: ["native"],
        source: "demo",
      });
      this.onEvent?.({ type: "tx", hash: tx.hash, status: "confirmed", chainId: ROBINHOOD_MAINNET_ID });
    }, 4000);
    return true;
  }

  private receipt(tx: DemoTx) {
    return {
      transactionHash: tx.hash,
      transactionIndex: "0x0",
      blockHash: keccak256(toHex(`demo-block-${tx.blockNumber}`)),
      blockNumber: toHex(tx.blockNumber),
      from: tx.from,
      to: tx.to ?? null,
      cumulativeGasUsed: toHex(tx.gasUsed),
      gasUsed: toHex(tx.gasUsed),
      effectiveGasPrice: toHex(tx.effectiveGasPrice),
      contractAddress: null,
      logs: [],
      logsBloom: `0x${"0".repeat(512)}`,
      status: tx.status === 1 ? "0x1" : "0x0",
      type: "0x2",
    };
  }

  private txObject(tx: DemoTx) {
    return {
      hash: tx.hash,
      nonce: toHex(tx.nonce),
      blockHash: keccak256(toHex(`demo-block-${tx.blockNumber}`)),
      blockNumber: toHex(tx.blockNumber),
      transactionIndex: "0x0",
      from: tx.from,
      to: tx.to ?? null,
      value: toHex(tx.value),
      gas: toHex(tx.gasUsed),
      gasPrice: toHex(tx.effectiveGasPrice),
      maxFeePerGas: toHex(tx.effectiveGasPrice),
      maxPriorityFeePerGas: toHex(PRIORITY_FEE),
      input: tx.data,
      chainId: toHex(tx.chainId),
      type: "0x2",
      v: "0x0",
      r: `0x${"0".repeat(64)}`,
      s: `0x${"0".repeat(64)}`,
    };
  }
}
