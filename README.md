# FRAME

**The wallet for onchain markets.**
Stocks. Crypto. RWA. One wallet. — Built for Robinhood Chain.

FRAME is an independent, self-custodial wallet designed around the Robinhood Chain ecosystem: Stock Tokens, ETFs, RWA, stablecoins and ecosystem tokens, with swaps, bridges and dApp connections — presented like a modern investment portfolio, not a developer tool.

> FRAME is an independent application and is not affiliated with or endorsed by Robinhood Markets, Inc.

The product name is a placeholder. It lives in exactly one file — [`packages/config/src/brand.ts`](packages/config/src/brand.ts) — and every screen, manifest, document and error message reads it from there.

---

## What is in the box

| Path | What it is |
| --- | --- |
| `apps/extension` | Manifest V3 browser extension (Chrome, Brave, Edge): popup (380×600), full-page dashboard, approval window, background service worker, content script + inpage EIP-1193/EIP-6963 provider |
| `apps/demo` | The same wallet application running in a browser tab on a simulated Robinhood Chain (`VITE_APP_MODE=demo`) — what “VIEW DEMO” opens |
| `apps/landing` | Public website (hero + five sections + legal footer); the demo is published under `/demo/` |
| `packages/wallet-app` | The React application shared by every surface (onboarding, lock, portfolio, asset, send, receive, swap, bridge, markets, activity, security center, settings, dApp approvals) |
| `packages/wallet-core` | `WalletService`: encrypted vault lifecycle, keyring, permissions by origin, dApp request queue, auto-lock, transaction pipeline, demo chain |
| `packages/security` | WebCrypto vault (PBKDF2-HMAC-SHA-256 → AES-256-GCM), password policy, secret redaction |
| `packages/transaction-engine` | Builder → Simulator → Reviewer → Signer → Broadcaster, calldata decoder, activity normalisation, human-readable errors, signature-request analysis |
| `packages/chain` | viem clients with ordered RPC fallback and chain-id verification, ERC-20 reads/encoders, fee estimation, address safety, formatting |
| `packages/token-registry` | Verified Robinhood Chain tokens (60 Stock/ETF/RWA tokens + USDG + cbBTC), read from the chain, reproducible with `npm run registry:discover` |
| `packages/markets` | `MarketDataProvider`, `SwapProvider`, `BridgeProvider`, `RiskProvider` abstractions; demo providers, live Yahoo/CoinGecko prices, LI.FI adapter |
| `packages/storage` | Key-value storage abstraction (chrome.storage.local/session, localStorage, memory) |
| `packages/ui` | Design system: tokens, components, icon set, logo |
| `packages/types` | Shared types and EIP-1193 error codes |

## Quick start

```bash
npm install
npm run check            # typecheck + never-log-secrets lint + 84 tests
npm run dev:demo         # http://localhost:5397 — interactive demo (simulated chain)
npm run dev:landing      # http://localhost:5398 — website
npm run build:extension  # → apps/extension/dist
npm run build:web        # → apps/landing/dist (landing at /, demo at /demo/)
```

### Load the extension

1. `npm run build:extension`
2. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`), enable **Developer mode**
3. **Load unpacked** → select `apps/extension/dist`
4. The dashboard opens on first install; create or import a wallet.

## Modes and networks

Copy `.env.example` to `.env`. Vite only exposes `VITE_*` keys; **never put API keys in source**.

| Variable | Values | Effect |
| --- | --- | --- |
| `VITE_APP_MODE` | `demo` (default) / `live` | `demo`: simulated chain, demo portfolio, labelled everywhere, nothing broadcast. `live`: real vault, real RPC, real transactions — no mock data is ever mixed in |
| `VITE_NETWORK_MODE` | `testnet` (default) / `mainnet` | Default network for live builds. Testnet first; mainnet is a deliberate choice (Settings → Networks) |
| `VITE_RPC_ROBINHOOD_MAINNET`, `VITE_RPC_ROBINHOOD_TESTNET`, `VITE_RPC_ETHEREUM` | URL | Dedicated RPC providers (ordered before the user's custom RPC and the public fallbacks) |
| `VITE_LIFI_API_URL` | URL | Enables the LI.FI swap/bridge adapter. Unset → no live route provider is claimed |

Networks are defined in [`packages/config/src/chains.ts`](packages/config/src/chains.ts): Robinhood Chain (4663, `https://rpc.mainnet.chain.robinhood.com`, Blockscout) and Robinhood Chain Testnet (46630). Ethereum mainnet is configured only as a bridge source.

## Security model (short version)

- **Self-custodial.** Keys are generated and used on the device. No backend receives keys, phrases, passwords or decrypted vault data — there is no backend.
- **No custom cryptography.** WebCrypto PBKDF2 (600k iterations, random salt) + AES-256-GCM; BIP-39/BIP-32/44 via viem's audited `@scure` libraries.
- **Password never stored.** It derives the vault key; the derived key lives in memory (`chrome.storage.session`, trusted contexts only) while unlocked and is discarded on lock or after the auto-lock window.
- **Background owns secrets.** UI pages talk to the service worker through an allowlisted API; content scripts are stateless bridges; the inpage provider can only ask, never read.
- **Nothing signs without approval.** Every dApp request goes through a queue and an approval screen; transactions are simulated and translated into plain English with risk flags before the user can confirm.
- **Strict CSP.** `script-src 'self'; object-src 'self'` — no eval, no inline scripts, no remote code. `npm run lint` fails the build on any console output in production code or any secret material near a log.

See [SECURITY.md](SECURITY.md) for the full model and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit.

## Honest status

Built and verified in this order (the MVP build order from the brief): extension shell → create/import → encrypted vault → lock/unlock → Robinhood Chain connection → ETH + ERC-20 balances → registry → portfolio → send → receive → activity → dApp provider → permissions → signing → review → Stock Token categorisation → markets → swap/bridge abstractions → security center → mainnet support.

What is real today:

- The vault, keyring, permission model, signing pipeline, review/simulation and dApp provider are exercised by 84 automated tests (vault tampering, wrong passwords, derivation vectors, signature verification, permission isolation, auto-lock, malformed requests, chain mismatch, decimals).
- DEMO mode runs the full application end to end on an in-process simulated chain (send, swap with approval step, bridge with delayed arrival, approvals manager, activity) — every simulated element is labelled.
- LIVE mode uses the real RPC, the real registry and real explorer data; it has been built and typechecked but **not yet exercised against a funded wallet on the testnet**. Do that first, on testnet, before pointing anyone at mainnet.

What is deliberately not claimed:

- **No DEX or bridge integration exists yet.** The `SwapProvider`/`BridgeProvider` adapters are real interfaces; the demo routes are labelled mocks; the LI.FI adapter only activates when `VITE_LIFI_API_URL` is set and only reports routes the API actually returns.
- **No cost basis.** Asset pages show “Cost basis unavailable” until transaction history can establish it reliably.
- **No portfolio history in live mode** (no fabricated charts). The dashboard says so and shows current balances.
- **No NFT gallery, no account abstraction, no hardware wallets, no mobile** — architected for, not built (see build 3 in the brief).
- Blockscout's API sits behind a bot challenge from Node; the wallet falls back to `eth_getLogs` scanning for activity and approvals when the explorer refuses.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run check` | `typecheck` + `lint` + `test` |
| `npm run test` | vitest (node environment) |
| `npm run lint` | never-log-secrets / no-eval scan of all production code |
| `npm run icons` | renders the logo to every PNG size (extension, website, X avatar) with zero dependencies |
| `npm run registry:discover` | rebuilds the verified token list from Pons V2 factory logs + on-chain metadata |
| `npm run audit:deps` | dependency audit; versions are pinned exactly in `package.json`, lockfile committed |

## License

MIT.
