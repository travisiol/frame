import type { Hex, LocalAccount, TransactionSerializableEIP1559, TypedDataDefinition } from "viem";
import type { PreparedTx } from "@frame/types";

/**
 * TransactionSigner — the only component that touches signing keys, and it
 * only ever receives a viem LocalAccount handed to it by the keyring. UI code
 * never sees this interface.
 */
export interface TransactionSigner {
  signTransaction(tx: PreparedTx, account: LocalAccount): Promise<Hex>;
  signMessage(message: string | { raw: Hex }, account: LocalAccount): Promise<Hex>;
  signTypedData(typedData: TypedDataDefinition, account: LocalAccount): Promise<Hex>;
}

export function toSerializable(tx: PreparedTx): TransactionSerializableEIP1559 {
  return {
    type: "eip1559",
    chainId: tx.chainId,
    to: tx.to,
    value: BigInt(tx.value),
    data: tx.data,
    gas: BigInt(tx.gas),
    nonce: tx.nonce,
    maxFeePerGas: BigInt(tx.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
  };
}

export class LocalAccountSigner implements TransactionSigner {
  async signTransaction(tx: PreparedTx, account: LocalAccount): Promise<Hex> {
    if (!account.signTransaction) throw new Error("Account cannot sign transactions.");
    return account.signTransaction(toSerializable(tx));
  }
  async signMessage(message: string | { raw: Hex }, account: LocalAccount): Promise<Hex> {
    return account.signMessage({ message });
  }
  async signTypedData(typedData: TypedDataDefinition, account: LocalAccount): Promise<Hex> {
    return account.signTypedData(typedData);
  }
}
