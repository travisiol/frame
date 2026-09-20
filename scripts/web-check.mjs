#!/usr/bin/env node
/**
 * Drives the web wallet in a real headless Chrome against a base URL (the local
 * dev server or production): watch-only onboarding on a real Robinhood Chain
 * address, the live portfolio, a swap quote, the bridge with balances on the
 * three source chains, markets, networks. Screenshots go to --out.
 *
 *   node scripts/web-check.mjs http://localhost:5397/ [--out captures/web] [--watch 0x…]
 */
import { resolve } from "node:path";
import { launch, sleep } from "./lib/headless.mjs";

const args = process.argv.slice(2);
const url = args[0];
if (!url) {
  console.error("usage: web-check.mjs <baseUrl> [--out dir] [--watch 0x…]");
  process.exit(2);
}
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const out = resolve(opt("--out", "captures/web"));
// A real externally-owned account holding TSLA Stock Tokens (found from Transfer logs; not ours).
const WATCH = opt("--watch", "0x92d435c96e63c43e12d6d0ab28f6b0b04072f765");
const ok = (msg) => console.log(`✓ ${msg}`);
const line = (text, label) => text.split("\n").find((l, i, all) => all[i - 1]?.trim() === label)?.trim() ?? "?";

const b = launch({ out, width: 1440, height: 900 });
let exitCode = 0;
try {
  const page = await b.open(url);
  await b.waitFor(page, `document.body.innerText.includes("Just watch an address instead")`, { label: "welcome", timeout: 40_000 });
  await b.shot(page, "01-welcome.png");
  await b.click(page, "button", "Just watch an address instead");
  await b.waitFor(page, `!!document.querySelector('input[placeholder="0x…"]')`, { label: "watch form" });
  await b.type(page, `document.querySelector('input[placeholder="0x…"]')`, WATCH);
  await b.type(page, `document.querySelector('input[placeholder="Treasury"]')`, "Holder");
  await sleep(200);
  await b.shot(page, "02-watch.png");
  await b.click(page, 'button[type="submit"]', "WATCH ADDRESS");
  await b.waitFor(page, `document.body.innerText.includes("You're all set.")`, { label: "done" });
  await b.click(page, "button", "OPEN PORTFOLIO");
  await b.waitFor(page, `/portfolio value/i.test(document.body.innerText)`, { label: "dashboard" });

  // Balances come from the real chain (Multicall3 over the registry).
  await b.waitFor(page, `/TSLA/.test(document.body.innerText)`, { label: "TSLA balance from chain", timeout: 60_000 });
  await sleep(3000);
  await b.shot(page, "03-portfolio.png");
  const after = await b.evaluate(page, `document.body.innerText`);
  const total = after.match(/\$[\d,]+\.\d\d/)?.[0] ?? "—";
  ok(`portfolio: TSLA row=${/TSLA/.test(after)}, network=${/Robinhood Chain/.test(after)}, total=${total}, price unavailable somewhere=${/unavailable|———/.test(after)}, simulator wording=${/demo|simulated/i.test(after)}`);

  // Swap quote — the watch account cannot sign; a real route from the route provider is what we verify here.
  await b.evaluate(page, `(location.hash = "#/swap", true)`);
  await b.waitFor(page, `/you pay/i.test(document.body.innerText)`, { label: "swap screen" });
  await sleep(800);
  await b.type(page, `document.querySelector('input[placeholder="0"]')`, "1");
  const quote = await b.waitFor(page, `(() => { const t = document.body.innerText; return /LI\\.FI · |No route found|No liquidity source/.test(t) ? t : null; })()`, { label: "swap quote", timeout: 45_000 });
  await sleep(600);
  await b.shot(page, "04-swap-quote.png");
  const route = line(quote, "Route");
  const rate = line(quote, "Rate");
  const step = quote.match(/Step 1 grants[^\n]*/)?.[0] ?? "";
  ok(`swap: ${/LI\.FI · /.test(quote) ? `route ${route} · ${rate} · ${step}` : /No route found/.test(quote) ? "no route returned" : "no provider configured"}`);

  // Bridge — three source chains with live balances, quote from the route provider.
  await b.evaluate(page, `(location.hash = "#/bridge", true)`);
  await b.waitFor(page, `document.body.innerText.includes("Arbitrum One") && document.body.innerText.includes("Base")`, { label: "bridge sources" });
  await sleep(1000);
  await b.type(page, `document.querySelector('input[placeholder="0"]')`, "0.05");
  const bridge = await b.waitFor(page, `(() => { const t = document.body.innerText; return /Best route|No route found|Bridging unavailable/.test(t) ? t : null; })()`, { label: "bridge quote", timeout: 45_000 });
  await sleep(600);
  await b.shot(page, "05-bridge-quote.png");
  ok(`bridge: ${/Best route/.test(bridge) ? `route ${line(bridge, "Best route")} · receive ${line(bridge, "Estimated receive")} · ${line(bridge, "Estimated time")} · fees ${line(bridge, "Fees")}` : /No route found/.test(bridge) ? "no route returned" : "unavailable"}; source balances shown=${(bridge.match(/ ETH/g) ?? []).length >= 3}`);

  // Markets
  await b.evaluate(page, `(location.hash = "#/markets", true)`);
  await b.waitFor(page, `document.body.innerText.includes("NVDA")`, { label: "markets" });
  await sleep(2500);
  await b.shot(page, "06-markets.png");
  const markets = await b.evaluate(page, `document.body.innerText`);
  ok(`markets: verified tokens listed=${/NVDA[\s\S]*AAPL/.test(markets)}, priced=${/\$\d/.test(markets)}, simulator wording=${JSON.stringify(markets.match(/.{0,50}(demo|simulated).{0,50}/i)?.[0] ?? null)}`);

  // Settings → networks shows mainnet active
  await b.evaluate(page, `(location.hash = "#/settings/networks", true)`);
  await sleep(2000);
  const nets = await b.evaluate(page, `document.body.innerText`);
  await b.shot(page, "07-networks.png");
  ok(`networks: mainnet active=${/Robinhood Chain[\s\S]{0,120}Active/i.test(nets)}, testnet offered=${/Testnet/.test(nets)}, rpc=${nets.match(/(https?:\/\/[^\s]+)/)?.[1] ?? "?"}`);
  console.log("\nWEB FLOWS PASSED");
} catch (e) {
  exitCode = 1;
  console.error(`✗ ${e.message}`);
} finally {
  b.close();
  process.exit(exitCode);
}
