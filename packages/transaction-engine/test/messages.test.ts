import { describe, expect, it } from "vitest";
import { stringToHex } from "viem";
import { analyzeMessageSignRequest, analyzeTypedDataRequest, splitPersonalSignParams, splitTypedDataParams } from "../src/messages";
import { humanizeError } from "../src/errors";

const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("personal_sign analysis", () => {
  it("accepts both parameter orders", () => {
    expect(splitPersonalSignParams(["hello", ADDR])).toEqual({ message: "hello", address: ADDR });
    expect(splitPersonalSignParams([ADDR, "hello"])).toEqual({ message: "hello", address: ADDR });
    expect(splitPersonalSignParams(["hello"])).toBeNull();
  });

  it("decodes hex messages and keeps raw bytes when unreadable", () => {
    const readable = analyzeMessageSignRequest(stringToHex("Welcome to Example"));
    expect(readable.text).toBe("Welcome to Example");
    expect(readable.warnings).toHaveLength(0);
    const raw = analyzeMessageSignRequest("0x00ff10");
    expect(raw.warnings.some((w) => w.code === "UNREADABLE")).toBe(true);
    expect(raw.hex).toBe("0x00ff10");
  });

  it("warns about sign-in challenges and approval-like text", () => {
    const siwe = analyzeMessageSignRequest("example.xyz wants you to sign in with your Ethereum account:\n0x…\n\nNonce: abc\nIssued At: 2026-09-20");
    expect(siwe.warnings.map((w) => w.code)).toContain("AUTH_CHALLENGE");
    const approval = analyzeMessageSignRequest("Approve spender 0x… for unlimited allowance");
    expect(approval.warnings.map((w) => w.code)).toContain("APPROVAL_LIKE");
  });
});

describe("eth_signTypedData_v4 analysis", () => {
  const typed = {
    domain: { name: "USDG", version: "1", chainId: 4663, verifyingContract: "0x5fc5360d0400a0fd4f2af552add042d716f1d168" },
    types: {
      EIP712Domain: [{ name: "name", type: "string" }],
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: { owner: ADDR, spender: "0xf84876f12a9a11750db9c80dfa1c5e600c7b0e3c", value: "115792089237316195423570985008687907853269984665640564039457584007913129639935" },
  };

  it("splits params and flags permits", () => {
    expect(splitTypedDataParams([ADDR, typed])?.address).toBe(ADDR);
    const a = analyzeTypedDataRequest(JSON.stringify(typed), 4663);
    expect(a.primaryType).toBe("Permit");
    expect(a.warnings.map((w) => w.code)).toContain("PERMIT");
    expect(a.warnings.some((w) => w.title.includes("chain"))).toBe(false);
  });

  it("flags a domain chain id that differs from the wallet chain", () => {
    const a = analyzeTypedDataRequest({ ...typed, domain: { ...typed.domain, chainId: 1 } }, 4663);
    expect(a.warnings.some((w) => w.title.includes("For chain 1"))).toBe(true);
  });

  it("rejects malformed typed data", () => {
    expect(() => analyzeTypedDataRequest("{", 4663)).toThrow(/JSON/);
    expect(() => analyzeTypedDataRequest({ message: {} }, 4663)).toThrow(/missing/);
  });
});

describe("humanizeError", () => {
  it("translates node errors into consumer language", () => {
    expect(humanizeError(new Error("insufficient funds for intrinsic transaction cost")).title).toBe("NOT ENOUGH ETH FOR GAS");
    expect(humanizeError(new Error("execution reverted: ERC20: transfer amount exceeds balance")).title).toBe("NOT ENOUGH BALANCE");
    expect(humanizeError(new Error("execution reverted")).title).toBe("TRANSACTION FAILED");
    expect(humanizeError(new Error("nonce too low")).code).toBe("NONCE");
    expect(humanizeError(new Error("HTTP request failed: 429 Too Many Requests")).code).toBe("RATE_LIMIT");
    expect(humanizeError(Object.assign(new Error("User rejected"), { code: 4001 })).code).toBe("USER_REJECTED");
    expect(humanizeError(Object.assign(new Error("Incorrect password."), { name: "VaultError", code: "INVALID_PASSWORD" })).code).toBe("INVALID_PASSWORD");
  });

  it("never echoes secret-looking material in technical details", () => {
    const h = humanizeError(new Error(`bad key 0x${"ab".repeat(32)}`));
    expect(h.technical).not.toContain("abab");
  });
});
