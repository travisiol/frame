import type { Address, Hex } from "viem";

export type { Address, Hex };

export type AppMode = "demo" | "live";
export type NetworkMode = "mainnet" | "testnet";

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export type AccountKind = "hd" | "imported" | "watch";

export interface Account {
  id: string;
  name: string;
  address: Address;
  kind: AccountKind;
  /** BIP-44 address index for HD accounts (m/44'/60'/0'/0/i). */
  hdIndex?: number;
  createdAt: number;
}

export interface AddressBookEntry {
  id: string;
  name: string;
  address: Address;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export type TokenCategory =
  | "native"
  | "stock-token"
  | "etf"
  | "rwa"
  | "stable"
  | "crypto"
  | "ecosystem"
  | "unknown";

export type UnderlyingType = "equity" | "etf" | "commodity" | "treasury" | "crypto" | "fiat";

export interface TokenInfo {
  chainId: number;
  /** Contract address, or "native" for the chain's gas token. */
  address: Address | "native";
  symbol: string;
  name: string;
  decimals: number;
  category: TokenCategory;
  /** True only when the contract address is present in the verified registry. */
  verified: boolean;
  /** What the token references (for Stock Tokens: the underlying equity/ETF). */
  underlying?: { ticker: string; name: string; type: UnderlyingType };
  /** Optional logo URL or data URI. Never fetched from token metadata. */
  logo?: string;
  priceFeed?: { provider: "yahoo" | "coingecko" | "pyth" | "pegged" | "none"; id: string };
  /** ISO date the entry was added to the registry. */
  addedAt?: string;
  tags?: string[];
  /** Set for tokens the user imported manually. */
  custom?: boolean;
}

export interface TokenBalance {
  token: TokenInfo;
  /** Raw integer balance as a decimal string. */
  raw: string;
  /** Human formatted balance (full precision). */
  formatted: string;
}

export interface PriceQuote {
  priceUsd: number | null;
  change24hPct: number | null;
  updatedAt: number;
  source: string;
  demo?: boolean;
}

export type MarketStatus = "open" | "pre-market" | "after-hours" | "closed" | "24-7" | "unknown";

export type PriceRange = "1H" | "1D" | "1W" | "1M" | "1Y";

export interface PricePoint {
  t: number;
  p: number;
}

export interface PriceHistory {
  range: PriceRange;
  points: PricePoint[];
  source: string;
  demo?: boolean;
}

export interface MarketMetadata {
  marketCap?: number | null;
  volume24h?: number | null;
  holders?: number | null;
  liquidityUsd?: number | null;
  ageDays?: number | null;
  source: string;
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export type ActivityKind =
  | "send"
  | "receive"
  | "swap"
  | "approve"
  | "bridge"
  | "contract"
  | "connect"
  | "buy"
  | "sell";

export type ActivityStatus = "confirmed" | "pending" | "failed";

export interface ActivityAmount {
  symbol: string;
  amount: string;
  sign: "+" | "-";
  tokenAddress?: Address | "native";
}

export interface ActivityItem {
  id: string;
  hash?: Hex;
  kind: ActivityKind;
  title: string;
  subtitle?: string;
  amounts: ActivityAmount[];
  counterparty?: Address;
  counterpartyLabel?: string;
  timestamp: number;
  status: ActivityStatus;
  chainId: number;
  explorerUrl?: string;
  /** True when the item was produced by the demo chain and never broadcast. */
  demo?: boolean;
  /** Token contracts involved (lowercase), used by the STOCK TOKENS filter. */
  tokenAddresses?: string[];
  source: "local" | "explorer" | "logs" | "demo" | "watcher";
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// Permissions & dApp requests
// ---------------------------------------------------------------------------

export interface OriginPermission {
  origin: string;
  accounts: Address[];
  connectedAt: number;
  lastUsedAt?: number;
  methods: "standard";
}

export type DappRequestKind =
  | "connect"
  | "sign_message"
  | "sign_typed_data"
  | "send_transaction"
  | "switch_chain"
  | "add_chain";

export type SignWarningCode =
  | "AUTH_CHALLENGE"
  | "TYPED_DATA"
  | "PERMIT"
  | "APPROVAL_LIKE"
  | "UNREADABLE";

export interface SignWarning {
  code: SignWarningCode;
  title: string;
  detail: string;
}

export interface DappRequest {
  id: string;
  origin: string;
  kind: DappRequestKind;
  method: string;
  params: unknown[];
  account?: Address;
  chainId: number;
  createdAt: number;
  /** personal_sign: decoded message. */
  message?: { text: string; hex: Hex; warnings: SignWarning[] };
  /** eth_signTypedData_v4: parsed typed data. */
  typedData?: {
    json: string;
    primaryType: string;
    domain: Record<string, unknown>;
    warnings: SignWarning[];
  };
  /** eth_sendTransaction: full review (simulation, changes, risks). */
  transaction?: TxReview;
  /** wallet_switchEthereumChain / wallet_addEthereumChain */
  targetChainId?: number;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface TxRequest {
  chainId: number;
  from: Address;
  to?: Address;
  /** Wei as a decimal string. */
  value?: string;
  data?: Hex;
  gas?: string;
  nonce?: number;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export interface PreparedTx {
  chainId: number;
  from: Address;
  to?: Address;
  value: string;
  data: Hex;
  gas: string;
  nonce: number;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

export type TxIntentKind =
  | "native_transfer"
  | "erc20_transfer"
  | "approve"
  | "swap"
  | "bridge"
  | "contract_call"
  | "contract_deploy";

export interface AssetChange {
  symbol: string;
  /** Human formatted amount. */
  amount: string;
  direction: "in" | "out";
  tokenAddress: Address | "native";
  usd?: number | null;
  approximate?: boolean;
}

export interface ApprovalChange {
  tokenAddress: Address;
  symbol: string;
  spender: Address;
  spenderLabel?: string;
  /** Human formatted amount ("Unlimited" when unlimited). */
  amount: string;
  unlimited: boolean;
  current?: string;
}

export type RiskLevel = "low" | "caution" | "high";

export type RiskCode =
  | "UNKNOWN_CONTRACT"
  | "UNLIMITED_TOKEN_APPROVAL"
  | "UNVERIFIED_TOKEN"
  | "NEW_CONTRACT"
  | "FAILED_SIMULATION"
  | "SIMULATION_UNAVAILABLE"
  | "ZERO_ADDRESS"
  | "SEND_TO_CONTRACT"
  | "CHAIN_MISMATCH"
  | "LOW_GAS"
  | "SELF_TRANSFER"
  | "BLOCKLISTED";

export interface RiskFlag {
  code: RiskCode;
  level: RiskLevel;
  title: string;
  detail: string;
}

export interface TxSummaryLine {
  label: string;
  value: string;
  mono?: boolean;
}

export interface TxSummary {
  /** Plain-English headline, e.g. "Send 25 USDG". */
  title: string;
  lines: TxSummaryLine[];
  intent: TxIntentKind;
  contractLabel?: string;
}

export interface SimulationResult {
  status: "success" | "reverted" | "unavailable";
  gasEstimate?: string;
  error?: string;
  revertReason?: string;
  method: "eth_call" | "trace" | "demo" | "none";
}

export interface TxReview {
  reviewId: string;
  chainId: number;
  from: Address;
  /** Transaction target (the token contract for ERC-20 transfers). */
  to?: Address;
  /** Who actually receives funds, when the intent is a transfer. */
  recipient?: Address;
  summary: TxSummary;
  changes: AssetChange[];
  approvals: ApprovalChange[];
  risks: RiskFlag[];
  riskLevel: RiskLevel;
  simulation: SimulationResult;
  fee: { wei: string; eth: string; usd: number | null };
  prepared: PreparedTx;
  raw: { data: Hex; value: string; decoded?: string };
  createdAt: number;
  origin?: string;
  /** Extra context for the UI (e.g. which asset / recipient). */
  meta?: Record<string, string>;
}

export interface TxResult {
  hash: Hex;
  chainId: number;
  explorerUrl?: string;
  demo?: boolean;
}

// ---------------------------------------------------------------------------
// Swap / bridge
// ---------------------------------------------------------------------------

export interface SwapQuoteRequest {
  chainId: number;
  fromToken: TokenInfo;
  toToken: TokenInfo;
  /** Raw integer amount of fromToken. */
  amountIn: string;
  slippageBps: number;
  account: Address;
}

export interface SwapQuote {
  providerId: string;
  providerName: string;
  amountOut: string;
  amountOutMin: string;
  /** toToken per 1 fromToken */
  rate: number;
  priceImpactPct: number | null;
  feeUsd: number | null;
  gasUsd: number | null;
  route: string[];
  estimatedSeconds?: number | null;
  expiresAt: number;
  /** Approval needed before the swap can execute. */
  approval?: { spender: Address; amount: string };
  demo?: boolean;
  raw?: unknown;
}

export interface SwapStep {
  kind: "approve" | "swap";
  label: string;
  tx: TxRequest;
}

export interface BridgeQuoteRequest {
  fromChainId: number;
  toChainId: number;
  /** Token on the source chain. */
  token: TokenInfo;
  amountIn: string;
  account: Address;
}

export interface BridgeQuote {
  providerId: string;
  providerName: string;
  amountOut: string;
  feeUsd: number | null;
  estimatedSeconds: number | null;
  route: string[];
  tx?: TxRequest;
  /** Native-token cost of the source-chain gas, in wei, when the provider estimates it. */
  gasCostWei?: string;
  approval?: { spender: Address; amount: string };
  demo?: boolean;
  raw?: unknown;
}

export interface Allowance {
  token: TokenInfo;
  spender: Address;
  spenderLabel?: string;
  /** Raw allowance as a decimal string. */
  raw: string;
  formatted: string;
  unlimited: boolean;
  risk: RiskLevel;
}

// ---------------------------------------------------------------------------
// Settings & snapshot
// ---------------------------------------------------------------------------

export type AutoLockMinutes = 1 | 5 | 15 | 30 | 60 | 0;

export interface Settings {
  autoLockMinutes: AutoLockMinutes;
  networkMode: NetworkMode;
  currency: "USD";
  language: "en";
  telemetryOptIn: boolean;
  notifications: boolean;
  developerMode: boolean;
  showRawTransactionData: boolean;
  /** ETH threshold under which the LOW GAS warning shows. */
  lowGasThresholdEth: string;
  simulateBeforeSign: boolean;
  /** Custom RPC per chain id (Advanced). */
  customRpc: Partial<Record<number, string>>;
  /** Show balances on the lock screen (off by default). */
  previewWhenLocked: boolean;
  /** Seconds after which a copied secret is cleared from the clipboard (0 = never attempt). */
  clearClipboardSeconds: number;
  /** Optional in-app label for the wallet — not a secret. */
  onboardingComplete: boolean;
}

/** Funds detected arriving at one of the wallet's addresses, on any supported chain. */
export interface IncomingFunds {
  id: string;
  chainId: number;
  address: Address;
  tokenAddress: Address | "native";
  symbol: string;
  decimals: number;
  /** Raw integer amount received. */
  amountRaw: string;
  detectedAt: number;
}

export interface WalletSnapshot {
  version: string;
  mode: AppMode;
  initialized: boolean;
  locked: boolean;
  chainId: number;
  networkMode: NetworkMode;
  accounts: Account[];
  selectedAccountId: string | null;
  settings: Settings;
  backupConfirmed: boolean;
  permissions: OriginPermission[];
  pendingRequests: DappRequest[];
  addressBook: AddressBookEntry[];
  watchlist: string[];
  hiddenTokens: string[];
  customTokens: TokenInfo[];
  localActivity: ActivityItem[];
  /** Funds detected arriving on any supported chain, newest first. */
  incoming: IncomingFunds[];
}

export type WalletEvent =
  | { type: "state" }
  | { type: "locked" }
  | { type: "unlocked" }
  | { type: "request"; requestId: string }
  | { type: "requestResolved"; requestId: string }
  | { type: "tx"; hash: Hex; status: ActivityStatus; chainId: number }
  | { type: "accountsChanged"; accounts: Address[]; origin?: string }
  | { type: "chainChanged"; chainId: number }
  | { type: "funds"; item: IncomingFunds };

export * from "./errors";
