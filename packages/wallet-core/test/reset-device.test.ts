import { describe, expect, it } from "vitest";
import { MemoryStore } from "@frame/storage";
import { WalletService } from "../src/wallet-service";

const PASSWORD = "correct horse battery";

function service(persistent = new MemoryStore(), session = new MemoryStore()) {
  return new WalletService({ mode: "demo", defaultNetworkMode: "testnet", persistent, session, kdfIterations: 1_000 });
}

describe("resetDevice — the \"forgot password\" escape hatch", () => {
  it("wipes the vault, accounts and settings so the app looks brand new", async () => {
    const persistent = new MemoryStore();
    const session = new MemoryStore();
    const s = service(persistent, session);
    await s.createWallet({ password: PASSWORD });
    await s.updateSettings({ notifications: false, onboardingComplete: true });
    await s.addWatchAccount({ address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", name: "Someone else" });
    const before = await s.getSnapshot();
    expect(before.initialized).toBe(true);
    expect(before.accounts).toHaveLength(2);

    await s.resetDevice();

    const after = await s.getSnapshot();
    expect(after.initialized).toBe(false);
    expect(after.locked).toBe(false); // nothing to unlock — same as a device that never had a wallet
    expect(after.accounts).toEqual([]);
    expect(after.settings.onboardingComplete).toBe(false);
    expect(after.phraseCount).toBe(0);
    expect(await persistent.get("vault")).toBeUndefined();
    expect(await session.get("vaultKey")).toBeUndefined();
  });

  it("locks out the old password afterwards — there is no way back in without a fresh create/import", async () => {
    const s = service();
    await s.createWallet({ password: PASSWORD });
    await s.resetDevice();
    await expect(s.unlock({ password: PASSWORD })).rejects.toThrow();
  });

  it("does not disturb a second device sharing the same recovery phrase (only this device's copy is wiped)", async () => {
    const deviceA = service();
    const { mnemonic } = await deviceA.createWallet({ password: PASSWORD });
    const deviceB = service(); // a separate persistent store, as if it were a different browser/device
    await deviceB.importWallet({ password: "another strong password", mnemonic });
    const addrB = (await deviceB.getSnapshot()).accounts[0]!.address;

    await deviceA.resetDevice();
    expect((await deviceA.getSnapshot()).initialized).toBe(false);
    // deviceB is untouched — the same recovery phrase still works there.
    expect((await deviceB.getSnapshot()).accounts[0]!.address).toBe(addrB);
  });

  it("rejects a pending dApp request instead of leaving it hanging", async () => {
    const s = service();
    await s.createWallet({ password: PASSWORD });
    const pending = s.handleDappRequest("https://dapp.example", "eth_requestAccounts", []).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 10));
    expect((await s.getSnapshot()).pendingRequests.length).toBeGreaterThan(0);
    await s.resetDevice();
    const err = await pending;
    expect(err).toBeInstanceOf(Error);
    expect((await s.getSnapshot()).pendingRequests).toEqual([]);
  });

  it("is exposed through the same allowlisted API surface as every other wallet action", async () => {
    const { WALLET_API_METHODS, isWalletApiMethod } = await import("../src/backend");
    expect(WALLET_API_METHODS).toContain("resetDevice");
    expect(isWalletApiMethod("resetDevice")).toBe(true);
  });
});
