import { describe, expect, it } from "vitest";
import { parseEther, type Address } from "viem";
import type { PreparedTx, SimulationResult } from "@frame/types";
import { ETHEREUM_MAINNET_ID, ROBINHOOD_MAINNET_ID } from "@frame/config";
import { findToken, knownSpenderLabel, nativeToken } from "@frame/token-registry";
import { decodeTransaction } from "../src/decoder";
import { reviewTransaction } from "../src/reviewer";

const ME: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const LIFI: Address = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";
const ok: SimulationResult = { status: "success", method: "eth_call" };

function bridgeTx(value: bigint): PreparedTx {
  return { chainId: ETHEREUM_MAINNET_ID, from: ME, to: LIFI, value: value.toString(), data: `0xae327f3e${"00".repeat(64)}`, gas: "120000", nonce: 0, maxFeePerGas: "1000000000", maxPriorityFeePerGas: "100000000" };
}

describe("bridge review", () => {
  it("reads as a move to Robinhood Chain on the source network — no chain-mismatch alarm, LI.FI named", async () => {
    const tx = bridgeTx(parseEther("0.0004"));
    const r = await reviewTransaction({
      reviewId: "b1",
      walletChainId: ROBINHOOD_MAINNET_ID,
      prepared: tx,
      decoded: decodeTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value) }),
      simulation: ok,
      tokenLookup: (a) => (a === "native" ? nativeToken(ETHEREUM_MAINNET_ID) : findToken(ETHEREUM_MAINNET_ID, a)),
      spenderLabel: (a) => knownSpenderLabel(ETHEREUM_MAINNET_ID, a),
      nativeBalanceWei: parseEther("0.001"),
      meta: { kind: "bridge", provider: "LI.FI · AcrossV4", fromChain: "1", toChain: "4663", amountOut: "0.000423", eta: "~2 sec" },
    });
    expect(r.summary.title).toBe("Move 0.0004 ETH to Robinhood Chain");
    expect(r.summary.lines.map((l) => l.label)).toEqual(expect.arrayContaining(["Via", "Contract", "Network", "Arrives"]));
    expect(r.summary.lines.find((l) => l.label === "Contract")?.value).toContain("LI.FI Diamond");
    expect(r.summary.lines.find((l) => l.label === "Network")?.value).toBe("Ethereum");
    expect(r.summary.lines.find((l) => l.label === "Arrives")?.value).toBe("≈ 0.000423 ETH on Robinhood Chain · ~2 sec");
    const codes = r.risks.map((x) => x.code);
    expect(codes).not.toContain("CHAIN_MISMATCH");
    expect(codes).not.toContain("UNKNOWN_CONTRACT");
    expect(r.riskLevel).toBe("low");
    expect(r.changes[0]).toMatchObject({ symbol: "ETH", amount: "0.0004", direction: "out" });
  });

  it("still refuses to pretend the balance covers amount plus fee", async () => {
    const tx = bridgeTx(parseEther("0.0004"));
    const r = await reviewTransaction({
      reviewId: "b2",
      walletChainId: ROBINHOOD_MAINNET_ID,
      prepared: tx,
      decoded: decodeTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value) }),
      simulation: ok,
      tokenLookup: () => undefined,
      nativeBalanceWei: parseEther("0.0004"),
      meta: { kind: "bridge", toChain: "4663" },
    });
    expect(r.risks.find((x) => x.code === "LOW_GAS")?.level).toBe("high");
    expect(r.riskLevel).toBe("high");
  });

  it("a dApp transaction aimed at another chain is still flagged", async () => {
    const tx = bridgeTx(0n);
    const r = await reviewTransaction({
      reviewId: "b3",
      walletChainId: ROBINHOOD_MAINNET_ID,
      prepared: tx,
      decoded: decodeTransaction({ to: tx.to, data: tx.data, value: 0n }),
      simulation: ok,
      tokenLookup: () => undefined,
      origin: "https://dapp.example",
    });
    expect(r.risks.map((x) => x.code)).toContain("CHAIN_MISMATCH");
  });

  it("a wallet-initiated aggregator swap keeps its own headline", async () => {
    const tx = { ...bridgeTx(0n), chainId: ROBINHOOD_MAINNET_ID };
    const r = await reviewTransaction({
      reviewId: "s1",
      walletChainId: ROBINHOOD_MAINNET_ID,
      prepared: tx,
      decoded: decodeTransaction({ to: tx.to, data: tx.data, value: 0n }),
      simulation: ok,
      tokenLookup: () => undefined,
      spenderLabel: (a) => knownSpenderLabel(ROBINHOOD_MAINNET_ID, a),
      meta: { kind: "swap", label: "Swap USDG for NVDA" },
    });
    expect(r.summary.title).toBe("Swap USDG for NVDA");
    expect(r.summary.contractLabel).toContain("LI.FI");
  });
});
