import { describe, expect, it } from "vitest";
import { GLOBAL_KNOWN_CONTRACTS, knownSpenderLabel } from "../src";

describe("contracts known on every chain", () => {
  it("labels LI.FI's Diamond on any chain, by exact address only", () => {
    expect(knownSpenderLabel(1, "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE")).toContain("LI.FI");
    expect(knownSpenderLabel(4663, "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae")).toContain("LI.FI");
    expect(knownSpenderLabel(42161, "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae")).toContain("LI.FI");
    // one nibble off is a different contract
    expect(knownSpenderLabel(4663, "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eaf")).toBeUndefined();
  });

  it("keeps chain-specific spenders and never invents a label", () => {
    expect(knownSpenderLabel(4663, "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e")).toBe("Pons V2 Factory");
    expect(knownSpenderLabel(1, "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e")).toBeUndefined();
    for (const address of Object.keys(GLOBAL_KNOWN_CONTRACTS)) expect(address).toBe(address.toLowerCase());
  });
});
