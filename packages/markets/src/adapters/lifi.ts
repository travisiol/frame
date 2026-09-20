import type { Address, BridgeQuote, BridgeQuoteRequest, Hex, SwapQuote, SwapQuoteRequest, SwapStep, TokenInfo } from "@frame/types";
import { encodeApprove } from "@frame/chain";
import type { BridgeProvider } from "../bridge";
import type { SwapProvider } from "../swap";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const NATIVE = "0x0000000000000000000000000000000000000000";

interface LifiQuoteResponse {
  tool?: string;
  toolDetails?: { name?: string };
  estimate?: {
    toAmount?: string;
    toAmountMin?: string;
    approvalAddress?: string;
    executionDuration?: number;
    feeCosts?: { amountUSD?: string }[];
    gasCosts?: { amountUSD?: string; amount?: string }[];
  };
  transactionRequest?: { to?: string; data?: string; value?: string; gasLimit?: string; chainId?: number };
  includedSteps?: { tool?: string; action?: { fromToken?: { symbol?: string }; toToken?: { symbol?: string } } }[];
}

/**
 * LI.FI adapter (https://li.quest). Used for both same-chain swaps and
 * bridges. It only claims a route when the API actually returns one — a
 * 4xx/empty answer is "no route", never a fabricated quote. Enabled only
 * when VITE_LIFI_API_URL is set.
 */
export class LifiAdapter implements SwapProvider, BridgeProvider {
  readonly id = "lifi";
  readonly name = "LI.FI";
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly baseUrl: string,
    options: { fetchImpl?: FetchLike; integrator?: string } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? ((i, init) => fetch(i, init));
    this.integrator = options.integrator ?? "frame-wallet";
  }
  private readonly integrator: string;

  async getSupportedTokens(): Promise<"any"> {
    return "any";
  }

  private async fetchQuote(params: Record<string, string>): Promise<LifiQuoteResponse | null> {
    const qs = new URLSearchParams({ ...params, integrator: this.integrator }).toString();
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/quote?${qs}`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as LifiQuoteResponse;
    if (!data?.estimate?.toAmount || !data.transactionRequest?.to) return null;
    return data;
  }

  private sumUsd(list?: { amountUSD?: string }[]): number | null {
    if (!list?.length) return null;
    const n = list.reduce((s, x) => s + Number(x.amountUSD ?? 0), 0);
    return Number.isFinite(n) ? n : null;
  }

  private sumWei(list?: { amount?: string }[]): string | undefined {
    if (!list?.length) return undefined;
    try {
      return list.reduce((s, x) => s + BigInt(x.amount ?? "0"), 0n).toString();
    } catch {
      return undefined;
    }
  }

  private tokenAddr(t: TokenInfo): string {
    return t.address === "native" ? NATIVE : t.address;
  }

  async quote(req: SwapQuoteRequest | BridgeQuoteRequest): Promise<(SwapQuote & BridgeQuote) | null> {
    const isBridge = "fromChainId" in req;
    const fromChain = isBridge ? req.fromChainId : req.chainId;
    const toChain = isBridge ? req.toChainId : req.chainId;
    const fromToken = isBridge ? req.token : req.fromToken;
    const toToken = isBridge ? req.token : req.toToken;
    const slippage = isBridge ? 0.005 : req.slippageBps / 10_000;
    const data = await this.fetchQuote({
      fromChain: String(fromChain),
      toChain: String(toChain),
      fromToken: this.tokenAddr(fromToken),
      toToken: this.tokenAddr(toToken),
      fromAmount: req.amountIn,
      fromAddress: req.account,
      slippage: String(slippage),
    });
    if (!data) return null;
    const est = data.estimate!;
    const amountOut = est.toAmount!;
    const amountOutMin = est.toAmountMin ?? amountOut;
    const amountInNum = Number(req.amountIn) / 10 ** fromToken.decimals;
    const amountOutNum = Number(amountOut) / 10 ** toToken.decimals;
    const tx = data.transactionRequest!;
    const approval =
      fromToken.address !== "native" && est.approvalAddress ? { spender: est.approvalAddress as Address, amount: req.amountIn } : undefined;
    return {
      providerId: this.id,
      providerName: data.toolDetails?.name ? `${this.name} · ${data.toolDetails.name}` : this.name,
      amountOut,
      amountOutMin,
      rate: amountInNum > 0 ? amountOutNum / amountInNum : 0,
      priceImpactPct: null,
      feeUsd: this.sumUsd(est.feeCosts),
      gasUsd: this.sumUsd(est.gasCosts),
      gasCostWei: this.sumWei(est.gasCosts),
      estimatedSeconds: est.executionDuration ?? null,
      route: (data.includedSteps ?? []).map((s) => s.tool ?? "").filter(Boolean),
      expiresAt: Date.now() + 45_000,
      approval,
      tx: {
        chainId: tx.chainId ?? fromChain,
        from: req.account,
        to: tx.to as Address,
        data: (tx.data ?? "0x") as Hex,
        value: tx.value ? BigInt(tx.value).toString() : "0",
        gas: tx.gasLimit ? BigInt(tx.gasLimit).toString() : undefined,
      },
      raw: data,
    };
  }

  async buildTransaction(quote: SwapQuote, req: SwapQuoteRequest): Promise<SwapStep[]> {
    const q = quote as SwapQuote & Partial<BridgeQuote>;
    if (!q.tx) throw new Error("Quote has no transaction.");
    const steps: SwapStep[] = [];
    if (q.approval) {
      steps.push({
        kind: "approve",
        label: `Allow ${this.name} to use ${req.fromToken.symbol}`,
        tx: { chainId: req.chainId, from: req.account, to: req.fromToken.address as Address, value: "0", data: encodeApprove(q.approval.spender, BigInt(q.approval.amount)) },
      });
    }
    steps.push({ kind: "swap", label: `Swap ${req.fromToken.symbol} for ${req.toToken.symbol}`, tx: q.tx });
    return steps;
  }
}
