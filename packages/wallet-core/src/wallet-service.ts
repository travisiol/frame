import { formatUnits, parseUnits, type PublicClient } from "viem";
import type {
  Account,
  ActivityItem,
  Address,
  AddressBookEntry,
  Allowance,
  AppMode,
  DappRequest,
  Hex,
  NetworkMode,
  Settings,
  TokenInfo,
  TxRequest,
  TxResult,
  TxReview,
  WalletEvent,
  WalletSnapshot,
} from "@frame/types";
import { RpcError } from "@frame/types";
import {
  BRAND,
  ROBINHOOD_MAINNET_ID,
  chainIdForNetworkMode,
  explorerTxUrl,
  isPrimaryChain,
  isSupportedChain,
  parseHexChainId,
  toHexChainId,
} from "@frame/config";
import type { KeyValueStore } from "@frame/storage";
import {
  DEFAULT_KDF_ITERATIONS,
  VaultError,
  changeVaultPassword,
  decryptVault,
  decryptVaultWithKey,
  encryptVault,
  encryptVaultWithKey,
  fromBase64,
  isEncryptedVaultBlob,
  toBase64,
  zeroize,
  type EncryptedVaultBlob,
} from "@frame/security";
import { checksum, createProxiedClient, formatTokenAmount, isUnlimitedAllowance, isValidAddress, probeRpc, readTokenMetadata, sameAddress, shortAddress } from "@frame/chain";
import { findToken, getRegistry, knownSpenderLabel, makeUnknownToken, nativeToken } from "@frame/token-registry";
import {
  EthCallSimulator,
  LocalAccountSigner,
  RpcBroadcaster,
  activityFromRecord,
  analyzeMessageSignRequest,
  analyzeTypedDataRequest,
  buildApprove,
  decodeTransaction,
  mergeActivity,
  prepareTransaction,
  reviewTransaction,
  splitPersonalSignParams,
  splitTypedDataParams,
  waitForReceipt,
  type LocalTxRecord,
} from "@frame/transaction-engine";
import type { MarketDataProvider } from "@frame/markets";
import { type WalletApi } from "./backend";
import { DemoChain, type ChainGateway } from "./demo-chain";
import { LiveChainGateway, fetchExplorerActivity, fetchExplorerTokenBalances, scanApprovals, scanTransferLogs } from "./gateway";
import { Keyring } from "./keyring";
import { PermissionStore, normalizeOrigin } from "./permissions";
import { RequestQueue, newId } from "./requests";

export interface WalletServiceOptions {
  mode: AppMode;
  defaultNetworkMode: NetworkMode;
  persistent: KeyValueStore;
  session: KeyValueStore;
  rpcEnv?: Partial<Record<number, string | undefined>>;
  /** Same-origin JSON-RPC relay per chain (web app only): ordered after the custom RPC, before the public endpoint. */
  rpcRelay?: Partial<Record<number, string | undefined>>;
  /** Lower only in tests. */
  kdfIterations?: number;
  now?: () => number;
  onEvent?: (event: WalletEvent) => void;
  /** Extension: opens the approval popup for a queued dApp request. */
  openApprovalUi?: (requestId: string) => void | Promise<void>;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Used to put USD values on reviews. Optional. */
  marketData?: MarketDataProvider;
}

const KEYS = {
  vault: "vault",
  accounts: "accounts",
  selected: "selectedAccountId",
  settings: "settings",
  backup: "backupConfirmed",
  addressBook: "addressBook",
  watchlist: "watchlist",
  hidden: "hiddenTokens",
  custom: "customTokens",
  localTx: "localTx",
} as const;

const SESSION = { key: "vaultKey", lastActivity: "lastActivityAt" } as const;

export const DEFAULT_SETTINGS: Settings = {
  autoLockMinutes: 15,
  networkMode: "testnet",
  currency: "USD",
  language: "en",
  telemetryOptIn: false,
  notifications: true,
  developerMode: false,
  showRawTransactionData: false,
  lowGasThresholdEth: "0.001",
  simulateBeforeSign: true,
  customRpc: {},
  previewWhenLocked: false,
  clearClipboardSeconds: 60,
  onboardingComplete: false,
};

interface StoredReview {
  review: TxReview;
  request: TxRequest;
}

/**
 * WalletService — platform-agnostic wallet core. Runs inside the extension
 * background service worker (persistent = chrome.storage.local, session =
 * chrome.storage.session) or in-process for the web demo.
 */
export class WalletService implements WalletApi {
  readonly mode: AppMode;
  private keyring: Keyring | null = null;
  private keyBits: Uint8Array | null = null;
  private settings: Settings;
  private accounts: Account[] = [];
  private selectedId: string | null = null;
  private backupConfirmed = false;
  private addressBook: AddressBookEntry[] = [];
  private watchlist: string[] = [];
  private hiddenTokens: string[] = [];
  private customTokens: TokenInfo[] = [];
  private localTx: LocalTxRecord[] = [];
  private readonly reviews = new Map<string, StoredReview>();
  private readonly queue = new RequestQueue();
  private readonly permissions: PermissionStore;
  private readonly gateway: ChainGateway;
  private readonly live: LiveChainGateway | null;
  readonly demo: DemoChain | null;
  private readonly signer = new LocalAccountSigner();
  private readonly simulator = new EthCallSimulator();
  private readonly broadcaster: RpcBroadcaster;
  private readonly clients = new Map<number, PublicClient>();
  private readonly now: () => number;
  private readonly kdfIterations: number;
  private initialized: Promise<void> | null = null;
  private readonly listeners = new Set<(e: WalletEvent) => void>();

  constructor(private readonly opts: WalletServiceOptions) {
    this.mode = opts.mode;
    this.now = opts.now ?? (() => Date.now());
    this.kdfIterations = opts.kdfIterations ?? DEFAULT_KDF_ITERATIONS;
    this.settings = { ...DEFAULT_SETTINGS, networkMode: opts.defaultNetworkMode };
    this.permissions = new PermissionStore(opts.persistent);
    if (opts.mode === "demo") {
      this.demo = new DemoChain((e) => this.emit(e));
      this.live = null;
      this.gateway = this.demo;
    } else {
      this.demo = null;
      this.live = new LiveChainGateway(() => ({ env: opts.rpcEnv, custom: this.settings.customRpc, relay: opts.rpcRelay }));
      this.gateway = this.live;
    }
    this.broadcaster = new RpcBroadcaster((chainId) => this.client(chainId));
    this.queue.onChange(() => this.emit({ type: "state" }));
  }

  // ---------------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------------

  /** Loads persisted state and restores an unlocked session if the auto-lock window has not elapsed. */
  init(): Promise<void> {
    if (!this.initialized) this.initialized = this.load();
    return this.initialized;
  }

  private async load(): Promise<void> {
    const s = this.opts.persistent;
    const settings = await s.get<Partial<Settings>>(KEYS.settings);
    this.settings = { ...DEFAULT_SETTINGS, networkMode: this.opts.defaultNetworkMode, ...(settings ?? {}) };
    this.accounts = (await s.get<Account[]>(KEYS.accounts)) ?? [];
    this.selectedId = (await s.get<string>(KEYS.selected)) ?? this.accounts[0]?.id ?? null;
    this.backupConfirmed = (await s.get<boolean>(KEYS.backup)) ?? false;
    this.addressBook = (await s.get<AddressBookEntry[]>(KEYS.addressBook)) ?? [];
    this.watchlist = (await s.get<string[]>(KEYS.watchlist)) ?? ["NVDA", "AAPL", "TSLA", "SPY"];
    this.hiddenTokens = (await s.get<string[]>(KEYS.hidden)) ?? [];
    this.customTokens = (await s.get<TokenInfo[]>(KEYS.custom)) ?? [];
    this.localTx = (await s.get<LocalTxRecord[]>(KEYS.localTx)) ?? [];
    await this.restoreSession();
    if (this.demo) for (const a of this.accounts) this.demo.seedAccount(a.address);
  }

  private async restoreSession(): Promise<void> {
    const vault = await this.opts.persistent.get<EncryptedVaultBlob>(KEYS.vault);
    const keyB64 = await this.opts.session.get<string>(SESSION.key);
    if (!vault || !keyB64) return;
    if (await this.autoLockElapsed()) {
      await this.clearSession();
      return;
    }
    try {
      const bits = fromBase64(keyB64);
      const payload = await decryptVaultWithKey(vault, bits);
      this.keyBits = bits;
      this.keyring = Keyring.fromPayload(payload);
    } catch {
      await this.clearSession();
    }
  }

  subscribe(listener: (event: WalletEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: WalletEvent) {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* listeners never break the service */
      }
    }
    this.opts.onEvent?.(event);
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  get chainId(): number {
    return this.mode === "demo" ? ROBINHOOD_MAINNET_ID : chainIdForNetworkMode(this.settings.networkMode);
  }

  get locked(): boolean {
    return this.keyring === null;
  }

  private client(chainId: number): PublicClient {
    let c = this.clients.get(chainId);
    if (!c) {
      c = createProxiedClient(chainId, ({ method, params }) => this.gateway.request(chainId, method, (params as unknown[]) ?? []));
      this.clients.set(chainId, c);
    }
    return c;
  }

  private async persist<T>(key: string, value: T): Promise<void> {
    await this.opts.persistent.set(key, value);
  }

  private async autoLockElapsed(): Promise<boolean> {
    const minutes = this.settings.autoLockMinutes;
    if (minutes === 0) return false;
    const last = (await this.opts.session.get<number>(SESSION.lastActivity)) ?? 0;
    return this.now() - last > minutes * 60_000;
  }

  private async clearSession(): Promise<void> {
    await this.opts.session.remove(SESSION.key);
    await this.opts.session.remove(SESSION.lastActivity);
  }

  /** Runs on every call: enforces auto-lock without needing a live timer. */
  async tick(): Promise<void> {
    await this.init();
    if (!this.locked && (await this.autoLockElapsed())) await this.lock();
  }

  private async ensureUnlocked(): Promise<Keyring> {
    await this.tick();
    if (!this.keyring) throw new Error("Wallet is locked.");
    await this.touch();
    return this.keyring;
  }

  private selectedAccount(): Account | null {
    return this.accounts.find((a) => a.id === this.selectedId) ?? this.accounts[0] ?? null;
  }

  private accountByAddress(address: string): Account | undefined {
    return this.accounts.find((a) => sameAddress(a.address, address));
  }

  private lookupToken(chainId: number, address: Address | "native"): TokenInfo | undefined {
    if (address === "native") return nativeToken(chainId);
    return findToken(chainId, address) ?? this.customTokens.find((t) => t.chainId === chainId && sameAddress(t.address, address));
  }

  private labelFor(address: Address): string | undefined {
    const book = this.addressBook.find((e) => sameAddress(e.address, address));
    if (book) return book.name;
    const acct = this.accountByAddress(address);
    if (acct) return acct.name;
    return knownSpenderLabel(this.chainId, address);
  }

  private async saveVaultFromKeyring(): Promise<void> {
    if (!this.keyring || !this.keyBits) throw new Error("Wallet is locked.");
    const existing = await this.opts.persistent.get<EncryptedVaultBlob>(KEYS.vault);
    if (!existing) throw new Error("Vault missing.");
    const blob = await encryptVaultWithKey(this.keyring.toPayload(), this.keyBits, existing.kdf, existing.createdAt);
    await this.persist(KEYS.vault, blob);
  }

  private async setSession(keyBits: Uint8Array): Promise<void> {
    await this.opts.session.set(SESSION.key, toBase64(keyBits));
    await this.opts.session.set(SESSION.lastActivity, this.now());
  }

  private nextAccountName(): string {
    if (this.accounts.length === 0) return "Main Wallet";
    let n = this.accounts.length + 1;
    while (this.accounts.some((a) => a.name === `Account ${n}`)) n++;
    return `Account ${n}`;
  }

  private async addAccount(partial: Omit<Account, "id" | "createdAt">): Promise<Account> {
    const account: Account = { ...partial, id: newId("acct"), createdAt: this.now() };
    this.accounts.push(account);
    await this.persist(KEYS.accounts, this.accounts);
    if (!this.selectedId) {
      this.selectedId = account.id;
      await this.persist(KEYS.selected, this.selectedId);
    }
    this.demo?.seedAccount(account.address);
    return account;
  }

  // ---------------------------------------------------------------------------
  // WalletApi: status
  // ---------------------------------------------------------------------------

  async getSnapshot(): Promise<WalletSnapshot> {
    await this.tick();
    const vault = await this.opts.persistent.get<EncryptedVaultBlob>(KEYS.vault);
    return {
      version: BRAND.version,
      mode: this.mode,
      initialized: isEncryptedVaultBlob(vault) || this.accounts.length > 0,
      // A watch-only wallet has no vault, so there is nothing to unlock: never show it a lock screen.
      locked: this.locked && isEncryptedVaultBlob(vault),
      chainId: this.chainId,
      networkMode: this.mode === "demo" ? "mainnet" : this.settings.networkMode,
      accounts: this.accounts,
      selectedAccountId: this.selectedAccount()?.id ?? null,
      settings: this.settings,
      backupConfirmed: this.backupConfirmed,
      permissions: await this.permissions.list(),
      pendingRequests: this.queue.list(),
      addressBook: this.addressBook,
      watchlist: this.watchlist,
      hiddenTokens: this.hiddenTokens,
      customTokens: this.customTokens,
      localActivity: this.localTx.map(activityFromRecord),
    };
  }

  // ---------------------------------------------------------------------------
  // WalletApi: onboarding
  // ---------------------------------------------------------------------------

  private async createVault(keyring: Keyring, password: string): Promise<void> {
    if (await this.opts.persistent.get(KEYS.vault)) throw new Error("A wallet already exists on this device.");
    if (typeof password !== "string" || password.length < 8) throw new VaultError("WEAK_PASSWORD", "Password must be at least 8 characters.");
    const { blob, keyBits } = await encryptVault(keyring.toPayload(), password, { iterations: this.kdfIterations });
    await this.persist(KEYS.vault, blob);
    this.keyring = keyring;
    this.keyBits = keyBits;
    await this.setSession(keyBits);
  }

  async createWallet(p: { password: string }): Promise<{ mnemonic: string; address: Address }> {
    await this.init();
    const { keyring, mnemonic } = Keyring.create();
    await this.createVault(keyring, p.password);
    const [hd] = keyring.hdAddresses();
    const account = await this.addAccount({ name: this.nextAccountName(), address: hd!.address, kind: "hd", hdIndex: 0 });
    this.backupConfirmed = false;
    await this.persist(KEYS.backup, false);
    this.emit({ type: "unlocked" });
    this.emit({ type: "state" });
    return { mnemonic, address: account.address };
  }

  async confirmBackup(): Promise<void> {
    await this.init();
    this.backupConfirmed = true;
    await this.persist(KEYS.backup, true);
    this.emit({ type: "state" });
  }

  async importWallet(p: { password: string; mnemonic?: string; privateKey?: string }): Promise<{ address: Address }> {
    await this.init();
    let keyring: Keyring;
    if (p.mnemonic) keyring = Keyring.fromMnemonic(p.mnemonic);
    else if (p.privateKey) keyring = Keyring.fromPrivateKey(p.privateKey);
    else throw new Error("Provide a recovery phrase or a private key.");
    await this.createVault(keyring, p.password);
    const address = keyring.addresses()[0]!;
    const account = await this.addAccount(
      keyring.hasMnemonic ? { name: this.nextAccountName(), address, kind: "hd", hdIndex: 0 } : { name: this.nextAccountName(), address, kind: "imported" },
    );
    // An imported wallet was backed up elsewhere by definition.
    this.backupConfirmed = true;
    await this.persist(KEYS.backup, true);
    this.emit({ type: "unlocked" });
    this.emit({ type: "state" });
    return { address: account.address };
  }

  async addWatchAccount(p: { address: Address; name?: string }): Promise<Account> {
    await this.init();
    if (!isValidAddress(p.address)) throw new Error("Invalid address.");
    const address = checksum(p.address);
    if (this.accountByAddress(address)) throw new Error("This address is already in the wallet.");
    const account = await this.addAccount({ name: p.name?.trim() || `Watch ${shortAddress(address)}`, address, kind: "watch" });
    this.emit({ type: "state" });
    return account;
  }

  // ---------------------------------------------------------------------------
  // WalletApi: lock
  // ---------------------------------------------------------------------------

  async unlock(p: { password: string }): Promise<void> {
    await this.init();
    const vault = await this.opts.persistent.get<EncryptedVaultBlob>(KEYS.vault);
    if (!isEncryptedVaultBlob(vault)) throw new Error("No wallet found on this device.");
    const { payload, keyBits } = await decryptVault(vault, p.password);
    if (this.keyBits) zeroize(this.keyBits);
    this.keyBits = keyBits;
    this.keyring = Keyring.fromPayload(payload);
    await this.setSession(keyBits);
    this.emit({ type: "unlocked" });
    this.emit({ type: "state" });
  }

  async lock(): Promise<void> {
    await this.init();
    this.keyring?.lock();
    this.keyring = null;
    if (this.keyBits) zeroize(this.keyBits);
    this.keyBits = null;
    this.reviews.clear();
    await this.clearSession();
    this.emit({ type: "locked" });
    this.emit({ type: "state" });
  }

  async touch(): Promise<void> {
    if (this.locked) return;
    await this.opts.session.set(SESSION.lastActivity, this.now());
  }

  // ---------------------------------------------------------------------------
  // WalletApi: accounts
  // ---------------------------------------------------------------------------

  async createAccount(p: { name?: string } = {}): Promise<Account> {
    const keyring = await this.ensureUnlocked();
    const { index, address } = keyring.addHdAccount();
    await this.saveVaultFromKeyring();
    const account = await this.addAccount({ name: p.name?.trim() || this.nextAccountName(), address, kind: "hd", hdIndex: index });
    this.emit({ type: "state" });
    return account;
  }

  async importAccount(p: { privateKey: string; name?: string }): Promise<Account> {
    const keyring = await this.ensureUnlocked();
    const address = keyring.importPrivateKey(p.privateKey);
    await this.saveVaultFromKeyring();
    const account = await this.addAccount({ name: p.name?.trim() || this.nextAccountName(), address, kind: "imported" });
    this.emit({ type: "state" });
    return account;
  }

  async renameAccount(p: { id: string; name: string }): Promise<void> {
    await this.init();
    const a = this.accounts.find((x) => x.id === p.id);
    if (!a) throw new Error("Account not found.");
    a.name = p.name.trim().slice(0, 40) || a.name;
    await this.persist(KEYS.accounts, this.accounts);
    this.emit({ type: "state" });
  }

  async removeAccount(p: { id: string }): Promise<void> {
    await this.init();
    const a = this.accounts.find((x) => x.id === p.id);
    if (!a) throw new Error("Account not found.");
    if (a.kind === "hd") throw new Error("Accounts derived from the recovery phrase cannot be removed.");
    if (a.kind === "imported") {
      const keyring = await this.ensureUnlocked();
      keyring.removeImported(a.address);
      await this.saveVaultFromKeyring();
    }
    this.accounts = this.accounts.filter((x) => x.id !== p.id);
    await this.permissions.removeAccount(a.address);
    await this.persist(KEYS.accounts, this.accounts);
    if (this.selectedId === p.id) {
      this.selectedId = this.accounts[0]?.id ?? null;
      await this.persist(KEYS.selected, this.selectedId);
    }
    this.emit({ type: "state" });
  }

  async selectAccount(p: { id: string }): Promise<void> {
    await this.init();
    if (!this.accounts.some((a) => a.id === p.id)) throw new Error("Account not found.");
    this.selectedId = p.id;
    await this.persist(KEYS.selected, p.id);
    this.emit({ type: "state" });
    const selected = this.selectedAccount();
    if (selected) {
      for (const perm of await this.permissions.list()) {
        if (perm.accounts.some((a) => sameAddress(a, selected.address))) {
          this.emit({ type: "accountsChanged", accounts: this.orderedAccountsFor(perm.accounts), origin: perm.origin });
        }
      }
    }
  }

  private orderedAccountsFor(granted: Address[]): Address[] {
    const selected = this.selectedAccount();
    const list = [...granted];
    if (selected && list.some((a) => sameAddress(a, selected.address))) {
      return [selected.address, ...list.filter((a) => !sameAddress(a, selected.address))];
    }
    return list;
  }

  // ---------------------------------------------------------------------------
  // WalletApi: settings
  // ---------------------------------------------------------------------------

  async updateSettings(p: Partial<Settings>): Promise<Settings> {
    await this.init();
    const { networkMode: _ignored, customRpc: _ignored2, ...rest } = p;
    this.settings = { ...this.settings, ...rest };
    await this.persist(KEYS.settings, this.settings);
    await this.touch();
    this.emit({ type: "state" });
    return this.settings;
  }

  async setNetworkMode(p: { mode: NetworkMode }): Promise<void> {
    await this.init();
    if (this.mode === "demo") throw new Error("Demo mode runs on a simulated Robinhood Chain; the testnet toggle is available in live builds.");
    if (this.settings.networkMode === p.mode) return;
    this.settings = { ...this.settings, networkMode: p.mode };
    await this.persist(KEYS.settings, this.settings);
    this.reviews.clear();
    this.emit({ type: "chainChanged", chainId: this.chainId });
    this.emit({ type: "state" });
  }

  async setCustomRpc(p: { chainId: number; url: string | null }): Promise<{ ok: boolean; error?: string }> {
    await this.init();
    if (!isSupportedChain(p.chainId)) return { ok: false, error: "Unsupported chain." };
    const customRpc = { ...this.settings.customRpc };
    if (p.url) {
      if (!/^https:\/\//.test(p.url)) return { ok: false, error: "Custom RPC must use https://." };
      const probe = await probeRpc(p.url, p.chainId);
      if (!probe.ok) return { ok: false, error: probe.error ?? "RPC check failed." };
      customRpc[p.chainId] = p.url;
    } else {
      delete customRpc[p.chainId];
    }
    this.settings = { ...this.settings, customRpc };
    await this.persist(KEYS.settings, this.settings);
    this.live?.invalidate();
    this.clients.clear();
    this.emit({ type: "state" });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // WalletApi: permissions & requests
  // ---------------------------------------------------------------------------

  async revokePermission(p: { origin: string }): Promise<void> {
    await this.init();
    await this.permissions.revoke(p.origin);
    this.queue.rejectAllFrom(normalizeOrigin(p.origin));
    this.emit({ type: "accountsChanged", accounts: [], origin: normalizeOrigin(p.origin) });
    this.emit({ type: "state" });
  }

  async revokeAllPermissions(): Promise<void> {
    await this.init();
    const list = await this.permissions.list();
    await this.permissions.revokeAll();
    for (const perm of list) this.emit({ type: "accountsChanged", accounts: [], origin: perm.origin });
    this.emit({ type: "state" });
  }

  async resolveRequest(p: { id: string; approved: boolean; accounts?: Address[]; approvalAmount?: string }): Promise<void> {
    await this.init();
    const req = this.queue.get(p.id);
    if (!req) throw new Error("This request has expired.");
    if (!p.approved) {
      this.queue.reject(p.id, RpcError.userRejected());
      this.emit({ type: "requestResolved", requestId: p.id });
      return;
    }
    try {
      switch (req.kind) {
        case "connect": {
          const selected = this.selectedAccount();
          const accounts = (p.accounts?.length ? p.accounts : selected ? [selected.address] : []).filter((a) => this.accountByAddress(a));
          if (!accounts.length) throw new Error("No account to connect.");
          const perm = await this.permissions.grant(req.origin, accounts);
          const ordered = this.orderedAccountsFor(perm.accounts);
          this.queue.resolve(p.id, ordered);
          this.emit({ type: "accountsChanged", accounts: ordered, origin: req.origin });
          break;
        }
        case "sign_message": {
          const keyring = await this.ensureUnlocked();
          const account = keyring.getAccount(req.account!);
          const sig = await this.signer.signMessage({ raw: req.message!.hex }, account);
          this.queue.resolve(p.id, sig);
          break;
        }
        case "sign_typed_data": {
          const keyring = await this.ensureUnlocked();
          const account = keyring.getAccount(req.account!);
          const typed = analyzeTypedDataRequest(req.typedData!.json, this.chainId).typedData;
          const sig = await this.signer.signTypedData(typed, account);
          this.queue.resolve(p.id, sig);
          break;
        }
        case "send_transaction": {
          let review = req.transaction!;
          if (p.approvalAmount !== undefined && review.approvals[0]) {
            review = await this.rebuildApproval(review, p.approvalAmount);
          }
          const result = await this.confirmTransaction({ reviewId: review.reviewId });
          this.queue.resolve(p.id, result.hash);
          break;
        }
        case "switch_chain":
        case "add_chain": {
          const target = req.targetChainId!;
          await this.setNetworkMode({ mode: target === ROBINHOOD_MAINNET_ID ? "mainnet" : "testnet" });
          this.queue.resolve(p.id, null);
          break;
        }
      }
    } catch (e) {
      this.queue.reject(p.id, e instanceof RpcError ? e : RpcError.internal(e instanceof Error ? e.message : "Request failed."));
      throw e;
    } finally {
      this.emit({ type: "requestResolved", requestId: p.id });
    }
  }

  /** "Edit permission": rebuilds an approval with a user-chosen amount, then re-prepares and re-reviews it. */
  private async rebuildApproval(review: TxReview, amount: string): Promise<TxReview> {
    const approval = review.approvals[0]!;
    const token = this.lookupToken(review.chainId, approval.tokenAddress);
    const decimals = token?.decimals ?? 18;
    const raw = /^unlimited$/i.test(amount.trim()) ? (1n << 256n) - 1n : parseUnits(amount.trim().replace(/,/g, ""), decimals);
    const request = buildApprove({ chainId: review.chainId, from: review.from, token: approval.tokenAddress, spender: approval.spender, amount: raw });
    const next = await this.prepareTransaction({ request, meta: review.meta }, review.origin);
    this.reviews.delete(review.reviewId);
    return next;
  }

  // ---------------------------------------------------------------------------
  // WalletApi: transactions
  // ---------------------------------------------------------------------------

  async prepareTransaction(p: { request: TxRequest; meta?: Record<string, string> }, origin?: string): Promise<TxReview> {
    await this.tick();
    const req = p.request;
    if (!isValidAddress(req.from)) throw RpcError.invalidParams("Invalid sender.");
    if (req.to !== undefined && !isValidAddress(req.to)) throw RpcError.invalidParams("Invalid recipient.");
    if (!this.accountByAddress(req.from)) throw RpcError.unauthorized("Unknown sender account.");
    const chainId = req.chainId || this.chainId;
    const client = this.client(chainId);
    const { prepared } = await prepareTransaction(client, { ...req, chainId });
    const decoded = decodeTransaction({ to: prepared.to, data: prepared.data, value: BigInt(prepared.value) });
    const simulation = this.settings.simulateBeforeSign
      ? await this.simulator.simulate(client, prepared)
      : { status: "unavailable" as const, method: "none" as const, error: "Simulation is turned off in Security › Transaction Protection." };

    const ethPriceUsd = this.opts.marketData ? (await this.opts.marketData.getTokenPrice(nativeToken(chainId)).catch(() => null))?.priceUsd ?? null : null;
    const nativeBalanceWei = await client.getBalance({ address: req.from }).catch(() => undefined);
    let currentAllowance: bigint | undefined;
    if (decoded.intent === "approve" && decoded.token && decoded.spender) {
      currentAllowance = await client
        .readContract({ address: decoded.token, abi: [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "allowance", args: [req.from, decoded.spender] })
        .catch(() => undefined) as bigint | undefined;
    }

    const review = await reviewTransaction({
      reviewId: newId("rev"),
      walletChainId: this.chainId,
      prepared,
      decoded,
      simulation,
      tokenLookup: (a) => this.lookupToken(chainId, a),
      unknownTokenLookup: async (a) => {
        const meta = await readTokenMetadata(client, a).catch(() => null);
        return meta ? makeUnknownToken(chainId, a, meta) : undefined;
      },
      spenderLabel: (a) => knownSpenderLabel(chainId, a) ?? this.customSpenderLabel(a),
      addressLabel: (a) => this.labelFor(a),
      isContract: async (a) => {
        const code = await client.getCode({ address: a }).catch(() => undefined);
        return !!code && code !== "0x";
      },
      priceUsd: () => null,
      ethPriceUsd,
      nativeBalanceWei,
      lowGasThresholdEth: this.settings.lowGasThresholdEth,
      currentAllowance,
      origin,
      meta: p.meta,
    });
    this.reviews.set(review.reviewId, { review, request: { ...req, chainId } });
    return review;
  }

  private customSpenderLabel(address: Address): string | undefined {
    if (this.mode !== "demo") return undefined;
    const a = address.toLowerCase();
    if (a === "0x00000000000000000000000000000000000d3a01") return "Demo Router A";
    if (a === "0x00000000000000000000000000000000000d3a02") return "Demo Router B";
    if (a === "0x00000000000000000000000000000000000b71d6") return "Demo Bridge";
    return undefined;
  }

  async confirmTransaction(p: { reviewId: string }): Promise<TxResult> {
    const keyring = await this.ensureUnlocked();
    const stored = this.reviews.get(p.reviewId);
    if (!stored) throw new Error("This review has expired. Start again.");
    const { review } = stored;
    if (this.now() - review.createdAt > 10 * 60_000) {
      this.reviews.delete(p.reviewId);
      throw new Error("This review is older than 10 minutes. Start again so fees and balances are fresh.");
    }
    const account = keyring.getAccount(review.from);
    const signed = await this.signer.signTransaction(review.prepared, account);
    this.reviews.delete(p.reviewId);
    const hash = await this.broadcaster.broadcast(review.chainId, signed);
    const record: LocalTxRecord = {
      hash,
      chainId: review.chainId,
      from: review.from,
      to: review.to,
      intent: review.summary.intent,
      title: review.summary.title,
      changes: review.changes,
      createdAt: this.now(),
      status: "pending",
      demo: this.mode === "demo",
      origin: review.origin,
      counterparty: review.recipient ?? review.to,
      counterpartyLabel: review.recipient ?? review.to ? this.labelFor((review.recipient ?? review.to)!) : undefined,
      meta: review.meta,
    };
    this.localTx = [record, ...this.localTx].slice(0, 200);
    await this.persist(KEYS.localTx, this.localTx);
    this.emit({ type: "tx", hash, status: "pending", chainId: review.chainId });
    this.emit({ type: "state" });
    void this.watchReceipt(review.chainId, hash);
    return { hash, chainId: review.chainId, explorerUrl: this.mode === "demo" ? undefined : explorerTxUrl(review.chainId, hash), demo: this.mode === "demo" };
  }

  private async watchReceipt(chainId: number, hash: Hex): Promise<void> {
    let status: ActivityItem["status"] = "pending";
    try {
      const receipt = await waitForReceipt(this.client(chainId), hash, { timeoutMs: 180_000, pollingIntervalMs: this.mode === "demo" ? 300 : 2_000 });
      status = receipt.status === "success" ? "confirmed" : "failed";
    } catch {
      return; // still pending; the activity feed keeps polling
    }
    const rec = this.localTx.find((r) => r.hash === hash);
    if (rec) {
      rec.status = status;
      await this.persist(KEYS.localTx, this.localTx);
    }
    this.emit({ type: "tx", hash, status, chainId });
    this.emit({ type: "state" });
  }

  async discardReview(p: { reviewId: string }): Promise<void> {
    this.reviews.delete(p.reviewId);
  }

  // ---------------------------------------------------------------------------
  // WalletApi: chain reads
  // ---------------------------------------------------------------------------

  async rpcRequest(p: { chainId?: number; method: string; params?: unknown[] }): Promise<unknown> {
    await this.init();
    if (typeof p.method !== "string") throw RpcError.invalidParams("Method must be a string.");
    if (p.params !== undefined && !Array.isArray(p.params)) throw RpcError.invalidParams("Params must be an array.");
    if (p.method === "eth_sendRawTransaction") throw RpcError.unsupportedMethod(p.method);
    return this.gateway.request(p.chainId ?? this.chainId, p.method, p.params ?? []);
  }

  async getActivity(p: { address: Address; chainId?: number }): Promise<ActivityItem[]> {
    await this.init();
    const chainId = p.chainId ?? this.chainId;
    const local = this.localTx.filter((r) => r.chainId === chainId && sameAddress(r.from, p.address)).map(activityFromRecord);
    if (this.demo) return mergeActivity(local, this.demo.getActivity(p.address));
    const lookup = (cid: number, a: Address | "native") => this.lookupToken(cid, a);
    const explorer = await fetchExplorerActivity(chainId, p.address, lookup, this.opts.fetchImpl);
    if (explorer) return mergeActivity(local, explorer);
    const logs = await scanTransferLogs(this.client(chainId), chainId, p.address, lookup, { span: 200_000 }).catch(() => []);
    return mergeActivity(local, logs);
  }

  async getDetectedTokens(p: { address: Address; chainId?: number }): Promise<TokenInfo[]> {
    await this.init();
    const chainId = p.chainId ?? this.chainId;
    if (this.demo) return this.demo.getDetectedTokens(chainId, p.address);
    return (await fetchExplorerTokenBalances(chainId, p.address, this.opts.fetchImpl)) ?? [];
  }

  async getAllowances(p: { address: Address; chainId?: number }): Promise<Allowance[]> {
    await this.init();
    const chainId = p.chainId ?? this.chainId;
    if (this.demo) {
      return this.demo.getAllowances(chainId, p.address).map(({ token, spender, raw }) => {
        const unlimited = isUnlimitedAllowance(raw);
        const label = knownSpenderLabel(chainId, spender) ?? this.customSpenderLabel(spender);
        return {
          token,
          spender,
          spenderLabel: label,
          raw: raw.toString(),
          formatted: unlimited ? "Unlimited" : formatTokenAmount(raw, token.decimals),
          unlimited,
          risk: unlimited ? "high" : label ? "low" : "caution",
        };
      });
    }
    return scanApprovals(this.client(chainId), chainId, p.address, this.customTokens);
  }

  // ---------------------------------------------------------------------------
  // WalletApi: security
  // ---------------------------------------------------------------------------

  async exportRecovery(p: { password: string; accountId?: string }): Promise<{ mnemonic?: string; privateKey?: string }> {
    await this.init();
    const vault = await this.opts.persistent.get<EncryptedVaultBlob>(KEYS.vault);
    if (!isEncryptedVaultBlob(vault)) throw new Error("No vault on this device.");
    // Always re-derive from the password: this is a deliberate, re-authenticated action.
    const { payload, keyBits } = await decryptVault(vault, p.password);
    zeroize(keyBits);
    const keyring = Keyring.fromPayload(payload);
    try {
      if (p.accountId) {
        const account = this.accounts.find((a) => a.id === p.accountId);
        if (!account) throw new Error("Account not found.");
        if (account.kind === "watch") throw new Error("Watch-only accounts have no key to export.");
        return { privateKey: keyring.exportPrivateKey(account.address) };
      }
      return keyring.hasMnemonic ? { mnemonic: keyring.exportMnemonic() } : { privateKey: keyring.exportPrivateKey(this.accounts[0]!.address) };
    } finally {
      keyring.lock();
      await this.touch();
    }
  }

  async changePassword(p: { current: string; next: string }): Promise<void> {
    await this.init();
    const vault = await this.opts.persistent.get<EncryptedVaultBlob>(KEYS.vault);
    if (!isEncryptedVaultBlob(vault)) throw new Error("No vault on this device.");
    if (p.next.length < 8) throw new VaultError("WEAK_PASSWORD", "Password must be at least 8 characters.");
    const { blob, keyBits } = await changeVaultPassword(vault, p.current, p.next, { iterations: this.kdfIterations });
    await this.persist(KEYS.vault, blob);
    if (this.keyBits) zeroize(this.keyBits);
    this.keyBits = keyBits;
    if (!this.keyring) this.keyring = Keyring.fromPayload(await decryptVaultWithKey(blob, keyBits));
    await this.setSession(keyBits);
    this.emit({ type: "state" });
  }

  // ---------------------------------------------------------------------------
  // WalletApi: lists
  // ---------------------------------------------------------------------------

  async saveAddressBookEntry(p: { id?: string; name: string; address: Address }): Promise<AddressBookEntry> {
    await this.init();
    if (!isValidAddress(p.address)) throw new Error("Invalid address.");
    const name = p.name.trim().slice(0, 40);
    if (!name) throw new Error("Name required.");
    const address = checksum(p.address);
    let entry = p.id ? this.addressBook.find((e) => e.id === p.id) : undefined;
    if (entry) {
      entry.name = name;
      entry.address = address;
    } else {
      entry = { id: newId("abk"), name, address, createdAt: this.now() };
      this.addressBook.push(entry);
    }
    await this.persist(KEYS.addressBook, this.addressBook);
    this.emit({ type: "state" });
    return entry;
  }

  async removeAddressBookEntry(p: { id: string }): Promise<void> {
    await this.init();
    this.addressBook = this.addressBook.filter((e) => e.id !== p.id);
    await this.persist(KEYS.addressBook, this.addressBook);
    this.emit({ type: "state" });
  }

  async toggleWatchlist(p: { key: string }): Promise<string[]> {
    await this.init();
    const key = p.key.trim();
    this.watchlist = this.watchlist.includes(key) ? this.watchlist.filter((k) => k !== key) : [...this.watchlist, key];
    await this.persist(KEYS.watchlist, this.watchlist);
    this.emit({ type: "state" });
    return this.watchlist;
  }

  async setTokenHidden(p: { address: string; hidden: boolean }): Promise<void> {
    await this.init();
    const a = p.address.toLowerCase();
    this.hiddenTokens = p.hidden ? [...new Set([...this.hiddenTokens, a])] : this.hiddenTokens.filter((x) => x !== a);
    await this.persist(KEYS.hidden, this.hiddenTokens);
    this.emit({ type: "state" });
  }

  async addCustomToken(p: { token: TokenInfo }): Promise<void> {
    await this.init();
    const t = p.token;
    if (t.address === "native" || !isValidAddress(t.address)) throw new Error("Invalid token address.");
    if (findToken(t.chainId, t.address)) return;
    const token: TokenInfo = { ...t, address: t.address.toLowerCase() as Address, verified: false, custom: true, category: t.category === "unknown" ? "ecosystem" : t.category };
    this.customTokens = [...this.customTokens.filter((x) => !(x.chainId === token.chainId && sameAddress(x.address, token.address))), token];
    await this.persist(KEYS.custom, this.customTokens);
    this.emit({ type: "state" });
  }

  async removeCustomToken(p: { address: string }): Promise<void> {
    await this.init();
    this.customTokens = this.customTokens.filter((t) => !sameAddress(t.address, p.address));
    await this.persist(KEYS.custom, this.customTokens);
    this.emit({ type: "state" });
  }

  async resetDemo(): Promise<void> {
    await this.init();
    if (!this.demo) return;
    this.demo.reset();
    for (const a of this.accounts) this.demo.seedAccount(a.address);
    this.localTx = [];
    await this.persist(KEYS.localTx, this.localTx);
    this.emit({ type: "state" });
  }

  // ---------------------------------------------------------------------------
  // dApp provider (background only — never exposed to the UI router)
  // ---------------------------------------------------------------------------

  /** Accounts a site may see: granted accounts, selected first. Empty when locked (nothing leaks while locked). */
  async accountsForOrigin(origin: string): Promise<Address[]> {
    await this.tick();
    if (this.locked) return [];
    const perm = await this.permissions.get(origin);
    return perm ? this.orderedAccountsFor(perm.accounts) : [];
  }

  private async enqueue(request: Omit<DappRequest, "id" | "createdAt">): Promise<unknown> {
    const req: DappRequest = { ...request, id: newId("req"), createdAt: this.now() };
    const promise = this.queue.add(req);
    this.emit({ type: "request", requestId: req.id });
    try {
      await this.opts.openApprovalUi?.(req.id);
    } catch {
      /* UI could not open: the request stays queued for the popup */
    }
    return promise;
  }

  async handleDappRequest(rawOrigin: string, method: unknown, params: unknown): Promise<unknown> {
    await this.tick();
    const origin = normalizeOrigin(rawOrigin);
    if (typeof method !== "string" || !method) throw RpcError.invalidParams("Method must be a string.");
    const args: unknown[] = params === undefined ? [] : Array.isArray(params) ? params : [params];
    const chainId = this.chainId;

    switch (method) {
      case "eth_chainId":
        return toHexChainId(chainId);
      case "net_version":
        return String(chainId);
      case "eth_accounts":
        return this.accountsForOrigin(origin);
      case "wallet_getPermissions": {
        const accounts = await this.accountsForOrigin(origin);
        return accounts.length ? [{ parentCapability: "eth_accounts", invoker: origin, caveats: [{ type: "restrictReturnedAccounts", value: accounts }] }] : [];
      }
      case "eth_requestAccounts":
      case "wallet_requestPermissions": {
        const existing = await this.accountsForOrigin(origin);
        if (existing.length && !this.locked) {
          await this.permissions.touch(origin);
          return method === "eth_requestAccounts" ? existing : [{ parentCapability: "eth_accounts", invoker: origin, caveats: [{ type: "restrictReturnedAccounts", value: existing }] }];
        }
        const accounts = (await this.enqueue({ origin, kind: "connect", method, params: args, chainId })) as Address[];
        return method === "wallet_requestPermissions" ? [{ parentCapability: "eth_accounts", invoker: origin, caveats: [{ type: "restrictReturnedAccounts", value: accounts }] }] : accounts;
      }
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain": {
        const p0 = args[0] as { chainId?: unknown } | undefined;
        const target = parseHexChainId(p0?.chainId);
        if (target === null) throw RpcError.invalidParams("Expected { chainId }.");
        if (target === chainId) return null;
        if (!isPrimaryChain(target)) throw RpcError.unrecognizedChain(toHexChainId(target));
        if (this.mode === "demo") throw RpcError.unrecognizedChain(toHexChainId(target));
        await this.enqueue({ origin, kind: method === "wallet_switchEthereumChain" ? "switch_chain" : "add_chain", method, params: args, chainId, targetChainId: target });
        return null;
      }
      case "personal_sign": {
        const split = splitPersonalSignParams(args);
        if (!split) throw RpcError.invalidParams("personal_sign expects [message, address].");
        await this.requireAuthorized(origin, split.address);
        const analysis = analyzeMessageSignRequest(split.message);
        return this.enqueue({ origin, kind: "sign_message", method, params: args, account: checksum(split.address), chainId, message: analysis });
      }
      case "eth_signTypedData":
      case "eth_signTypedData_v3":
      case "eth_signTypedData_v4": {
        const split = splitTypedDataParams(args);
        if (!split) throw RpcError.invalidParams("eth_signTypedData_v4 expects [address, typedData].");
        await this.requireAuthorized(origin, split.address);
        let analysis;
        try {
          analysis = analyzeTypedDataRequest(split.raw, chainId);
        } catch (e) {
          throw RpcError.invalidParams(e instanceof Error ? e.message : "Invalid typed data.");
        }
        return this.enqueue({
          origin,
          kind: "sign_typed_data",
          method,
          params: args,
          account: checksum(split.address),
          chainId,
          typedData: { json: analysis.json, primaryType: analysis.primaryType, domain: analysis.domain, warnings: analysis.warnings },
        });
      }
      case "eth_sendTransaction": {
        const tx = args[0] as Record<string, unknown> | undefined;
        if (!tx || typeof tx !== "object") throw RpcError.invalidParams("eth_sendTransaction expects a transaction object.");
        const from = typeof tx.from === "string" ? tx.from : "";
        if (!isValidAddress(from)) throw RpcError.invalidParams("Invalid from address.");
        await this.requireAuthorized(origin, from as Address);
        const to = typeof tx.to === "string" ? tx.to : undefined;
        if (to !== undefined && !isValidAddress(to)) throw RpcError.invalidParams("Invalid to address.");
        const data = typeof tx.data === "string" ? tx.data : typeof tx.input === "string" ? tx.input : "0x";
        if (!/^0x([0-9a-fA-F]{2})*$/.test(data)) throw RpcError.invalidParams("Invalid data.");
        const txChain = tx.chainId !== undefined ? parseHexChainId(tx.chainId) : chainId;
        if (txChain !== chainId) throw RpcError.unrecognizedChain(String(tx.chainId));
        const request: TxRequest = {
          chainId,
          from: checksum(from),
          to: to ? checksum(to) : undefined,
          value: hexQuantityToDecimal(tx.value),
          data: data as Hex,
          gas: tx.gas !== undefined ? hexQuantityToDecimal(tx.gas) : undefined,
          maxFeePerGas: tx.maxFeePerGas !== undefined ? hexQuantityToDecimal(tx.maxFeePerGas) : undefined,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas !== undefined ? hexQuantityToDecimal(tx.maxPriorityFeePerGas) : undefined,
        };
        const review = await this.prepareTransaction({ request, meta: { origin } }, origin);
        return this.enqueue({ origin, kind: "send_transaction", method, params: args, account: request.from, chainId, transaction: review });
      }
      case "eth_sign":
      case "eth_sendRawTransaction":
      case "eth_signTransaction":
        throw RpcError.unsupportedMethod(method);
      default: {
        if (isReadOnly(method)) return this.gateway.request(chainId, method, args);
        throw RpcError.unsupportedMethod(method);
      }
    }
  }

  private async requireAuthorized(origin: string, address: Address): Promise<void> {
    if (this.locked) throw RpcError.unauthorized("The wallet is locked.");
    if (!(await this.permissions.hasAccount(origin, address))) throw RpcError.unauthorized();
    if (!this.keyring?.controls(address)) throw RpcError.unauthorized("This account is watch-only and cannot sign.");
    await this.permissions.touch(origin);
  }

  /** Rejects every pending request from an origin (e.g. when its tab closes). */
  cancelRequestsFrom(origin: string): void {
    this.queue.rejectAllFrom(normalizeOrigin(origin));
  }

  cancelRequest(id: string): void {
    this.queue.reject(id, RpcError.userRejected("The approval window was closed."));
  }

  pendingRequestIds(): string[] {
    return this.queue.list().map((r) => r.id);
  }

  /** Human-readable USD amount for a raw token quantity (used by callers that have a price). */
  static formatRaw(raw: string, decimals: number): string {
    return formatUnits(BigInt(raw), decimals);
  }
}

function isReadOnly(method: string): boolean {
  return method.startsWith("eth_") && !/sign|send|account|subscribe|filter|coinbase|mining|hashrate|submit/i.test(method);
}

function hexQuantityToDecimal(value: unknown): string | undefined {
  if (value === undefined || value === null) return "0";
  if (typeof value === "string") {
    if (/^0x[0-9a-fA-F]*$/.test(value)) return value === "0x" ? "0" : BigInt(value).toString();
    if (/^\d+$/.test(value)) return value;
    throw RpcError.invalidParams("Invalid quantity.");
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return String(value);
  throw RpcError.invalidParams("Invalid quantity.");
}

export { getRegistry };
