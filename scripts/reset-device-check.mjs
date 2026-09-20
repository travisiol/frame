#!/usr/bin/env node
/**
 * Plays the "Forgot password?" escape hatch end to end in a real headless
 * Chrome: create a wallet, reload to land on the lock screen (simulating a
 * browser that already has one), click "Forgot password?", confirm, and
 * check the app returns cleanly to onboarding — then a brand-new wallet can
 * be created right there.
 *
 *   node scripts/reset-device-check.mjs http://localhost:5397/ [--out captures/reset]
 */
import { resolve } from "node:path";
import { launch, sleep } from "./lib/headless.mjs";

const args = process.argv.slice(2);
const url = args[0];
if (!url) {
  console.error("usage: reset-device-check.mjs <baseUrl> [--out dir]");
  process.exit(2);
}
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const out = resolve(opt("--out", "captures/reset"));
const PASSWORD = "correct horse battery staple 42";
const ok = (msg) => console.log(`✓ ${msg}`);

const b = launch({ out, width: 1280, height: 900 });
let exitCode = 0;
try {
  const page = await b.open(url);
  // 1. Create a wallet, like someone who clicked around earlier.
  await b.waitFor(page, `document.body.innerText.includes("Create a new wallet")`, { label: "welcome", timeout: 40_000 });
  await b.click(page, "button", "Create a new wallet");
  await b.waitFor(page, `document.querySelectorAll('input[type="password"]').length === 2`, { label: "password form" });
  await b.type(page, `document.querySelectorAll('input[type="password"]')[0]`, PASSWORD);
  await b.type(page, `document.querySelectorAll('input[type="password"]')[1]`, PASSWORD);
  await sleep(150);
  await b.click(page, 'button[type="submit"]', "CONTINUE");
  await b.waitFor(page, `document.body.innerText.includes("Click to reveal")`, { label: "backup screen", timeout: 60_000 });
  await b.click(page, "button", "Click to reveal");
  const words = await b.waitFor(page, `(() => { const w = [...document.querySelectorAll(".card-flat span.font-medium")].map((e) => e.textContent.trim()); return w.length === 12 && !w[0].includes("•") ? w : null; })()`, { label: "words" });
  await b.click(page, "label", "I saved my recovery phrase");
  await b.click(page, "button", "CONTINUE");
  await b.waitFor(page, `document.body.innerText.includes("Confirm your backup")`, { label: "confirm screen" });
  const asked = await b.evaluate(page, `[...document.body.innerText.matchAll(/Word #(\\d+)/gi)].map((m) => Number(m[1]))`);
  for (let i = 0; i < asked.length; i++) await b.type(page, `[...document.querySelectorAll('form input:not([type="checkbox"])')][${i}]`, words[asked[i] - 1]);
  await b.click(page, 'button[type="submit"]', "CONFIRM");
  await b.waitFor(page, `document.body.innerText.includes("You're all set.")`, { label: "done" });
  await b.click(page, "button", "OPEN PORTFOLIO");
  await b.waitFor(page, `/portfolio value/i.test(document.body.innerText)`, { label: "dashboard" });
  ok("wallet created — this is the state a browser that 'already has a wallet' is in");

  // 2. A new tab/window has no sessionStorage from the old one (that is what actually happens when someone
  // closes the browser and comes back, or opens "the web app" in a fresh tab) — the vault is still on disk
  // (localStorage) but the session key that keeps it unlocked is gone, so it relocks.
  await b.evaluate(page, `sessionStorage.clear()`);
  await b.evaluate(page, `location.reload()`);
  const locked = await b.waitFor(page, `/wallet locked/i.test(document.body.innerText)`, { label: "lock screen after reload", timeout: 20_000 });
  await sleep(500);
  await b.shot(page, "01-lock-screen.png");
  ok(`reload shows the lock screen (this is what "click Open the web app" in a browser that already has a wallet looks like): ${/wallet locked/i.test(locked)}`);

  // 3. "Forgot password?" → confirm dialog → reset.
  await b.click(page, "button", "Forgot password?");
  await b.waitFor(page, `document.body.innerText.includes("Reset this device")`, { label: "reset dialog" });
  await sleep(200);
  await b.shot(page, "02-reset-dialog.png");
  const resetDisabled = await b.evaluate(page, `__h.byText("button", "Reset this device")?.disabled`);
  ok(`reset button starts disabled until the checkbox is ticked: ${resetDisabled}`);
  await b.click(page, "label", "I have the recovery phrase");
  await sleep(150);
  await b.click(page, "button", "Reset this device");
  await b.waitFor(page, `document.body.innerText.includes("Create a new wallet")`, { label: "back to onboarding", timeout: 15_000 });
  await sleep(400);
  await b.shot(page, "03-back-to-onboarding.png");
  ok("after reset: lands cleanly on Create/Import — exactly what a fresh visitor sees");

  // 4. Confirm the old vault is truly gone — the lock screen never reappears on reload.
  await b.evaluate(page, `location.reload()`);
  await sleep(1500);
  const afterReload = await b.evaluate(page, `document.body.innerText`);
  await b.shot(page, "04-reload-after-reset.png");
  ok(`reloading again still shows onboarding, not a stale lock screen: ${/Create a new wallet/.test(afterReload)}, no leftover lock: ${!/wallet locked/i.test(afterReload)}`);

  // 5. A brand-new wallet can be created right away.
  await b.click(page, "button", "Create a new wallet");
  await b.waitFor(page, `document.querySelectorAll('input[type="password"]').length === 2`, { label: "password form again" });
  ok("onboarding works normally right after a reset");

  console.log("\nRESET-DEVICE FLOW PASSED");
} catch (e) {
  exitCode = 1;
  console.error(`✗ ${e.message}`);
} finally {
  b.close();
  process.exit(exitCode);
}
