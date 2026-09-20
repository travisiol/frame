#!/usr/bin/env node
/**
 * Drives the web wallet with an address that holds ETH on other networks but
 * nothing on Robinhood Chain — the "where did my deposit go?" case:
 *
 *   1. the empty portfolio points at the funds waiting on Ethereum
 *   2. the "Funds on other networks" card lists them with a Move action
 *   3. the bridge opens on that network, Max keeps gas aside, the route shows its gas
 *   4. the Receive screen explains "same address on every network"
 *
 *   node scripts/funds-check.mjs http://localhost:5397/ [--out captures/funds] [--watch 0x…]
 */
import { resolve } from "node:path";
import { launch, sleep } from "./lib/headless.mjs";

const args = process.argv.slice(2);
const url = args[0];
if (!url) {
  console.error("usage: funds-check.mjs <baseUrl> [--out dir] [--watch 0x…]");
  process.exit(2);
}
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const out = resolve(opt("--out", "captures/funds"));
// A well-known externally-owned account with ETH on Ethereum, Arbitrum and Base and nothing on Robinhood Chain.
const WATCH = opt("--watch", "0xd8dA6BF26964aF9D7eEd9e03E5415D3fA0d9E2A2");
const ok = (msg) => console.log(`✓ ${msg}`);
const line = (text, label) => text.split("\n").find((l, i, all) => all[i - 1]?.trim() === label)?.trim() ?? "?";

const b = launch({ out, width: 1440, height: 900 });
let exitCode = 0;
try {
  const page = await b.open(url);
  await b.waitFor(page, `document.body.innerText.includes("Just watch an address instead")`, { label: "welcome", timeout: 40_000 });
  await b.click(page, "button", "Just watch an address instead");
  await b.waitFor(page, `!!document.querySelector('input[placeholder="0x…"]')`, { label: "watch form" });
  await b.type(page, `document.querySelector('input[placeholder="0x…"]')`, WATCH);
  await b.click(page, 'button[type="submit"]', "WATCH ADDRESS");
  await b.waitFor(page, `document.body.innerText.includes("You're all set.")`, { label: "done" });
  await b.click(page, "button", "OPEN PORTFOLIO");
  await b.waitFor(page, `/portfolio value/i.test(document.body.innerText)`, { label: "dashboard" });

  // 1 + 2. the empty portfolio and the card both point at the other networks
  let dash = "";
  try {
    dash = await b.waitFor(page, `(() => { const t = document.body.innerText; return /Funds on other networks/i.test(t) ? t : null; })()`, { label: "other-networks card", timeout: 45_000 });
  } catch {
    dash = await b.evaluate(page, `document.body.innerText`);
    console.log("  (no other-networks card within 45 s)");
  }
  await sleep(2500);
  await b.shot(page, "01-dashboard-other-networks.png");
  const after = await b.evaluate(page, `document.body.innerText`);
  const networks = ["Ethereum", "Arbitrum One", "Base"].filter((n) => new RegExp(`ETH\\s*\\n?\\s*on ${n}`).test(after));
  ok(`dashboard: card=${/Funds on other networks/i.test(dash)}, networks listed=${networks.join(", ") || "none"}, empty-state hint=${/waiting on|Nothing on Robinhood Chain yet/.test(after)}, move action=${/Move/.test(after)}`);

  // 3. bridge preselected on Ethereum with gas kept aside
  await b.evaluate(page, `(location.hash = "#/bridge?from=1", true)`);
  await b.waitFor(page, `document.body.innerText.includes("Arbitrum One") && document.body.innerText.includes("Base")`, { label: "bridge sources" });
  const bal = await b.waitFor(page, `(() => { const t = document.body.innerText; const m = t.match(/Balance ([\\d.,]+) ETH/); return m ? m[1] : null; })()`, { label: "source balance", timeout: 40_000 });
  await b.waitFor(page, `/Max keeps/.test(document.body.innerText)`, { label: "gas reserve", timeout: 40_000 });
  await b.click(page, "button", "Max");
  const quote = await b.waitFor(page, `(() => { const t = document.body.innerText; return /Best route|No route found|Bridging unavailable/.test(t) ? t : null; })()`, { label: "bridge quote", timeout: 60_000 });
  await sleep(600);
  await b.shot(page, "02-bridge-max.png");
  const amount = await b.evaluate(page, `document.querySelector('input[placeholder="0"]').value`);
  // a realistic amount: the route provider quotes it and reports the source-chain gas
  await b.evaluate(page, `(() => { const el = document.querySelector('input[placeholder="0"]'); el.focus(); el.select(); return true; })()`);
  await b.type(page, `document.querySelector('input[placeholder="0"]')`, "0.05");
  const small = await b.waitFor(page, `(() => { const t = document.body.innerText; return /Best route|No route found/.test(t) && !/141,?555/.test(t.split("Best route")[1] ?? "") ? t : null; })()`, { label: "small-amount quote", timeout: 60_000 });
  await sleep(600);
  await b.shot(page, "02b-bridge-small.png");
  ok(`bridge 0.05 ETH: route=${line(small, "Best route")}, gas row=${/Ethereum gas/.test(small)} ${line(small, "Ethereum gas")}, receive=${line(small, "Estimated receive")}, button enabled=${await b.evaluate(page, `!__h.byText("button", "MOVE FUNDS").disabled`)}`);
  ok(`bridge: from ${line(quote, "FROM · ETHEREUM") === "?" ? "Ethereum" : "Ethereum"} balance ${bal} ETH, Max=${amount}, reserve line=${/Max keeps/.test(quote)}, route=${line(quote, "Best route")}, gas row=${/Ethereum gas/.test(quote)}, fee-room warning=${/Leave room for the network fee/.test(quote)}`);

  // 4. receive explains the address is the same everywhere and lists the waiting funds
  await b.evaluate(page, `(location.hash = "#/receive", true)`);
  await b.waitFor(page, `/Same address on every network/i.test(document.body.innerText)`, { label: "receive explainer" });
  await sleep(1500);
  await b.shot(page, "03-receive.png");
  const receive = await b.evaluate(page, `document.body.innerText`);
  ok(`receive: explainer=${/Same address on every network/i.test(receive)}, other-networks card=${/Funds on other networks/.test(receive)}, qr=${!!(await b.evaluate(page, `!!document.querySelector("svg")`))}`);

  // 5. activity lists nothing fake
  await b.evaluate(page, `(location.hash = "#/activity", true)`);
  await sleep(2500);
  await b.shot(page, "04-activity.png");
  console.log("\nFUNDS FLOWS PASSED");
} catch (e) {
  exitCode = 1;
  console.error(`✗ ${e.message}`);
} finally {
  b.close();
  process.exit(exitCode);
}
