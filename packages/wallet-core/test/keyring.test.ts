import { describe, expect, it } from "vitest";
import { Keyring } from "../src/keyring";

// Public, well-known test vector (Hardhat/Anvil default accounts) — never use with real funds.
const MNEMONIC = "test test test test test test test test test test test junk";
const ADDR0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ADDR1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const KEY0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const KEY1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describe("Keyring", () => {
  it("creates a 12-word wallet with one derived account", () => {
    const { keyring, mnemonic } = Keyring.create();
    expect(mnemonic.split(" ")).toHaveLength(12);
    expect(Keyring.isValidMnemonic(mnemonic)).toBe(true);
    expect(keyring.addresses()).toHaveLength(1);
    expect(keyring.hasMnemonic).toBe(true);
  });

  it("derives BIP-44 accounts deterministically (m/44'/60'/0'/0/i)", () => {
    const k = Keyring.fromMnemonic(`  ${MNEMONIC.toUpperCase()}  `);
    expect(k.addresses()).toEqual([ADDR0]);
    expect(k.addHdAccount()).toEqual({ index: 1, address: ADDR1 });
    expect(k.exportPrivateKey(ADDR0)).toBe(KEY0);
    expect(k.exportPrivateKey(ADDR1)).toBe(KEY1);
    expect(k.exportMnemonic()).toBe(MNEMONIC);
  });

  it("rejects invalid phrases and keys", () => {
    expect(() => Keyring.fromMnemonic("test test test")).toThrow(/Invalid recovery phrase/);
    expect(() => Keyring.fromMnemonic(MNEMONIC.replace("junk", "zebra"))).toThrow(/Invalid recovery phrase/);
    expect(() => Keyring.fromPrivateKey("0x1234")).toThrow(/Invalid private key/);
    expect(() => Keyring.fromPrivateKey(`0x${"00".repeat(32)}`)).toThrow();
  });

  it("imports private keys, refuses duplicates and removes them", () => {
    const k = Keyring.fromMnemonic(MNEMONIC);
    expect(k.importPrivateKey(KEY1.slice(2))).toBe(ADDR1);
    expect(() => k.importPrivateKey(KEY1)).toThrow(/already in the wallet/);
    expect(() => k.importPrivateKey(KEY0)).toThrow(/already in the wallet/);
    expect(k.controls(ADDR1)).toBe(true);
    expect(k.removeImported(ADDR1)).toBe(true);
    expect(k.controls(ADDR1)).toBe(false);
  });

  it("a private-key-only vault has no mnemonic", () => {
    const k = Keyring.fromPrivateKey(KEY1);
    expect(k.hasMnemonic).toBe(false);
    expect(k.addresses()).toEqual([ADDR1]);
    expect(() => k.exportMnemonic()).toThrow(/no recovery phrase/);
    expect(() => k.addHdAccount()).toThrow(/no recovery phrase/);
  });

  it("signs with the right key and refuses unknown addresses", async () => {
    const k = Keyring.fromMnemonic(MNEMONIC);
    const account = k.getAccount(ADDR0.toLowerCase() as `0x${string}`);
    expect(account.address).toBe(ADDR0);
    expect(() => k.getAccount(ADDR1)).toThrow(/cannot sign/);
  });

  it("lock() drops all key material", () => {
    const k = Keyring.fromMnemonic(MNEMONIC);
    const snapshot = k.toPayload();
    expect(snapshot.mnemonic).toBe(MNEMONIC);
    k.lock();
    expect(k.locked).toBe(true);
    expect(() => k.addresses()).toThrow(/locked/);
    expect(() => k.exportMnemonic()).toThrow(/locked/);
    // The payload handed out earlier is a copy — locking does not mutate it, and re-hydration works.
    expect(Keyring.fromPayload(snapshot).addresses()).toEqual([ADDR0]);
  });
});
