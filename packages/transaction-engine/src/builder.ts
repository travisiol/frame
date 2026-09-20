import type { PublicClient } from "viem";
import type { Address, PreparedTx, TokenInfo, TxRequest } from "@frame/types";
import { encodeApprove, encodeTransfer, estimateFees, withGasBuffer } from "@frame/chain";

/** Builders produce unsigned TxRequests; nothing here touches keys. */
export function buildNativeTransfer(p: { chainId: number; from: Address; to: Address; valueWei: bigint }): TxRequest {
  return { chainId: p.chainId, from: p.from, to: p.to, value: p.valueWei.toString(), data: "0x" };
}

export function buildErc20Transfer(p: { chainId: number; from: Address; token: TokenInfo; to: Address; amount: bigint }): TxRequest {
  if (p.token.address === "native") return buildNativeTransfer({ chainId: p.chainId, from: p.from, to: p.to, valueWei: p.amount });
  return { chainId: p.chainId, from: p.from, to: p.token.address, value: "0", data: encodeTransfer(p.to, p.amount) };
}

export function buildApprove(p: { chainId: number; from: Address; token: Address; spender: Address; amount: bigint }): TxRequest {
  return { chainId: p.chainId, from: p.from, to: p.token, value: "0", data: encodeApprove(p.spender, p.amount) };
}

export interface PrepareOptions {
  gasBufferPct?: number;
  /** Fallback gas when estimation fails (the review will show the failed simulation). */
  fallbackGas?: bigint;
}

export interface PrepareResult {
  prepared: PreparedTx;
  gasEstimateError?: string;
}

/** Fills gas, nonce and EIP-1559 fees. Caller-provided values win (Advanced → nonce / gas limit). */
export async function prepareTransaction(client: PublicClient, req: TxRequest, options: PrepareOptions = {}): Promise<PrepareResult> {
  const value = BigInt(req.value ?? "0");
  const data = (req.data ?? "0x") as PreparedTx["data"];
  let gasEstimateError: string | undefined;

  let gas: bigint;
  if (req.gas) {
    gas = BigInt(req.gas);
  } else {
    try {
      const est = await client.estimateGas({ account: req.from, to: req.to, value, data });
      gas = withGasBuffer(est, options.gasBufferPct ?? (data === "0x" ? 0 : 20));
    } catch (e) {
      gasEstimateError = e instanceof Error ? e.message : String(e);
      gas = options.fallbackGas ?? (data === "0x" ? 21_000n : 300_000n);
    }
  }

  const nonce = req.nonce ?? (await client.getTransactionCount({ address: req.from, blockTag: "pending" }));

  let maxFeePerGas: bigint;
  let maxPriorityFeePerGas: bigint;
  if (req.maxFeePerGas && req.maxPriorityFeePerGas) {
    maxFeePerGas = BigInt(req.maxFeePerGas);
    maxPriorityFeePerGas = BigInt(req.maxPriorityFeePerGas);
  } else {
    const fees = await estimateFees(client);
    maxFeePerGas = req.maxFeePerGas ? BigInt(req.maxFeePerGas) : fees.maxFeePerGas;
    maxPriorityFeePerGas = req.maxPriorityFeePerGas ? BigInt(req.maxPriorityFeePerGas) : fees.maxPriorityFeePerGas;
    if (maxPriorityFeePerGas > maxFeePerGas) maxPriorityFeePerGas = maxFeePerGas;
  }

  const prepared: PreparedTx = {
    chainId: req.chainId,
    from: req.from,
    to: req.to,
    value: value.toString(),
    data,
    gas: gas.toString(),
    nonce,
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
  };
  return gasEstimateError ? { prepared, gasEstimateError } : { prepared };
}
