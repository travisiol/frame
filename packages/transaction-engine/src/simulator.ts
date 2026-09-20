import { BaseError, type PublicClient } from "viem";
import type { PreparedTx, SimulationResult } from "@frame/types";
import { isNetworkError, isRateLimitError } from "@frame/chain";

/**
 * TransactionSimulator abstraction. The default implementation runs the
 * transaction as an eth_call from the sender. Where richer infrastructure
 * exists (trace_call / debug_traceCall, third-party simulators) a provider
 * can be plugged in here and report `method: "trace"` with exact asset
 * changes; until then expected changes come from decoding the calldata.
 */
export interface TransactionSimulator {
  simulate(client: PublicClient, tx: PreparedTx): Promise<SimulationResult>;
}

export class EthCallSimulator implements TransactionSimulator {
  async simulate(client: PublicClient, tx: PreparedTx): Promise<SimulationResult> {
    if (!tx.to) return { status: "unavailable", method: "none", error: "Contract deployments are not simulated." };
    try {
      await client.call({
        account: tx.from,
        to: tx.to,
        data: tx.data,
        value: BigInt(tx.value),
        gas: BigInt(tx.gas),
      });
      return { status: "success", gasEstimate: tx.gas, method: "eth_call" };
    } catch (e) {
      if (isRateLimitError(e) || isNetworkError(e)) {
        return { status: "unavailable", method: "eth_call", error: "Simulation could not reach the network." };
      }
      const reason = extractRevertReason(e);
      return { status: "reverted", method: "eth_call", error: reason ?? "The transaction would revert.", revertReason: reason };
    }
  }
}

export class NoopSimulator implements TransactionSimulator {
  async simulate(): Promise<SimulationResult> {
    return { status: "unavailable", method: "none", error: "Simulation is disabled." };
  }
}

export function extractRevertReason(e: unknown): string | undefined {
  if (e instanceof BaseError) {
    const details = e.details || e.shortMessage;
    const m = details.match(/reverted with reason string '([^']+)'|reason: ([^\n]+)|execution reverted: ([^\n]+)/);
    const found = m?.[1] ?? m?.[2] ?? m?.[3];
    return (found ?? e.shortMessage)?.trim();
  }
  if (e instanceof Error) return e.message;
  return undefined;
}
