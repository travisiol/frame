import { describe, expect, it } from "vitest";
import { MemoryStore } from "@frame/storage";
import { Keyring } from "../src/keyring";
import { WalletService } from "../src/wallet-service";

// Public, well-known test vectors — never use with real funds.
const A = "test test test test test test test test test test test junk";
const A_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const B = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const B_ADDR = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const PASSWORD = "correct horse battery";

function service(persistent = new MemoryStore()) {
  return new WalletService({ mode: "demo", defaultNetworkMode: "testnet", persistent, session: new MemoryStore(), kdfIterations: 1_000 });
}

describe("recovery phrase preview", () => {
  it("normalises what people paste — numbering, commas, capitals, accents, line breaks", () => {
    const p = Keyring.previewMnemonic("1. Test\n2. TEST, 3. tést\n4 test 5 test 6 test 7 test 8 test 9 test 10 test 11 test 12 junk");
    expect(p.valid).toBe(true);
    expect(p.wordCount).toBe(12);
    expect(p.address).toBe(A_ADDR);
    expect(p.invalidWords).toEqual([]);
  });

  it("names words that are not in the list, and tells a checksum failure apart", () => {
    const bad = Keyring.previewMnemonic("test test test test test test test test test test test hous");
    expect(bad.valid).toBe(false);
    expect(bad.invalidWords).toEqual([{ position: 12, word: "hous" }]);
    expect(bad.checksumFailed).toBe(false);

    const order = Keyring.previewMnemonic("test test test test test test test test test test test test");
    expect(order.valid).toBe(false);
    expect(order.invalidWords).toEqual([]);
    expect(order.checksumFailed).toBe(true);

    expect(Keyring.previewMnemonic("test test").wordCount).toBe(2);
    expect(Keyring.previewMnemonic("").wordCount).toBe(0);
  });
});

describe("several recovery phrases in one vault", () => {
  it("adds a second phrase to an unlocked wallet, derives from it, exports it, and survives a restart", async () => {
    const persistent = new MemoryStore();
    const s1 = service(persistent);
    await s1.importWallet({ password: PASSWORD, mnemonic: A });
    const added = await s1.importPhrase({ mnemonic: B, name: "Old wallet" });
    expect(added).toMatchObject({ address: B_ADDR, kind: "hd", hdIndex: 0, phrase: 1, name: "Old wallet" });
    expect((await s1.getSnapshot()).phraseCount).toBe(2);
    await expect(s1.importPhrase({ mnemonic: B })).rejects.toThrow(/already/);

    const second = await s1.createAccount({ name: "Old wallet 2", phrase: 1 });
    expect(second).toMatchObject({ phrase: 1, hdIndex: 1 });
    expect(await s1.exportRecovery({ password: PASSWORD, phrase: 1 })).toEqual({ mnemonic: B });
    expect(await s1.exportRecovery({ password: PASSWORD })).toEqual({ mnemonic: A });
    expect((await s1.exportRecovery({ password: PASSWORD, accountId: added.id })).privateKey).toMatch(/^0x[0-9a-f]{64}$/);

    const s2 = service(persistent);
    await s2.unlock({ password: PASSWORD });
    const snap = await s2.getSnapshot();
    expect(snap.accounts.map((a) => a.address)).toEqual([A_ADDR, B_ADDR, second.address]);
    expect(snap.phraseCount).toBe(2);
    expect(await s2.exportRecovery({ password: PASSWORD, phrase: 1 })).toEqual({ mnemonic: B });
  });

  it("previews against the wallet: a phrase already inside is flagged", async () => {
    const s = service();
    await s.importWallet({ password: PASSWORD, mnemonic: A });
    expect((await s.previewMnemonic({ mnemonic: A })).alreadyInWallet).toBe(true);
    expect((await s.previewMnemonic({ mnemonic: B })).alreadyInWallet).toBe(false);
  });

  it("a wallet made from a private key adopts the first imported phrase as its own", async () => {
    const s = service();
    await s.importWallet({ password: PASSWORD, privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" });
    expect((await s.getSnapshot()).phraseCount).toBe(0);
    const acc = await s.importPhrase({ mnemonic: A });
    expect(acc.address).toBe(A_ADDR);
    expect(acc.phrase).toBeUndefined();
    expect((await s.getSnapshot()).phraseCount).toBe(1);
    expect(await s.exportRecovery({ password: PASSWORD })).toEqual({ mnemonic: A });
  });

  it("refuses to start over when a wallet exists, and says where to import instead", async () => {
    const s = service();
    await s.createWallet({ password: PASSWORD });
    await expect(s.importWallet({ password: PASSWORD, mnemonic: A })).rejects.toThrow(/Settings/);
  });
});
