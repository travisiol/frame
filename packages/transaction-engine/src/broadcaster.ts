import { keccak256, type PublicClient, type TransactionReceipt } from "viem";
import type { Hex } from "@frame/types";

export interface TransactionBroadcaster {
  broadcast(chainId: number, signedRaw: Hex): Promise<Hex>;
}

/**
 * Sends signed transactions through the chain client. A given signed payload
 * is only ever submitted once per session — a retry loop elsewhere can never
 * turn into duplicate submissions.
 */
export class RpcBroadcaster implements TransactionBroadcaster {
  private readonly sent = new Set<Hex>();

  constructor(private readonly getClient: (chainId: number) => PublicClient) {}

  async broadcast(chainId: number, signedRaw: Hex): Promise<Hex> {
    const id = keccak256(signedRaw);
    if (this.sent.has(id)) throw new Error("This transaction was already submitted.");
    this.sent.add(id);
    try {
      return await this.getClient(chainId).sendRawTransaction({ serializedTransaction: signedRaw });
    } catch (e) {
      // Allow a deliberate user retry only if the node never accepted it.
      const msg = e instanceof Error ? e.message.toLowerCase() : "";
      if (!/already known|already imported|nonce too low/.test(msg)) this.sent.delete(id);
      throw e;
    }
  }
}

export async function waitForReceipt(
  client: PublicClient,
  hash: Hex,
  options: { timeoutMs?: number; pollingIntervalMs?: number } = {},
): Promise<TransactionReceipt> {
  return client.waitForTransactionReceipt({
    hash,
    timeout: options.timeoutMs ?? 120_000,
    pollingInterval: options.pollingIntervalMs ?? 1_500,
  });
}
