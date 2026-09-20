import type {
  Account,
  ActivityItem,
  Address,
  AddressBookEntry,
  Allowance,
  NetworkMode,
  Settings,
  TokenInfo,
  TxRequest,
  TxResult,
  TxReview,
  WalletEvent,
  WalletSnapshot,
} from "@frame/types";

/**
 * WalletApi — everything the UI is allowed to ask the wallet service.
 *
 * In the extension the UI calls these over chrome.runtime messaging and the
 * background service worker executes them; in the web demo the same
 * interface is implemented in-process. Secrets only ever cross this boundary
 * in two directions the user explicitly asked for: a password going in, and
 * a recovery export coming out after re-authentication.
 */
export interface WalletApi {
  // --- status -------------------------------------------------------------
  getSnapshot(): Promise<WalletSnapshot>;

  // --- onboarding ----------------------------------------------------------
  /** Creates the vault. The mnemonic is returned ONCE for the backup screen and never persisted in clear. */
  createWallet(p: { password: string }): Promise<{ mnemonic: string; address: Address }>;
  confirmBackup(): Promise<void>;
  importWallet(p: { password: string; mnemonic?: string; privateKey?: string }): Promise<{ address: Address }>;
  addWatchAccount(p: { address: Address; name?: string }): Promise<Account>;

  // --- lock ----------------------------------------------------------------
  unlock(p: { password: string }): Promise<void>;
  lock(): Promise<void>;
  /** User activity ping — resets the auto-lock timer. */
  touch(): Promise<void>;

  // --- accounts ------------------------------------------------------------
  createAccount(p: { name?: string }): Promise<Account>;
  importAccount(p: { privateKey: string; name?: string }): Promise<Account>;
  renameAccount(p: { id: string; name: string }): Promise<void>;
  removeAccount(p: { id: string }): Promise<void>;
  selectAccount(p: { id: string }): Promise<void>;

  // --- settings ------------------------------------------------------------
  updateSettings(p: Partial<Settings>): Promise<Settings>;
  setNetworkMode(p: { mode: NetworkMode }): Promise<void>;
  /** Verifies the endpoint reports the expected chain id before saving it. */
  setCustomRpc(p: { chainId: number; url: string | null }): Promise<{ ok: boolean; error?: string }>;

  // --- permissions ---------------------------------------------------------
  revokePermission(p: { origin: string }): Promise<void>;
  revokeAllPermissions(): Promise<void>;

  // --- dApp requests -------------------------------------------------------
  resolveRequest(p: { id: string; approved: boolean; accounts?: Address[]; approvalAmount?: string }): Promise<void>;

  // --- transactions --------------------------------------------------------
  /** Builder → simulator → reviewer. Returns what the user will read; nothing is signed. */
  prepareTransaction(p: { request: TxRequest; meta?: Record<string, string> }): Promise<TxReview>;
  /** Signs and broadcasts a prepared review (wallet must be unlocked). */
  confirmTransaction(p: { reviewId: string }): Promise<TxResult>;
  discardReview(p: { reviewId: string }): Promise<void>;

  // --- chain reads ---------------------------------------------------------
  /** Read-only JSON-RPC proxy (the UI builds a viem client over it). */
  rpcRequest(p: { chainId?: number; method: string; params?: unknown[] }): Promise<unknown>;
  getActivity(p: { address: Address; chainId?: number }): Promise<ActivityItem[]>;
  getDetectedTokens(p: { address: Address; chainId?: number }): Promise<TokenInfo[]>;
  getAllowances(p: { address: Address; chainId?: number }): Promise<Allowance[]>;

  // --- security ------------------------------------------------------------
  exportRecovery(p: { password: string; accountId?: string }): Promise<{ mnemonic?: string; privateKey?: string }>;
  changePassword(p: { current: string; next: string }): Promise<void>;

  // --- lists ---------------------------------------------------------------
  saveAddressBookEntry(p: { id?: string; name: string; address: Address }): Promise<AddressBookEntry>;
  removeAddressBookEntry(p: { id: string }): Promise<void>;
  toggleWatchlist(p: { key: string }): Promise<string[]>;
  setTokenHidden(p: { address: string; hidden: boolean }): Promise<void>;
  addCustomToken(p: { token: TokenInfo }): Promise<void>;
  removeCustomToken(p: { address: string }): Promise<void>;

  // --- demo ----------------------------------------------------------------
  resetDemo(): Promise<void>;
}

export type WalletApiMethod = keyof WalletApi;

/** Explicit allowlist for the extension message router — anything else is refused. */
export const WALLET_API_METHODS: readonly WalletApiMethod[] = [
  "getSnapshot",
  "createWallet",
  "confirmBackup",
  "importWallet",
  "addWatchAccount",
  "unlock",
  "lock",
  "touch",
  "createAccount",
  "importAccount",
  "renameAccount",
  "removeAccount",
  "selectAccount",
  "updateSettings",
  "setNetworkMode",
  "setCustomRpc",
  "revokePermission",
  "revokeAllPermissions",
  "resolveRequest",
  "prepareTransaction",
  "confirmTransaction",
  "discardReview",
  "rpcRequest",
  "getActivity",
  "getDetectedTokens",
  "getAllowances",
  "exportRecovery",
  "changePassword",
  "saveAddressBookEntry",
  "removeAddressBookEntry",
  "toggleWatchlist",
  "setTokenHidden",
  "addCustomToken",
  "removeCustomToken",
  "resetDemo",
] as const;

export function isWalletApiMethod(name: string): name is WalletApiMethod {
  return (WALLET_API_METHODS as readonly string[]).includes(name);
}

/** UI-side view: the API plus an event subscription. */
export interface WalletBackend extends WalletApi {
  subscribe(listener: (event: WalletEvent) => void): () => void;
}
