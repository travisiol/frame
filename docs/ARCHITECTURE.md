# Architecture

## One application, several surfaces

`packages/wallet-app` is the whole product UI. It receives an `AppEnvironment`:

```ts
interface AppEnvironment {
  backend: WalletBackend;          // the wallet service (in-process or over extension messaging)
  market: MarketDataProvider;      // prices, history, market status
  swapProviders: SwapProvider[];   // liquidity adapters (may be empty)
  bridgeProviders: BridgeProvider[];
  surface: "popup" | "dashboard" | "approval" | "demo";
  openDashboard?, openExternal, requestId?, closeWindow?
}
```

| Surface | Host | Backend |
| --- | --- | --- |
| `popup` | `apps/extension/popup.html` (380×600) | `chrome.runtime` messaging → background service worker |
| `dashboard` | `apps/extension/dashboard.html` (full tab: sidebar, table, chart) | same |
| `approval` | `apps/extension/approval.html?requestId=…` (window opened by the background for a dApp request) | same |
| `demo` | `apps/demo` (phone frame, "Expanded view" switches to `dashboard`) | `WalletService` in-process on `DemoChain` |

Screens are routed by a tiny hash router (`nav.ts`), so `dashboard.html#/markets` and `#/asset/0x…` are shareable inside the extension. State: a zustand store holds the latest `WalletSnapshot`; TanStack Query owns balances, prices, activity and allowances with refetch intervals; the `AppProvider` re-fetches the snapshot on every wallet event.

## WalletService — the core

`packages/wallet-core/src/wallet-service.ts` implements `WalletApi` and is platform-agnostic. It receives two `KeyValueStore`s:

- **persistent**: encrypted vault, account metadata, settings, permissions, address book, watchlist, hidden/custom tokens, local transaction records.
- **session**: derived vault key + last-activity timestamp (memory-only in the extension).

Inside: `Keyring` (decrypted payload while unlocked), `PermissionStore` (by origin), `RequestQueue` (dApp requests awaiting the user), a `ChainGateway` (`LiveChainGateway` with viem clients per chain, or `DemoChain`), and the transaction pipeline from `@frame/transaction-engine`.

Auto-lock is enforced on every call (`tick()`), not just by a timer — a sleeping service worker cannot miss it. The extension additionally runs a one-minute alarm.

### dApp request flow

```
page: ethereum.request({ method: "eth_sendTransaction", params: [tx] })
  → inpage provider → content script → background port (origin = port.sender.origin)
  → WalletService.handleDappRequest(origin, method, params)
      validates params, checks permission for `from`, prepares + simulates + reviews
      → RequestQueue.add(request)  → openApprovalUi(requestId)
  approval UI → resolveRequest({ id, approved, approvalAmount? })
      → sign → broadcast → resolve the page's promise with the hash
```

`eth_accounts`, `eth_chainId` and read-only `eth_*` calls are answered directly; `eth_sign`, `eth_sendRawTransaction` and `eth_signTransaction` are refused (4200). `wallet_switchEthereumChain` accepts only the two Robinhood Chain networks (4902 otherwise) and still asks the user.

## Transaction engine

```
TxRequest ─▶ prepareTransaction ─▶ PreparedTx ─▶ EthCallSimulator ─▶ reviewTransaction ─▶ TxReview
                                      │                                                     │ user confirms
                                      └──────────────▶ LocalAccountSigner ──▶ RpcBroadcaster ──▶ hash
```

`decodeTransaction` is pure and synchronous (ERC-20 transfer/transferFrom/approve, Uniswap-v2/v3-style swaps, Pons curve buy/sell, generic calls, deploys). `reviewTransaction` turns it into `summary` (headline + lines), `changes`, `approvals`, `risks` and `fee`. `humanizeError` maps node/vault/provider errors to consumer language with a redacted technical detail.

Activity comes from three sources merged by hash (`mergeActivity`): local records (intent + status the wallet knows), Blockscout v2 (when reachable), and ERC-20 `Transfer` logs (fallback). Demo activity is a fourth, always labelled.

## Markets layer

- `MarketDataProvider`: `DemoMarketDataProvider` (flagged `demo: true` on every quote and history point) and `LiveMarketDataProvider` (Yahoo Finance chart endpoint for the *underlying* ticker of Stock Tokens, CoinGecko for ETH/cbBTC, pegged for stables, unavailable otherwise). `CachedMarketData` de-duplicates and caches, without pinning failures.
- `SwapProvider` / `BridgeProvider`: `bestSwapQuote` ranks by net output after fees; the UI shows every route and lets the user pick. `MockSwapProvider`/`MockBridgeProvider` only exist in DEMO mode and build *real, decodable* transactions so the review and signing paths are identical. `LifiAdapter` implements both interfaces and is only enabled with `VITE_LIFI_API_URL`.
- `RiskProvider`: `LocalRiskProvider` (block/allow lists + registry knowledge) and `CompositeRiskProvider` (most severe wins). Core logic never depends on one proprietary provider.

## Token registry

`packages/token-registry/src/data/robinhood-mainnet.json` — 60 Robinhood Stock/ETF/RWA tokens, USDG (6 decimals) and cbBTC (8 decimals), each with address, ticker, name, decimals, category, underlying reference, price feed and verified flag. Addresses were read from Pons V2 factory `TokenLaunched` logs on Robinhood Chain and `symbol()/name()/decimals()` from each contract; `npm run registry:discover` reproduces it. The testnet file is intentionally empty.

Helpers: `findToken` (by address only), `findBySymbol` (may return several — never a verification), `searchRegistry`, `displayName` ("NVDA Stock Token"), `exposureLabel` ("Tokenized NVDA exposure"), `allocationBucket` (stocks / crypto / stables), `looksLikeSpam`, `isImpersonatingSymbol`, `makeUnknownToken` (always unverified).

## Demo chain

`DemoChain` is an in-memory JSON-RPC subset: balances, fees, nonces, `eth_call` for ERC-20 views, `eth_estimateGas`, receipts, and `eth_sendRawTransaction` that **parses and recovers the signer of real signed transactions** and applies them to a ledger (transfers, approvals with allowance checks, swaps priced from the demo table, a bridge that delivers a few seconds later). Nothing is broadcast anywhere; every result carries `demo: true`.

## Build

- Extension: `apps/extension/scripts/build.mjs` → pages + background as ES modules (`vite.config.ts`), content script and inpage provider as IIFEs (`vite.content.config.ts`, `vite.inpage.config.ts`), manifest filled from `BRAND`, CSP and inline-script checks.
- Website: `scripts/build-web.mjs` → landing at `/`, demo at `/demo/` (Vercel serves `apps/landing/dist`, see `vercel.json`).
- Icons: `scripts/render-icons.mjs` rasterises the logo geometry (three rectangles on a rounded tile) to PNG with a built-in encoder — no image dependency.

## Future (architected, not built)

- **Mobile**: `wallet-core` has no DOM dependency; `storage` needs a native adapter; `wallet-app` screens are 380px-first.
- **ERC-4337**: a `SmartAccountSigner` can replace `LocalAccountSigner`; the review already models batched approvals + swaps as steps.
- **NFTs**: `TokenCategory` and the registry shape allow ERC-721/1155 entries; no UI yet by design.
- **Hardware wallets**: another `TransactionSigner` implementation; the keyring already separates "controls" from "can sign locally".
