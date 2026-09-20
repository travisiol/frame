import { encodeFunctionData, parseAbi, parseUnits } from "viem";
import type { Address, SwapQuote, SwapQuoteRequest, SwapStep, TokenInfo } from "@frame/types";
import { encodeApprove } from "@frame/chain";
import type { MarketDataProvider } from "./market-data";

/**
 * SwapProvider — modular liquidity adapters. The wallet never hardcodes one
 * DEX. Adapters return null when they have no route; the router compares the
 * rest by expected output after costs.
 */
export interface SwapProvider {
  readonly id: string;
  readonly name: string;
  /** "any" when the adapter can quote arbitrary ERC-20 pairs. */
  getSupportedTokens(chainId: number): Promise<TokenInfo[] | "any">;
  quote(req: SwapQuoteRequest): Promise<SwapQuote | null>;
  buildTransaction(quote: SwapQuote, req: SwapQuoteRequest): Promise<SwapStep[]>;
}

export interface BestQuoteResult {
  best: SwapQuote | null;
  all: SwapQuote[];
  errors: { providerId: string; error: string }[];
}

/** Compares quotes on net output (amountOut − fees converted to output token when a price is known). */
export async function bestSwapQuote(
  providers: SwapProvider[],
  req: SwapQuoteRequest,
  toTokenPriceUsd?: number | null,
): Promise<BestQuoteResult> {
  const results = await Promise.allSettled(providers.map((p) => p.quote(req)));
  const all: SwapQuote[] = [];
  const errors: BestQuoteResult["errors"] = [];
  results.forEach((r, i) => {
    const p = providers[i]!;
    if (r.status === "fulfilled") {
      if (r.value) all.push(r.value);
    } else errors.push({ providerId: p.id, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
  });
  const net = (q: SwapQuote): number => {
    const out = Number(q.amountOut) / 10 ** req.toToken.decimals;
    const costs = (q.feeUsd ?? 0) + (q.gasUsd ?? 0);
    if (toTokenPriceUsd && toTokenPriceUsd > 0) return out - costs / toTokenPriceUsd;
    return out;
  };
  all.sort((a, b) => net(b) - net(a));
  return { best: all[0] ?? null, all, errors };
}

const routerAbi = parseAbi([
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
]);

/** Demo router addresses — obviously synthetic, only exist on the demo chain. */
export const DEMO_ROUTER_A: Address = "0x00000000000000000000000000000000000d3a01";
export const DEMO_ROUTER_B: Address = "0x00000000000000000000000000000000000d3a02";
export const DEMO_WETH: Address = "0x00000000000000000000000000000000000d3e7a";

/**
 * MockSwapProvider — DEMO mode only. Quotes come from the demo price table;
 * the transaction it builds is a real, decodable Uniswap-V2-style call so the
 * review screen, the signer and the demo chain exercise the same path as a
 * live swap. Nothing is ever broadcast.
 */
export class MockSwapProvider implements SwapProvider {
  constructor(
    readonly id: string,
    readonly name: string,
    private readonly router: Address,
    private readonly market: MarketDataProvider,
    private readonly feeBps: number,
    private readonly gasUsd: number,
  ) {}

  async getSupportedTokens(): Promise<"any"> {
    return "any";
  }

  async quote(req: SwapQuoteRequest): Promise<SwapQuote | null> {
    const [pIn, pOut] = await Promise.all([this.market.getTokenPrice(req.fromToken), this.market.getTokenPrice(req.toToken)]);
    if (!pIn.priceUsd || !pOut.priceUsd) return null;
    const amountIn = Number(req.amountIn) / 10 ** req.fromToken.decimals;
    if (!(amountIn > 0)) return null;
    const usdIn = amountIn * pIn.priceUsd;
    const impact = Math.min(8, (usdIn / 250_000) * 100); // toy depth: 250k USD moves price 1%
    const gross = (usdIn / pOut.priceUsd) * (1 - impact / 100);
    const feeUsd = usdIn * (this.feeBps / 10_000);
    const out = gross * (1 - this.feeBps / 10_000);
    const outRaw = parseUnits(out.toFixed(req.toToken.decimals), req.toToken.decimals);
    const minRaw = (outRaw * BigInt(10_000 - req.slippageBps)) / 10_000n;
    return {
      providerId: this.id,
      providerName: this.name,
      amountOut: outRaw.toString(),
      amountOutMin: minRaw.toString(),
      rate: out / amountIn,
      priceImpactPct: impact,
      feeUsd,
      gasUsd: this.gasUsd,
      route: [req.fromToken.symbol, req.toToken.symbol],
      estimatedSeconds: 4,
      expiresAt: Date.now() + 30_000,
      approval: req.fromToken.address === "native" ? undefined : { spender: this.router, amount: req.amountIn },
      demo: true,
    };
  }

  async buildTransaction(quote: SwapQuote, req: SwapQuoteRequest): Promise<SwapStep[]> {
    const steps: SwapStep[] = [];
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const fromNative = req.fromToken.address === "native";
    const toNative = req.toToken.address === "native";
    const pathIn = fromNative ? DEMO_WETH : (req.fromToken.address as Address);
    const pathOut = toNative ? DEMO_WETH : (req.toToken.address as Address);
    if (!fromNative) {
      steps.push({
        kind: "approve",
        label: `Allow ${this.name} to use ${req.fromToken.symbol}`,
        tx: { chainId: req.chainId, from: req.account, to: req.fromToken.address as Address, value: "0", data: encodeApprove(this.router, BigInt(req.amountIn)) },
      });
    }
    const data = fromNative
      ? encodeFunctionData({ abi: routerAbi, functionName: "swapExactETHForTokens", args: [BigInt(quote.amountOutMin), [pathIn, pathOut], req.account, deadline] })
      : toNative
        ? encodeFunctionData({ abi: routerAbi, functionName: "swapExactTokensForETH", args: [BigInt(req.amountIn), BigInt(quote.amountOutMin), [pathIn, pathOut], req.account, deadline] })
        : encodeFunctionData({ abi: routerAbi, functionName: "swapExactTokensForTokens", args: [BigInt(req.amountIn), BigInt(quote.amountOutMin), [pathIn, pathOut], req.account, deadline] });
    steps.push({
      kind: "swap",
      label: `Swap ${req.fromToken.symbol} for ${req.toToken.symbol}`,
      tx: { chainId: req.chainId, from: req.account, to: this.router, value: fromNative ? req.amountIn : "0", data },
    });
    return steps;
  }
}
