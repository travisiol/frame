import { formatEther, parseEther, type PublicClient } from "viem";

export interface FeeEstimate {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  /** Latest base fee when available (informational). */
  baseFeePerGas?: bigint;
}

/** EIP-1559 fee estimate with a legacy gas-price fallback for RPCs that lack fee history. */
export async function estimateFees(client: PublicClient): Promise<FeeEstimate> {
  try {
    const fees = await client.estimateFeesPerGas();
    const block = await client.getBlock({ blockTag: "latest" }).catch(() => undefined);
    return {
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      baseFeePerGas: block?.baseFeePerGas ?? undefined,
    };
  } catch {
    const gasPrice = await client.getGasPrice();
    return { maxFeePerGas: gasPrice, maxPriorityFeePerGas: gasPrice };
  }
}

export function feeWei(gas: bigint, maxFeePerGas: bigint): bigint {
  return gas * maxFeePerGas;
}

export function weiToEthString(wei: bigint): string {
  return formatEther(wei);
}

export function ethToWei(eth: string): bigint {
  return parseEther(eth);
}

/** Adds head-room to an estimate so a marginal gas estimate does not fail on inclusion. */
export function withGasBuffer(gas: bigint, percent = 20): bigint {
  return (gas * BigInt(100 + percent)) / 100n;
}

export function isLowGas(balanceWei: bigint, thresholdEth: string): boolean {
  try {
    return balanceWei < parseEther(thresholdEth);
  } catch {
    return false;
  }
}
