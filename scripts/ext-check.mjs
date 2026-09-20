#!/usr/bin/env node
/**
 * Loads the built extension into a real headless Chrome (DevTools pipe +
 * Extensions.loadUnpacked) and plays the real flows end to end:
 *
 *   1. dashboard.html — onboarding: password → recovery phrase → confirm → portfolio
 *   2. popup.html     — the unlocked popup renders the portfolio on Robinhood Chain
 *   3. a local web page discovers FRAME through EIP-6963, reads eth_chainId and
 *      calls eth_requestAccounts; the approval window is approved; the page
 *      receives the account.
 *
 *   node scripts/ext-check.mjs [--out captures/ext] [--dist apps/extension/dist]
 *
 * Zero dependencies. Requires Chrome ≥ 126 (Extensions domain over the pipe).
 */
import { createServer } from "node:http";
import { resolve } from "node:path";
import { launch, sleep } from "./lib/headless.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const dist = resolve(opt("--dist", "apps/extension/dist"));
const out = resolve(opt("--out", "captures/ext"));
const PASSWORD = "correct horse battery staple 42";
const ok = (msg) => console.log(`✓ ${msg}`);

const b = launch({ out, extension: dist });
let server;
let exitCode = 0;
try {
  const version = await b.cdp.send("Browser.getVersion");
  console.log(`Chrome ${version.product}`);
  const { id } = await b.cdp.send("Extensions.loadUnpacked", { path: dist });
  ok(`extension loaded, id ${id}`);
  const base = `chrome-extension://${id}`;

  // 1. onboarding in the dashboard ------------------------------------------------
  const dash = await b.open(`${base}/dashboard.html`);
  await b.waitFor(dash, `document.body.innerText.includes("Create a new wallet")`, { label: "welcome screen" });
  await b.shot(dash, "01-welcome.png");
  await b.click(dash, "button", "Create a new wallet");
  await b.waitFor(dash, `document.querySelectorAll('input[type="password"]').length === 2`, { label: "password form" });
  await b.type(dash, `document.querySelectorAll('input[type="password"]')[0]`, PASSWORD);
  await b.type(dash, `document.querySelectorAll('input[type="password"]')[1]`, PASSWORD);
  await sleep(200);
  await b.shot(dash, "02-password.png");
  await b.click(dash, 'button[type="submit"]', "CONTINUE");
  await b.waitFor(dash, `document.body.innerText.includes("Click to reveal")`, { label: "backup screen", timeout: 60_000 });
  ok("wallet created (PBKDF2 600k + AES-GCM vault)");
  await b.click(dash, "button", "Click to reveal");
  const words = await b.waitFor(dash, `(() => { const w = [...document.querySelectorAll(".card-flat span.font-medium")].map((e) => e.textContent.trim()); return w.length === 12 && !w[0].includes("•") ? w : null; })()`, { label: "12 words" });
  ok(`recovery phrase revealed: ${words.length} words`);
  await b.shot(dash, "03-backup.png");
  await b.click(dash, "label", "I saved my recovery phrase");
  await b.click(dash, "button", "CONTINUE");
  await b.waitFor(dash, `document.body.innerText.includes("Confirm your backup")`, { label: "confirm screen" });
  const asked = await b.evaluate(dash, `[...document.body.innerText.matchAll(/Word #(\\d+)/gi)].map((m) => Number(m[1]))`);
  for (let i = 0; i < asked.length; i++) await b.type(dash, `[...document.querySelectorAll('form input:not([type="checkbox"])')][${i}]`, words[asked[i] - 1]);
  await sleep(150);
  await b.shot(dash, "04-confirm.png");
  await b.click(dash, 'button[type="submit"]', "CONFIRM");
  await b.waitFor(dash, `document.body.innerText.includes("You're all set.")`, { label: "done screen" });
  ok(`backup confirmed with words #${asked.join(", #")}`);
  await sleep(600);
  await b.shot(dash, "05-done.png");
  await b.click(dash, "button", "OPEN PORTFOLIO");
  await b.waitFor(dash, `/portfolio value/i.test(document.body.innerText)`, { label: "dashboard" });
  await sleep(2500);
  const dashText = await b.evaluate(dash, `document.body.innerText`);
  await b.shot(dash, "06-dashboard.png");
  ok(`dashboard on ${/Robinhood Chain/.test(dashText) ? "Robinhood Chain" : "?"}; testnet banner: ${/Testnet — test assets/.test(dashText)}; simulator wording: ${/simulated|demo/i.test(dashText)}`);
  const account = await b.evaluate(dash, `(() => { const m = document.body.innerText.match(/0x[a-fA-F0-9]{40}/); return m ? m[0] : null; })()`);

  // 2. popup -----------------------------------------------------------------------
  const popup = await b.open(`${base}/popup.html`, { width: 380, height: 600 });
  await b.waitFor(popup, `/Portfolio value|PORTFOLIO|Unlock/i.test(document.body.innerText)`, { label: "popup" });
  await sleep(2000);
  await b.shot(popup, "07-popup.png");
  const popupText = await b.evaluate(popup, `document.body.innerText`);
  ok(`popup: unlocked=${/Portfolio value/i.test(popupText)} (session key shared through chrome.storage.session), lock screen=${/Unlock/.test(popupText)}`);

  // 3. dApp connection through the injected provider --------------------------------
  // With the toolbar popup closed, a request opens the dedicated approval window (what a user sees).
  await b.cdp.send("Target.closeTarget", { targetId: popup.targetId });
  await sleep(500);
  server = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><title>FRAME dapp check</title><h1>dapp</h1><script>
      window.__providers = [];
      window.addEventListener("eip6963:announceProvider", (e) => __providers.push(e.detail));
      window.dispatchEvent(new Event("eip6963:requestProvider"));
      window.__go = async () => { try { const p = __providers[0].provider; window.__chain = await p.request({ method: "eth_chainId" }); window.__accounts = await p.request({ method: "eth_requestAccounts" }); } catch (e) { window.__err = String((e && e.message) || e); } };
    </script>`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const dapp = await b.open(`http://127.0.0.1:${port}/`);
  const info = await b.waitFor(dapp, `__providers.length ? JSON.stringify(__providers.map((p) => p.info)) : null`, { label: "EIP-6963 announce" });
  ok(`EIP-6963 providers announced: ${info}`);
  const isMetaMask = await b.evaluate(dapp, `!!__providers[0].provider.isMetaMask`);
  await b.evaluate(dapp, `(window.__go(), true)`);
  const t = await b.findTarget((t) => t.url.includes("approval.html"), { timeout: 8_000 });
  let approval;
  if (t) {
    approval = await b.attach(t.targetId, { width: 380, height: 640 });
    ok("approval window opened by the background service worker");
  } else {
    // Headless Chrome cannot open extension windows: the request waits in the queue and the toolbar popup shows it (the badge counts it).
    approval = await b.open(`${base}/popup.html`, { width: 380, height: 600 });
    ok("headless Chrome opens no windows — the toolbar popup shows the pending request instead");
  }
  await b.waitFor(approval, `document.body.innerText.includes("127.0.0.1")`, { label: "approval shows origin" });
  await sleep(500);
  await b.shot(approval, "08-approval.png");
  const approvalText = await b.evaluate(approval, `document.body.innerText`);
  const label = ["CONNECT", "Connect", "APPROVE", "Approve"].find((l) => approvalText.includes(l));
  await b.click(approval, "button", label);
  const accounts = await b.waitFor(dapp, `window.__accounts ? JSON.stringify(window.__accounts) : null`, { label: "accounts returned to the page" });
  const chain = await b.evaluate(dapp, `window.__chain`);
  ok(`dapp connected: chainId ${chain}, accounts ${accounts}, isMetaMask=${isMetaMask}, matches wallet account: ${account ? accounts.toLowerCase().includes(account.toLowerCase()) : "n/a"}`);
  await b.front(dash);
  await sleep(800);
  await b.shot(dash, "09-dashboard-after-connect.png");
  console.log("\nALL FLOWS PASSED");
} catch (e) {
  exitCode = 1;
  console.error(`✗ ${e.message}`);
} finally {
  server?.close();
  b.close();
  process.exit(exitCode);
}
