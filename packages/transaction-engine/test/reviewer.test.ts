import { describe, expect, it } from "vitest";
import { maxUint256, parseEther, parseUnits, type Address } from "viem";
import type { PreparedTx, SimulationResult } from "@frame/types";
import { encodeApprove, encodeTransfer } from "@frame/chain";
import { findToken, nativeToken } from "@frame/token-registry";
import { decodeTransaction } from "../src/decoder";
import { reviewTransaction } from "../src/reviewer";

const CHAIN = 4663;
const ME: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const TO: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ROUTER: Address = "0xf84876f12a9a11750db9c80dfa1c5e600c7b0e3c";
const USDG = findToken(CHAIN, "0x5fc5360d0400a0fd4f2af552add042d716f1d168")!;
const ok: SimulationResult = { status: "success", method: "eth_call" };

function prepared(p: Partial<PreparedTx>): PreparedTx {
  return { chainId: CHAIN, from: ME, to: TO, value: "0", data: "0x", gas: "21000", nonce: 0, maxFeePerGas: "100000000", maxPriorityFeePerGas: "1000000", ...p };
}

async function review(tx: PreparedTx, extra: Partial<Parameters<typeof reviewTransaction>[0]> = {}) {
  return reviewTransaction({
    reviewId: "r1",
    walletChainId: CHAIN,
    prepared: tx,
    decoded: decodeTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value) }),
    simulation: ok,
    tokenLookup: (a) => (a === "native" ? nativeToken(CHAIN) : findToken(CHAIN, a)),
    spenderLabel: (a) => (a.toLowerCase() === ROUTER ? "Example Router" : undefined),
    ...extra,
  });
}

describe("reviewTransaction", () => {
  it("summarises a native send with fee in ETH, and USD when a price is known", async () => {
    const r = await review(prepared({ value: parseEther("1").toString() }), { ethPriceUsd: 2000 });
    expect(r.summary.title).toBe("Send 1 ETH");
    expect(r.changes[0]).toMatchObject({ symbol: "ETH", amount: "1", direction: "out", usd: 2000 });
    expect(r.fee.eth).toBe("0.0000021");
    expect(r.fee.usd).toBeCloseTo(0.0042, 6);
    expect(r.riskLevel).toBe("low");
  });

  it("names the recipient from the address book", async () => {
    const r = await review(prepared({ value: "1" }), { addressLabel: (a) => (a === TO ? "Treasury" : undefined) });
    expect(r.summary.lines[0]?.value).toContain("Treasury");
  });

  it("flags unlimited approvals as high risk and exact approvals as low", async () => {
    const unlimited = await review(prepared({ to: USDG.address as Address, data: encodeApprove(ROUTER, maxUint256), gas: "46000" }), { currentAllowance: 0n });
    expect(unlimited.summary.title).toBe("Allow unlimited USDG spending");
    expect(unlimited.approvals[0]).toMatchObject({ unlimited: true, amount: "Unlimited", spenderLabel: "Example Router", current: "0" });
    expect(unlimited.riskLevel).toBe("high");
    expect(unlimited.risks.map((x) => x.code)).toContain("UNLIMITED_TOKEN_APPROVAL");

    const exact = await review(prepared({ to: USDG.address as Address, data: encodeApprove(ROUTER, parseUnits("500", 6)), gas: "46000" }));
    expect(exact.summary.title).toBe("Allow 500 USDG spending");
    expect(exact.riskLevel).toBe("low");
  });

  it("a zero approval reads as a revoke and an unlimited current allowance reads as Unlimited", async () => {
    const r = await review(prepared({ to: USDG.address as Address, data: encodeApprove(ROUTER, 0n), gas: "46000" }), { currentAllowance: maxUint256 });
    expect(r.summary.title).toBe("Revoke USDG spending permission");
    expect(r.summary.lines.find((l) => l.label === "Amount")?.value).toBe("0 USDG (permission removed)");
    expect(r.approvals[0]).toMatchObject({ amount: "0", unlimited: false, current: "Unlimited" });
    expect(r.riskLevel).toBe("low");
  });

  it("flags unknown spenders and unverified tokens as caution", async () => {
    const unknownToken: Address = "0x1111111111111111111111111111111111111111";
    const r = await review(prepared({ to: unknownToken, data: encodeApprove(TO, 5n), gas: "46000" }), {
      unknownTokenLookup: async (a) => ({ chainId: CHAIN, address: a, symbol: "NVDA", name: "NVIDIA • Robinhood Token", decimals: 18, category: "unknown", verified: false }),
    });
    const codes = r.risks.map((x) => x.code);
    expect(codes).toContain("UNKNOWN_CONTRACT");
    expect(codes).toContain("UNVERIFIED_TOKEN");
    expect(r.riskLevel).toBe("caution");
    expect(r.risks.every((x) => !/scam|malicious/i.test(x.title))).toBe(true);
  });

  it("zero address, self transfer, contract recipient", async () => {
    const zero = await review(prepared({ to: "0x0000000000000000000000000000000000000000", value: "1" }));
    expect(zero.risks.map((x) => x.code)).toContain("ZERO_ADDRESS");
    expect(zero.riskLevel).toBe("high");
    const self = await review(prepared({ to: ME, value: "1" }));
    expect(self.risks.map((x) => x.code)).toContain("SELF_TRANSFER");
    const contract = await review(prepared({ to: TO, data: encodeTransfer(TO, 1n) }), { isContract: async () => true });
    expect(contract.risks.map((x) => x.code)).toContain("SEND_TO_CONTRACT");
  });

  it("failed or missing simulation is surfaced", async () => {
    const reverted = await review(prepared({ value: "1" }), { simulation: { status: "reverted", method: "eth_call", revertReason: "nope" } });
    expect(reverted.risks.find((x) => x.code === "FAILED_SIMULATION")?.detail).toContain("nope");
    expect(reverted.riskLevel).toBe("high");
    const none = await review(prepared({ value: "1" }), { simulation: { status: "unavailable", method: "none" } });
    expect(none.risks.map((x) => x.code)).toContain("SIMULATION_UNAVAILABLE");
  });

  it("low gas: high when the balance cannot cover value + fee, caution below the threshold", async () => {
    const broke = await review(prepared({ value: parseEther("1").toString() }), { nativeBalanceWei: parseEther("0.5") });
    expect(broke.risks.find((x) => x.code === "LOW_GAS")?.level).toBe("high");
    const thin = await review(prepared({ value: parseEther("0.999").toString() }), { nativeBalanceWei: parseEther("1"), lowGasThresholdEth: "0.01" });
    expect(thin.risks.find((x) => x.code === "LOW_GAS")?.level).toBe("caution");
  });

  it("chain mismatch between the prepared tx and the wallet is high risk", async () => {
    const r = await review(prepared({ chainId: 1, value: "1" }));
    expect(r.risks.map((x) => x.code)).toContain("CHAIN_MISMATCH");
    expect(r.riskLevel).toBe("high");
  });
});
