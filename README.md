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
| `apps/web` | The same wallet application running in a browser tab on Robinhood Chain (LIVE) — published under `/app/` |
| `apps/landing` | Public website: landing and `/download` (packaged extension, SHA-256, install steps); the web app is published under `/app/` and the same-origin relays under `/api` (`api/rpc.ts`, `api/market.ts`) |
| `packages/wallet-app` | The React application shared by every surface (onboarding, lock, portfolio, asset, send, receive, swap, bridge, markets, activity, security center, settings, dApp approvals) |
| `packages/wallet-core` | `WalletService`: encrypted vault lifecycle, keyring, permissions by origin, dApp request queue, auto-lock, transaction pipeline, in-process chain simulator for the test-suite |
| `packages/security` | WebCrypto vault (PBKDF2-HMAC-SHA-256 → AES-256-GCM), password policy, secret redaction |
| `packages/transaction-engine` | Builder → Simulator → Reviewer → Signer → Broadcaster, calldata decoder, activity normalisation, human-readable errors, signature-request analysis |
| `packages/chain` | viem clients with ordered RPC fallback and chain-id verification, ERC-20 reads/encoders, fee estimation, address safety, formatting |
| `packages/token-registry` | Verified Robinhood Chain tokens (60 Stock/ETF/RWA tokens + USDG + cbBTC), read from the chain, reproducible with `npm run registry:discover` |
| `packages/markets` | `MarketDataProvider`, `SwapProvider`, `BridgeProvider`, `RiskProvider` abstractions; LI.FI adapter (swaps + bridges), live Yahoo/CoinGecko prices, simulator providers for tests |
| `packages/storage` | Key-value storage abstraction (chrome.storage.local/session, localStorage, memory) |
| `packages/ui` | Design system: tokens, components, icon set, logo |
| `packages/types` | Shared types and EIP-1193 error codes |

## Quick start

```bash
npm install
npm run check            # typecheck + never-log-secrets lint + tests
npm run dev:app          # http://localhost:5397 — web wallet (LIVE, Robinhood Chain mainnet, direct RPC)
npm run dev:landing      # http://localhost:5398 — website
npm run build:extension  # → apps/extension/dist
npm run build:web        # → apps/landing/dist (landing at /, /download, web app at /app/, packaged extension at /downloads/)
```

### Load the extension

1. `npm run build:extension`
2. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`), enable **Developer mode**
3. **Load unpacked** → select `apps/extension/dist`
4. The dashboard opens on first install; create or import a wallet.

Or download the packaged build from the website's `/download` page (zip + SHA-256), unzip it and load that folder. `node scripts/ext-check.mjs` loads the build into a headless Chrome and plays onboarding, popup and a dApp connection.

## Modes and networks

Copy `.env.example` to `.env`. Vite only exposes `VITE_*` keys; **never put API keys in source**.

| Variable | Values | Effect |
| --- | --- | --- |
| `VITE_APP_MODE` | `live` (default) / `demo` | `live`: real vault, real RPC, real transactions — no mock data is ever mixed in. `demo`: the in-process simulator the test-suite uses (labelled, nothing broadcast) |
| `VITE_NETWORK_MODE` | `mainnet` (default) / `testnet` | Default network for live builds; the other one is one click away in Settings → Networks |
| `VITE_RPC_ROBINHOOD_MAINNET`, `VITE_RPC_ROBINHOOD_TESTNET`, `VITE_RPC_ETHEREUM`, `VITE_RPC_ARBITRUM`, `VITE_RPC_BASE` | URL | Dedicated RPC providers (ordered before the user's custom RPC, the relay and the public fallbacks) |
| `VITE_LIFI_API_URL` | URL / `off` | Route provider for swaps and bridges (LI.FI public API by default; `off` disables both) |
| `VITE_RPC_RELAY`, `VITE_MARKET_RELAY` | path / `off` | Web app only: same-origin relays (`/api/rpc`, `/api/market` by default in production builds; `off` calls upstreams directly) |

Networks are defined in [`packages/config/src/chains.ts`](packages/config/src/chains.ts): Robinhood Chain (4663, `https://rpc.mainnet.chain.robinhood.com`, Blockscout) and Robinhood Chain Testnet (46630). Ethereum, Arbitrum One and Base are configured only as bridge sources.

## Security model (short version)

- **Self-custodial.** Keys are generated and used on the device. No backend receives keys, phrases, passwords or decrypted vault data — there is no backend.
- **No custom cryptography.** WebCrypto PBKDF2 (600k iterations, random salt) + AES-256-GCM; BIP-39/BIP-32/44 via viem's audited `@scure` libraries.
- **Password never stored.** It derives the vault key; the derived key lives in memory (`chrome.storage.session`, trusted contexts only) while unlocked and is discarded on lock or after the auto-lock window.
- **Background owns secrets.** UI pages talk to the service worker through an allowlisted API; content scripts are stateless bridges; the inpage provider can only ask, never read.
- **Nothing signs without approval.** Every dApp request goes through a queue and an approval screen; transactions are simulated and translated into plain English with risk flags before the user can confirm.
- **Strict CSP.** `script-src 'self'; object-src 'self'` — no eval, no inline scripts, no remote code. `npm run lint` fails the build on any console output in production code or any secret material near a log.
- **Relays see what an RPC sees, nothing more.** The web app's `/api/rpc` and `/api/market` functions forward allow-listed reads and already-signed transactions; keys, phrases and passwords never leave the browser. The extension does not use them.

See [SECURITY.md](SECURITY.md) for the full model and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit.

## Honest status

Built and verified in this order (the MVP build order from the brief): extension shell → create/import → encrypted vault → lock/unlock → Robinhood Chain connection → ETH + ERC-20 balances → registry → portfolio → send → receive → activity → dApp provider → permissions → signing → review → Stock Token categorisation → markets → swap/bridge → security center → mainnet → packaged download + web app.

What is real today:

- The vault, keyring, permission model, signing pipeline, review/simulation, dApp provider, relay allow-lists and environment defaults are covered by 106 automated tests (`npm run check`).
- The extension has been loaded into a real headless Chrome (`node scripts/ext-check.mjs`): onboarding, unlocked popup, EIP-6963 discovery and a dApp `eth_requestAccounts` approved through the approval window, with screenshots.
- The web app (`/app/`) runs LIVE on Robinhood Chain mainnet through the same-origin relays; balances, registry tokens and reference prices come from the real chain and the real price sources. When a reference source is unavailable (Yahoo rate-limits datacenter IPs), the token's own onchain price from LI.FI is shown instead — labelled, and without a fabricated 24h change.
- Swaps and bridges are real routes quoted by LI.FI, which supports Robinhood Chain (Nordstern, KyberSwap, OpenOcean… for swaps; Across, Relay, Layerswap, Symbiosis… for bridges from Ethereum, Arbitrum One and Base). A route is only shown when the API returns one; the wallet simulates and signs the provider's transaction after your approval.

What has not been exercised yet:

- **Broadcasting a real transaction with real funds.** Every step up to and including signing is tested; the final `eth_sendRawTransaction` against mainnet has only run on the in-process simulator. Start with a small amount.
- Blockscout's API sits behind a bot challenge from Node and some browsers; the wallet falls back to `eth_getLogs` scanning for activity and approvals when the explorer refuses.

What is deliberately not claimed:

- **No cost basis.** Asset pages show “Cost basis unavailable” until transaction history can establish it reliably.
- **No portfolio history in live mode** beyond what current balances × price history can reconstruct — the dashboard says so.
- **No NFT gallery, no account abstraction, no hardware wallets, no mobile** — architected for, not built.
- **No Chrome Web Store listing yet.** The download page ships the packaged build with its SHA-256; installing is “Load unpacked”.

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
