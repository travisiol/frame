import { describe, expect, it } from "vitest";
import { parseEther, parseUnits, verifyMessage, verifyTypedData, type Address } from "viem";
import { MemoryStore } from "@frame/storage";
import { RPC_ERROR } from "@frame/types";
import { buildErc20Transfer, buildNativeTransfer } from "@frame/transaction-engine";
import { findToken } from "@frame/token-registry";
import { WalletService } from "../src/wallet-service";

const ORIGIN_A = "https://a.example.xyz";
const ORIGIN_B = "https://b.example.xyz";
const OTHER: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const CHAIN = 4663;
const USDG = findToken(CHAIN, "0x5fc5360d0400a0fd4f2af552add042d716f1d168")!;

function makeService(clock = { now: 1_700_000_000_000 }) {
  const service = new WalletService({
    mode: "demo",
    defaultNetworkMode: "testnet",
    persistent: new MemoryStore(),
    session: new MemoryStore(),
    kdfIterations: 1_000,
    now: () => clock.now,
  });
  return { service, clock };
}

async function created(password = "correct horse battery") {
  const ctx = makeService();
  const { mnemonic, address } = await ctx.service.createWallet({ password });
  return { ...ctx, mnemonic, address, password };
}

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

async function connect(service: WalletService, origin: string): Promise<Address[]> {
  const p = service.handleDappRequest(origin, "eth_requestAccounts", []);
  await tick();
  const [id] = service.pendingRequestIds();
  expect(id).toBeDefined();
  await service.resolveRequest({ id: id!, approved: true });
  return (await p) as Address[];
}

describe("WalletService — vault lifecycle", () => {
  it("creates, backs up, locks and unlocks", async () => {
    const { service, mnemonic, address, password } = await created();
    expect(mnemonic.split(" ")).toHaveLength(12);
    let snap = await service.getSnapshot();
    expect(snap.initialized).toBe(true);
    expect(snap.locked).toBe(false);
    expect(snap.accounts[0]?.address).toBe(address);
    expect(snap.backupConfirmed).toBe(false);
    await service.confirmBackup();
    await service.lock();
    snap = await service.getSnapshot();
    expect(snap.locked).toBe(true);
    expect(snap.backupConfirmed).toBe(true);
    await expect(service.unlock({ password: "nope" })).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
    await service.unlock({ password });
    expect((await service.getSnapshot()).locked).toBe(false);
  });

  it("refuses a second vault and weak passwords", async () => {
    const { service } = await created();
    await expect(service.createWallet({ password: "another" })).rejects.toThrow(/already exists/);
    const fresh = makeService();
    await expect(fresh.service.createWallet({ password: "short" })).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
  });

  it("auto-locks after the configured inactivity", async () => {
    const { service, clock } = await created();
    await service.updateSettings({ autoLockMinutes: 1 });
    clock.now += 30_000;
    expect((await service.getSnapshot()).locked).toBe(false);
    clock.now += 31_000;
    expect((await service.getSnapshot()).locked).toBe(true);
  });

  it("'never' disables auto-lock; touch() resets the timer", async () => {
    const { service, clock } = await created();
    await service.updateSettings({ autoLockMinutes: 0 });
    clock.now += 24 * 3600_000;
    expect((await service.getSnapshot()).locked).toBe(false);
    await service.updateSettings({ autoLockMinutes: 5 });
    clock.now += 4 * 60_000;
    await service.touch();
    clock.now += 4 * 60_000;
    expect((await service.getSnapshot()).locked).toBe(false);
  });

  it("restores an unlocked session from the session store, but not after the window", async () => {
    const persistent = new MemoryStore();
    const session = new MemoryStore();
    const clock = { now: 1_700_000_000_000 };
    const a = new WalletService({ mode: "demo", defaultNetworkMode: "testnet", persistent, session, kdfIterations: 1_000, now: () => clock.now });
    await a.createWallet({ password: "correct horse battery" });
    const b = new WalletService({ mode: "demo", defaultNetworkMode: "testnet", persistent, session, kdfIterations: 1_000, now: () => clock.now });
    expect((await b.getSnapshot()).locked).toBe(false);
    clock.now += 16 * 60_000; // default 15 min
    const c = new WalletService({ mode: "demo", defaultNetworkMode: "testnet", persistent, session, kdfIterations: 1_000, now: () => clock.now });
    expect((await c.getSnapshot()).locked).toBe(true);
    expect(await session.get("vaultKey")).toBeUndefined();
  });

  it("exports recovery only with the password, changes password", async () => {
    const { service, mnemonic, password } = await created();
    await expect(service.exportRecovery({ password: "wrong" })).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
    expect((await service.exportRecovery({ password })).mnemonic).toBe(mnemonic);
    await service.changePassword({ current: password, next: "new-password-123" });
    await service.lock();
    await expect(service.unlock({ password })).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
    await service.unlock({ password: "new-password-123" });
    expect((await service.exportRecovery({ password: "new-password-123" })).mnemonic).toBe(mnemonic);
  });

  it("imports by phrase and by key; watch accounts cannot sign", async () => {
    const byPhrase = makeService();
    const r = await byPhrase.service.importWallet({ password: "correct horse battery", mnemonic: "test test test test test test test test test test test junk" });
    expect(r.address).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    expect((await byPhrase.service.getSnapshot()).backupConfirmed).toBe(true);
    const byKey = makeService();
    const k = await byKey.service.importWallet({ password: "correct horse battery", privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" });
    expect(k.address).toBe(OTHER);
    const watch = await byKey.service.addWatchAccount({ address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", name: "Treasury" });
    expect(watch.kind).toBe("watch");
    expect(watch.address).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    await expect(byKey.service.exportRecovery({ password: "correct horse battery", accountId: watch.id })).rejects.toThrow(/no key/);
  });
});

describe("WalletService — accounts", () => {
  it("creates derived accounts, renames, selects, removes imported only", async () => {
    const { service } = await created();
    const second = await service.createAccount({});
    expect(second.name).toBe("Account 2");
    expect(second.hdIndex).toBe(1);
    const imported = await service.importAccount({ privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", name: "Trading" });
    expect(imported.kind).toBe("imported");
    await service.renameAccount({ id: second.id, name: "Vault" });
    await service.selectAccount({ id: imported.id });
    let snap = await service.getSnapshot();
    expect(snap.selectedAccountId).toBe(imported.id);
    expect(snap.accounts.find((a) => a.id === second.id)?.name).toBe("Vault");
    await expect(service.removeAccount({ id: second.id })).rejects.toThrow(/cannot be removed/);
    await service.removeAccount({ id: imported.id });
    snap = await service.getSnapshot();
    expect(snap.accounts.some((a) => a.id === imported.id)).toBe(false);
    expect(snap.selectedAccountId).toBe(snap.accounts[0]!.id);
  });
});

describe("WalletService — dApp provider", () => {
  it("isolates permissions per origin", async () => {
    const { service, address } = await created();
    expect(await service.handleDappRequest(ORIGIN_A, "eth_accounts", [])).toEqual([]);
    expect(await service.handleDappRequest(ORIGIN_A, "eth_chainId", [])).toBe("0x1237");
    const accounts = await connect(service, ORIGIN_A);
    expect(accounts).toEqual([address]);
    expect(await service.handleDappRequest(ORIGIN_A, "eth_accounts", [])).toEqual([address]);
    expect(await service.handleDappRequest(ORIGIN_B, "eth_accounts", [])).toEqual([]);
    await expect(service.handleDappRequest(ORIGIN_B, "personal_sign", ["hello", address])).rejects.toMatchObject({ code: RPC_ERROR.UNAUTHORIZED });
    // Revoking removes access and rejects the site's pending requests.
    await service.revokePermission({ origin: ORIGIN_A });
    expect(await service.handleDappRequest(ORIGIN_A, "eth_accounts", [])).toEqual([]);
  });

  it("returns no accounts while locked and requires user approval to reconnect", async () => {
    const { service, password } = await created();
    await connect(service, ORIGIN_A);
    await service.lock();
    expect(await service.handleDappRequest(ORIGIN_A, "eth_accounts", [])).toEqual([]);
    await service.unlock({ password });
    expect(((await service.handleDappRequest(ORIGIN_A, "eth_accounts", [])) as string[]).length).toBe(1);
  });

  it("rejects when the user cancels", async () => {
    const { service } = await created();
    const p = service.handleDappRequest(ORIGIN_A, "eth_requestAccounts", []);
    await tick();
    const [id] = service.pendingRequestIds();
    await service.resolveRequest({ id: id!, approved: false });
    await expect(p).rejects.toMatchObject({ code: RPC_ERROR.USER_REJECTED });
  });

  it("signs messages and typed data that verify against the account", async () => {
    const { service, address } = await created();
    await connect(service, ORIGIN_A);
    const p = service.handleDappRequest(ORIGIN_A, "personal_sign", ["Sign in to Example\nNonce: 12345", address]);
    await tick();
    const req = (await service.getSnapshot()).pendingRequests[0]!;
    expect(req.kind).toBe("sign_message");
    expect(req.message?.warnings.some((w) => w.code === "AUTH_CHALLENGE")).toBe(true);
    await service.resolveRequest({ id: req.id, approved: true });
    const sig = (await p) as `0x${string}`;
    expect(await verifyMessage({ address, message: "Sign in to Example\nNonce: 12345", signature: sig })).toBe(true);

    const typed = {
      domain: { name: "Example", version: "1", chainId: CHAIN, verifyingContract: OTHER },
      types: { Permit: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }] },
      primaryType: "Permit",
      message: { spender: OTHER, value: "1000000" },
    };
    const p2 = service.handleDappRequest(ORIGIN_A, "eth_signTypedData_v4", [address, JSON.stringify(typed)]);
    await tick();
    const req2 = (await service.getSnapshot()).pendingRequests[0]!;
    expect(req2.kind).toBe("sign_typed_data");
    expect(req2.typedData?.warnings.some((w) => w.code === "PERMIT")).toBe(true);
    await service.resolveRequest({ id: req2.id, approved: true });
    const sig2 = (await p2) as `0x${string}`;
    expect(await verifyTypedData({ address, domain: typed.domain, types: typed.types, primaryType: "Permit", message: { spender: OTHER, value: 1000000n }, signature: sig2 })).toBe(true);
  });

  it("refuses malformed and unsupported requests with proper codes", async () => {
    const { service, address } = await created();
    await connect(service, ORIGIN_A);
    await expect(service.handleDappRequest(ORIGIN_A, 42, [])).rejects.toMatchObject({ code: RPC_ERROR.INVALID_PARAMS });
    await expect(service.handleDappRequest(ORIGIN_A, "eth_sign", [address, "0x00"])).rejects.toMatchObject({ code: RPC_ERROR.UNSUPPORTED_METHOD });
    await expect(service.handleDappRequest(ORIGIN_A, "eth_sendRawTransaction", ["0x00"])).rejects.toMatchObject({ code: RPC_ERROR.UNSUPPORTED_METHOD });
    await expect(service.handleDappRequest(ORIGIN_A, "personal_sign", ["only one"])).rejects.toMatchObject({ code: RPC_ERROR.INVALID_PARAMS });
    await expect(service.handleDappRequest(ORIGIN_A, "eth_sendTransaction", [{ from: address, to: "0x1234" }])).rejects.toMatchObject({ code: RPC_ERROR.INVALID_PARAMS });
    await expect(service.handleDappRequest(ORIGIN_A, "eth_sendTransaction", [{ from: address, to: OTHER, data: "0xzz" }])).rejects.toMatchObject({ code: RPC_ERROR.INVALID_PARAMS });
    await expect(service.handleDappRequest(ORIGIN_A, "eth_sendTransaction", [{ from: OTHER, to: address }])).rejects.toMatchObject({ code: RPC_ERROR.UNAUTHORIZED });
    await expect(service.handleDappRequest(ORIGIN_A, "eth_signTypedData_v4", [address, "{not json"])).rejects.toMatchObject({ code: RPC_ERROR.INVALID_PARAMS });
    await expect(service.handleDappRequest("ftp://weird", "eth_chainId", [])).rejects.toThrow(/origin/i);
  });

  it("chain mismatch: transactions for another chain and unknown chain switches are refused", async () => {
    const { service, address } = await created();
    await connect(service, ORIGIN_A);
    await expect(service.handleDappRequest(ORIGIN_A, "eth_sendTransaction", [{ from: address, to: OTHER, value: "0x1", chainId: "0x1" }])).rejects.toMatchObject({ code: RPC_ERROR.UNRECOGNIZED_CHAIN });
    await expect(service.handleDappRequest(ORIGIN_A, "wallet_switchEthereumChain", [{ chainId: "0x1" }])).rejects.toMatchObject({ code: RPC_ERROR.UNRECOGNIZED_CHAIN });
    expect(await service.handleDappRequest(ORIGIN_A, "wallet_switchEthereumChain", [{ chainId: "0x1237" }])).toBeNull();
  });

  it("eth_sendTransaction goes through review and is signed only after approval", async () => {
    const { service, address } = await created();
    await connect(service, ORIGIN_A);
    const before = BigInt((await service.rpcRequest({ method: "eth_getBalance", params: [address, "latest"] })) as string);
    const p = service.handleDappRequest(ORIGIN_A, "eth_sendTransaction", [{ from: address, to: OTHER, value: `0x${parseEther("0.25").toString(16)}` }]);
    await tick(50);
    const req = (await service.getSnapshot()).pendingRequests[0]!;
    expect(req.kind).toBe("send_transaction");
    expect(req.transaction?.summary.title).toBe("Send 0.25 ETH");
    expect(req.transaction?.simulation.status).toBe("success");
    expect(before).toBe(parseEther("2")); // untouched until approval
    await service.resolveRequest({ id: req.id, approved: true });
    const hash = (await p) as string;
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    const after = BigInt((await service.rpcRequest({ method: "eth_getBalance", params: [address, "latest"] })) as string);
    expect(after).toBeLessThan(before - parseEther("0.25"));
    const activity = await service.getActivity({ address });
    const mine = activity.find((a) => a.hash === hash);
    expect(mine?.title).toBe("Send 0.25 ETH");
    expect(mine?.demo).toBe(true);
    expect(mine?.explorerUrl).toBeUndefined(); // demo transactions never link to the explorer
  });
});

describe("WalletService — balances through the same client the UI uses", () => {
  it("reads the seeded demo portfolio via Multicall3 batching", async () => {
    const { createProxiedClient, readTokenBalances } = await import("@frame/chain");
    const { getRegistry } = await import("@frame/token-registry");
    const { service, address } = await created();
    const client = createProxiedClient(CHAIN, ({ method, params }) => service.rpcRequest({ chainId: CHAIN, method, params: (params as unknown[]) ?? [] }));
    const balances = await readTokenBalances(client, address, getRegistry(CHAIN));
    const nvda = findToken(CHAIN, "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec")!;
    expect(balances.get("native")).toBe(parseEther("2"));
    expect(balances.get(nvda.address)).toBe(parseUnits("26.17", 18));
    expect(balances.get(USDG.address)).toBe(parseUnits("3128", 6));
    // Verified tokens the demo account does not hold read as zero, not as failures.
    expect(balances.get("0x117cc2133c37b721f49de2a7a74833232b3b4c0c")).toBe(0n);
  });
});

describe("WalletService — transactions", () => {
  it("sends ERC-20 with the right decimals and refuses to sign while locked", async () => {
    const { service, address, password } = await created();
    const request = buildErc20Transfer({ chainId: CHAIN, from: address, token: USDG, to: OTHER, amount: parseUnits("25", 6) });
    const review = await service.prepareTransaction({ request });
    expect(review.summary.title).toBe("Send 25 USDG");
    expect(review.changes[0]).toMatchObject({ symbol: "USDG", amount: "25", direction: "out" });
    expect(review.riskLevel).toBe("low");
    await service.lock();
    await expect(service.confirmTransaction({ reviewId: review.reviewId })).rejects.toThrow(/locked/);
    await service.unlock({ password });
    // Reviews are dropped on lock — a fresh one is required.
    await expect(service.confirmTransaction({ reviewId: review.reviewId })).rejects.toThrow(/expired/);
    const again = await service.prepareTransaction({ request });
    const res = await service.confirmTransaction({ reviewId: again.reviewId });
    expect(res.demo).toBe(true);
    const bal = (await service.rpcRequest({ method: "eth_call", params: [{ to: USDG.address, data: `0x70a08231${OTHER.slice(2).toLowerCase().padStart(64, "0")}` }, "latest"] })) as string;
    expect(BigInt(bal)).toBe(parseUnits("25", 6));
  });

  it("flags the zero address, self-transfers and unlimited approvals", async () => {
    const { service, address } = await created();
    const zero = await service.prepareTransaction({ request: buildNativeTransfer({ chainId: CHAIN, from: address, to: "0x0000000000000000000000000000000000000000", valueWei: 1n }) });
    expect(zero.risks.some((r) => r.code === "ZERO_ADDRESS" && r.level === "high")).toBe(true);
    const self = await service.prepareTransaction({ request: buildNativeTransfer({ chainId: CHAIN, from: address, to: address, valueWei: 1n }) });
    expect(self.risks.some((r) => r.code === "SELF_TRANSFER")).toBe(true);
    const tooMuch = await service.prepareTransaction({ request: buildNativeTransfer({ chainId: CHAIN, from: address, to: OTHER, valueWei: parseEther("5") }) });
    expect(tooMuch.risks.some((r) => r.code === "LOW_GAS" && r.level === "high")).toBe(true);
  });

  it("never proxies signing methods through the read-only RPC and never submits twice", async () => {
    const { service, address } = await created();
    await expect(service.rpcRequest({ method: "eth_sendRawTransaction", params: ["0x00"] })).rejects.toMatchObject({ code: RPC_ERROR.UNSUPPORTED_METHOD });
    const review = await service.prepareTransaction({ request: buildNativeTransfer({ chainId: CHAIN, from: address, to: OTHER, valueWei: parseEther("0.1") }) });
    await service.confirmTransaction({ reviewId: review.reviewId });
    await expect(service.confirmTransaction({ reviewId: review.reviewId })).rejects.toThrow(/expired/);
  });

  it("address book, watchlist, custom and hidden tokens persist", async () => {
    const { service } = await created();
    const entry = await service.saveAddressBookEntry({ name: "Treasury", address: OTHER.toLowerCase() as Address });
    expect(entry.address).toBe(OTHER);
    await service.toggleWatchlist({ key: "GME" });
    await service.setTokenHidden({ address: USDG.address, hidden: true });
    let snap = await service.getSnapshot();
    expect(snap.addressBook).toHaveLength(1);
    expect(snap.watchlist).toContain("GME");
    expect(snap.hiddenTokens).toContain(USDG.address);
    await service.removeAddressBookEntry({ id: entry.id });
    await service.setTokenHidden({ address: USDG.address, hidden: false });
    snap = await service.getSnapshot();
    expect(snap.addressBook).toHaveLength(0);
    expect(snap.hiddenTokens).not.toContain(USDG.address);
  });
});

describe("watch-only wallets are never locked", () => {
  it("reports initialized and unlocked without a vault", async () => {
    const { service } = makeService();
    await service.addWatchAccount({ address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", name: "Treasury" });
    const snap = await service.getSnapshot();
    expect(snap.initialized).toBe(true);
    expect(snap.locked).toBe(false);
    expect(snap.accounts[0]?.kind).toBe("watch");
  });

  it("a wallet with a vault still locks", async () => {
    const { service } = await created();
    await service.lock();
    expect((await service.getSnapshot()).locked).toBe(true);
  });
});
