import { parseUnits } from "viem";
import type { Address, BridgeQuote, BridgeQuoteRequest } from "@frame/types";
import type { MarketDataProvider } from "./market-data";

/**
 * BridgeProvider — adapters over existing bridge protocols/aggregators
 * (LI.FI, Across, Relay, canonical bridge…). FRAME never implements a bridge
 * protocol itself; it only quotes, compares and signs the provider's
 * transaction.
 */
export interface BridgeProvider {
  readonly id: string;
  readonly name: string;
  quote(req: BridgeQuoteRequest): Promise<BridgeQuote | null>;
}

export interface BestBridgeResult {
  best: BridgeQuote | null;
  all: BridgeQuote[];
  errors: { providerId: string; error: string }[];
}

export async function bestBridgeQuote(providers: BridgeProvider[], req: BridgeQuoteRequest): Promise<BestBridgeResult> {
  const results = await Promise.allSettled(providers.map((p) => p.quote(req)));
  const all: BridgeQuote[] = [];
  const errors: BestBridgeResult["errors"] = [];
  results.forEach((r, i) => {
    const p = providers[i]!;
    if (r.status === "fulfilled") {
      if (r.value) all.push(r.value);
    } else errors.push({ providerId: p.id, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
  });
  all.sort((a, b) => Number(BigInt(b.amountOut) - BigInt(a.amountOut)));
  return { best: all[0] ?? null, all, errors };
}

export const DEMO_BRIDGE: Address = "0x00000000000000000000000000000000000b71d6";

/** DEMO mode only: a synthetic route so the bridge flow can be exercised end to end without any network. */
export class MockBridgeProvider implements BridgeProvider {
  constructor(
    readonly id: string,
    readonly name: string,
    private readonly market: MarketDataProvider,
    private readonly feeBps: number,
    private readonly seconds: number,
  ) {}

  async quote(req: BridgeQuoteRequest): Promise<BridgeQuote | null> {
    const amountIn = BigInt(req.amountIn);
    if (amountIn <= 0n) return null;
    const price = (await this.market.getTokenPrice(req.token)).priceUsd;
    const fee = (amountIn * BigInt(this.feeBps)) / 10_000n;
    const out = amountIn - fee;
    const feeUsd = price ? (Number(fee) / 10 ** req.token.decimals) * price : null;
    const isNative = req.token.address === "native";
    return {
      providerId: this.id,
      providerName: this.name,
      amountOut: out.toString(),
      feeUsd,
      estimatedSeconds: this.seconds,
      route: [`Chain ${req.fromChainId}`, this.name, `Chain ${req.toChainId}`],
      tx: {
        chainId: req.fromChainId,
        from: req.account,
        to: DEMO_BRIDGE,
        value: isNative ? amountIn.toString() : "0",
        data: "0x",
      },
      approval: isNative ? undefined : { spender: DEMO_BRIDGE, amount: parseUnits((Number(amountIn) / 10 ** req.token.decimals).toString(), req.token.decimals).toString() },
      demo: true,
    };
  }
}
