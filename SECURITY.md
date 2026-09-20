# Security model

FRAME is self-custodial. This document is the contract every contributor must keep.

## Non-negotiables

1. **Private keys never leave the device.** No component may transmit a mnemonic, private key, password, derived vault key or decrypted vault. There is no server, no recovery endpoint, no "cloud backup".
2. **No custom cryptography.** Only WebCrypto primitives (`crypto.subtle`) and viem's audited `@scure/bip39` / `@scure/bip32` / `@noble` libraries. Anyone proposing a home-grown primitive gets a `no`.
3. **Nothing signs without explicit user approval** on a screen that explains what is being signed in plain English.
4. **Never log secrets.** `npm run lint` fails on any `console.*` in production code and on any log statement mentioning secret material. Error messages pass through `redact()` before they are displayed or transported.
5. **No hidden access, no developer backdoors, no secret analytics.** Telemetry is opt-in, off by default, and structurally unable to include addresses, balances or secrets.

## Vault

`packages/security/src/vault.ts`

- Password → **PBKDF2-HMAC-SHA-256**, 600 000 iterations, 16-byte random salt → 256-bit key.
- Payload (`{ mnemonic?, hdIndices, imported[] }`) → **AES-256-GCM**, 96-bit random IV, version + KDF parameters bound as additional authenticated data. Tampering with ciphertext *or* KDF parameters fails authentication.
- Only the encrypted blob is persisted (`chrome.storage.local` in the extension, `localStorage` in the web demo).
- The password is never stored. While unlocked, the derived key is held in `chrome.storage.session` (memory-only, `TRUSTED_CONTEXTS` access level) so the service worker can restart without re-prompting; it is deleted on lock and when the auto-lock window elapses.
- Wrong password and tampered blob raise the same `INVALID_PASSWORD` error: the wallet never says which.

## Keys

`packages/wallet-core/src/keyring.ts`

- 12-word BIP-39 English mnemonic (128-bit entropy from `crypto.getRandomValues`) → BIP-32/44 `m/44'/60'/0'/0/i`.
- Imported private keys are validated (`privateKeyToAccount`) and stored inside the same encrypted vault.
- The keyring is the only object that produces signing accounts, and only the `TransactionSigner` receives them. UI code cannot reach either.
- `lock()` drops references; JavaScript cannot guarantee memory scrubbing, so the design never leaves secrets in long-lived structures.

## Extension trust boundaries

```
web page ──window.postMessage──▶ content script ──runtime.Port──▶ background service worker
(inpage provider: asks only)     (stateless relay)                (vault, keys, permissions, queue)
                                                                     ▲ allowlisted API (own pages only)
                                                     popup / dashboard / approval pages
```

- **Origin comes from the browser** (`port.sender.origin`), never from the page.
- The UI API rejects callers that are not the extension's own pages (`sender.id`, `sender.url`).
- Only methods in `WALLET_API_METHODS` are routable; signing methods are never proxied through the read-only RPC channel.
- Permissions are stored **per origin**, listing exactly which accounts a site may see. `eth_accounts` returns `[]` while locked and for unconnected origins. Revoking rejects the site's pending requests and emits `accountsChanged([])`.
- The content script is injected only on `http(s)` pages; `chrome-extension://` and other schemes are refused.
- Content Security Policy: `script-src 'self'; object-src 'self'`. The build script verifies the manifest and refuses inline scripts in the HTML.

## Transactions

`packages/transaction-engine`

1. **Builder** fills gas (with head-room), nonce and EIP-1559 fees; caller-provided values win.
2. **Simulator** runs `eth_call` from the sender; failures are surfaced as `FAILED_SIMULATION`, unavailability as `SIMULATION_UNAVAILABLE` — never hidden.
3. **Reviewer** decodes calldata (ERC-20 transfer/approve, common router swaps, generic calls) into a headline, expected asset changes, permissions (exact vs unlimited) and risk flags. Flags are only raised on **detectable conditions**: unknown contract, unlimited approval, unverified token, new contract, failed simulation, zero address, contract recipient, chain mismatch, low gas. The wording is "unknown", never "scam", unless a trusted risk provider says otherwise.
4. **Signer** signs with the keyring account. Reviews expire after 10 minutes and are dropped on lock.
5. **Broadcaster** submits each signed payload at most once per session; retries never turn into duplicate submissions.

## Web app and same-origin relays

The web app (`apps/web`, served at `/app/`) is the extension's application running in a tab. It keeps the same vault format in the origin's `localStorage` and the session key in `sessionStorage` (per tab). Two Vercel Functions exist only because browsers cannot use the public endpoints reliably:

- `api/rpc.ts` forwards JSON-RPC verbatim to the chain's own RPC — allow-listed chains and methods, `eth_sendRawTransaction` included, nothing else. It sees addresses and signed payloads (what any RPC sees) and never a key, phrase, password or vault.
- `api/market.ts` forwards an allow-listed set of read-only price URLs (Yahoo chart, CoinGecko) and caches them at the edge.

Neither function logs request bodies. The extension does not use them: it talks to the RPCs directly under its `host_permissions`. A custom RPC configured in Settings is always tried before the relay. The web app's security therefore rests on the origin: only install or open FRAME from its official address.

## RPC

- Ordered fallback: dedicated provider (env) → user custom RPC → public endpoint. No silent ranking.
- **Chain-id verification**: a custom RPC is only saved after it reports the configured chain id; a mismatch is refused (`ChainMismatchError`). Transactions carrying another chain id are rejected with 4902.
- Rate limits and outages become "NETWORK CONNECTION ISSUE / Retry / Change RPC", never repeated automatic submissions.

## Tokens

- Verification is by **contract address** in the registry, never by ticker or name. A token named "NVIDIA • Robinhood Token" at an unknown address is shown as **UNVERIFIED** and flagged as impersonating.
- Unsolicited tokens whose names look like spam (URLs, "claim", "bonus", …) are hidden automatically. The wallet never interacts with them and never fetches URLs embedded in token metadata.

## Clipboard

Copying a secret shows a warning. The wallet attempts to clear the clipboard after the configured delay **only if** it can confirm the clipboard still holds what it wrote; it never claims the clipboard was cleared unless that succeeded.

## Reporting

Report vulnerabilities privately to the address in `packages/config/src/brand.ts` (`links.support`). Please do not open public issues for security reports.
