import { describe, expect, it } from "vitest";
import { encodeFunctionData, maxUint256, parseAbi, parseEther, parseUnits } from "viem";
import { encodeApprove, encodeTransfer } from "@frame/chain";
import { decodeTransaction } from "../src/decoder";

const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as const;
const NVDA = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec" as const;
const ROUTER = "0xf84876f12a9a11750db9c80dfa1c5e600c7b0e3c" as const;
const ME = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
const TO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

describe("decodeTransaction", () => {
  it("native transfer", () => {
    const d = decodeTransaction({ to: TO, data: "0x", value: parseEther("0.5") });
    expect(d.intent).toBe("native_transfer");
    expect(d.recipient).toBe(TO);
    expect(d.amount).toBe(parseEther("0.5"));
  });

  it("erc20 transfer with 6-decimal amounts intact", () => {
    const d = decodeTransaction({ to: USDG, data: encodeTransfer(TO, parseUnits("25", 6)) });
    expect(d.intent).toBe("erc20_transfer");
    expect(d.token).toBe(USDG);
    expect(d.recipient).toBe(TO.toLowerCase()); // normalised like the registry
    expect(d.amount).toBe(25_000_000n);
  });

  it("distinguishes exact and unlimited approvals", () => {
    const exact = decodeTransaction({ to: USDG, data: encodeApprove(ROUTER, parseUnits("500", 6)) });
    expect(exact.intent).toBe("approve");
    expect(exact.spender).toBe(ROUTER);
    expect(exact.unlimited).toBe(false);
    const unlimited = decodeTransaction({ to: USDG, data: encodeApprove(ROUTER, maxUint256) });
    expect(unlimited.unlimited).toBe(true);
    const permit2Style = decodeTransaction({ to: USDG, data: encodeApprove(ROUTER, (1n << 160n) - 1n) });
    expect(permit2Style.unlimited).toBe(true);
  });

  it("recognises a Uniswap-v2 style swap", () => {
    const abi = parseAbi(["function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)"]);
    const data = encodeFunctionData({ abi, functionName: "swapExactTokensForTokens", args: [parseUnits("500", 6), parseUnits("2.71", 18), [USDG, NVDA], ME, 9999999999n] });
    const d = decodeTransaction({ to: ROUTER, data });
    expect(d.intent).toBe("swap");
    expect(d.swap).toMatchObject({ router: ROUTER, tokenIn: USDG, tokenOut: NVDA, amountIn: parseUnits("500", 6), amountOutMin: parseUnits("2.71", 18) });
    expect(d.args?.path?.toLowerCase()).toContain(USDG); // args keep viem's checksummed form for the developer panel
  });

  it("ETH-in swaps read the amount from value", () => {
    const abi = parseAbi(["function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)"]);
    const data = encodeFunctionData({ abi, functionName: "swapExactETHForTokens", args: [1n, [ROUTER, NVDA], ME, 9999999999n] });
    const d = decodeTransaction({ to: ROUTER, data, value: parseEther("1") });
    expect(d.swap?.tokenIn).toBe("native");
    expect(d.swap?.amountIn).toBe(parseEther("1"));
    expect(d.swap?.tokenOut).toBe(NVDA);
  });

  it("falls back to a generic contract call for unknown selectors, and to deploy without `to`", () => {
    const unknown = decodeTransaction({ to: ROUTER, data: "0xdeadbeef0000" });
    expect(unknown.intent).toBe("contract_call");
    expect(unknown.selector).toBe("0xdeadbeef");
    expect(decodeTransaction({ data: "0x6080604052" }).intent).toBe("contract_deploy");
  });
});
