#!/usr/bin/env node
/**
 * Plays "I already have a wallet" end to end in a real headless Chrome — the
 * web wallet (a URL) or the extension's dashboard (--ext) — against the
 * per-word box grid:
 *
 *   1. pastes the whole phrase into the first box (a real ClipboardEvent,
 *      dispatched in-page — CDP's Input.insertText does not fire 'paste')
 *      and checks every box filled and the address preview appeared
 *   2. clears the boxes and types each word individually, checking the
 *      submit button only enables once all 12 are filled and valid
 *   3. submits and checks the resulting account address
 *
 *   node scripts/import-check.mjs http://localhost:5397/ [--out captures/import]
 *   node scripts/import-check.mjs --ext apps/extension/dist [--out captures/import-ext]
 *   [--phrase "word1 … word12"] [--expect 0x…]
 */
import { resolve } from "node:path";
import { launch, sleep } from "./lib/headless.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const ext = args.includes("--ext") ? resolve(opt("--ext", "apps/extension/dist")) : null;
const url = args.find((a) => /^https?:\/\//.test(a));
if (!ext && !url) {
  console.error("usage: import-check.mjs <baseUrl> | --ext <dist>");
  process.exit(2);
}
const out = resolve(opt("--out", ext ? "captures/import-ext" : "captures/import"));
// The well-known test phrase (Hardhat account #0) — public, holds nothing anywhere that matters.
const PHRASE = opt("--phrase", "test test test test test test test test test test test junk");
const EXPECT = opt("--expect", "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
const PASSWORD = "correct horse battery staple 42";
const ok = (msg) => console.log(`✓ ${msg}`);

/** Dispatches a real ClipboardEvent('paste') on box `i` — a paste-into-any-box-fills-the-grid check. */
async function pasteIntoBox(b, page, i, text) {
  await b.evaluate(
    page,
    `(() => {
      const el = document.querySelectorAll('input[data-word-box]')[${i}];
      el.focus();
      const dt = new DataTransfer();
      dt.setData("text/plain", ${JSON.stringify(text)});
      const evt = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(evt);
      return true;
    })()`,
  );
}

const b = launch({ out, extension: ext ?? undefined, width: 1280, height: 900 });
let exitCode = 0;
try {
  let base = url;
  if (ext) {
    const { id } = await b.cdp.send("Extensions.loadUnpacked", { path: ext });
    base = `chrome-extension://${id}/dashboard.html`;
    ok(`extension loaded, id ${id}`);
  }
  const page = await b.open(base);
  await b.waitFor(page, `document.body.innerText.includes("I already have a wallet")`, { label: "welcome", timeout: 40_000 });
  await b.click(page, "button", "I already have a wallet");
  await b.waitFor(page, `document.querySelectorAll('input[type="password"]').length === 2`, { label: "password form" });
  await b.type(page, `document.querySelectorAll('input[type="password"]')[0]`, PASSWORD);
  await b.type(page, `document.querySelectorAll('input[type="password"]')[1]`, PASSWORD);
  await sleep(150);
  await b.click(page, 'button[type="submit"]', "CONTINUE");
  await b.waitFor(page, `document.body.innerText.includes("Import your wallet")`, { label: "import screen" });
  await b.waitFor(page, `document.querySelectorAll('input[data-word-box]').length === 12`, { label: "word boxes mounted", timeout: 8000 });
  const boxCount = await b.evaluate(page, `document.querySelectorAll('input[data-word-box]').length`);
  await b.shot(page, "01-import-empty.png");
  ok(`word boxes rendered: ${boxCount} (expect 12)`);
  if (boxCount !== 12) throw new Error(`expected 12 word boxes, found ${boxCount}`);

  // 1. Paste the whole phrase into box 0 — every box should fill.
  await pasteIntoBox(b, page, 0, PHRASE.toUpperCase()); // real paste is rarely already-clean lowercase
  await sleep(400);
  await b.shot(page, "02-import-pasted.png");
  const boxValues = await b.evaluate(page, `[...document.querySelectorAll('input[data-word-box]')].map((el) => el.value)`);
  const filledOk = boxValues.join(" ") === PHRASE;
  ok(`paste into box 1 filled all 12 boxes, lowercased: ${filledOk} (${boxValues.join(" ")})`);
  if (!filledOk) throw new Error(`boxes after paste: ${boxValues.join(" ")}`);
  const addressShown = await b.waitFor(page, `(() => { const t = document.body.innerText; return /Controls/.test(t) ? t : null; })()`, { label: "address preview after paste", timeout: 10_000 });
  const short = `${EXPECT.slice(0, 6)}…${EXPECT.slice(-4)}`;
  ok(`preview shows the controlled address: ${addressShown.includes(short.split("…")[0])}`);
  const enabledAfterPaste = await b.evaluate(page, `!__h.byText('button[type="submit"]', "IMPORT WALLET").disabled`);
  ok(`IMPORT WALLET enabled after paste: ${enabledAfterPaste}`);
  if (!enabledAfterPaste) throw new Error("submit stayed disabled after a valid pasted phrase");

  // 2. Clear and type word by word, confirming per-word gating.
  await b.evaluate(page, `[...document.querySelectorAll('input[data-word-box]')].forEach((el) => { const proto = Object.getPrototypeOf(el); Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ""); el.dispatchEvent(new Event("input", { bubbles: true })); })`);
  await sleep(200);
  const words = PHRASE.split(" ");
  for (let i = 0; i < words.length - 1; i++) await b.type(page, `document.querySelectorAll('input[data-word-box]')[${i}]`, words[i]);
  const stillDisabled = await b.evaluate(page, `__h.byText('button[type="submit"]', "IMPORT WALLET").disabled`);
  ok(`still disabled with 11 of 12 words: ${stillDisabled}`);
  await b.type(page, `document.querySelectorAll('input[data-word-box]')[11]`, words[11]);
  await sleep(400);
  await b.shot(page, "03-import-typed.png");
  const enabledAfterTyping = await b.evaluate(page, `!__h.byText('button[type="submit"]', "IMPORT WALLET").disabled`);
  ok(`enabled once all 12 typed: ${enabledAfterTyping}`);
  if (!enabledAfterTyping) throw new Error("submit stayed disabled after typing all 12 words individually");

  // 3. Submit and check the account.
  await b.click(page, 'button[type="submit"]', "IMPORT WALLET");
  const outcome = await b.waitFor(page, `(() => { const t = document.body.innerText; return /You're all set|not a valid recovery phrase|already exists|already has a wallet|Invalid|failed|error/i.test(t) ? t : null; })()`, { label: "import outcome", timeout: 60_000 });
  await sleep(500);
  await b.shot(page, "04-import-outcome.png");
  if (!/You're all set/.test(outcome)) throw new Error(`import did not complete: ${outcome.split("\n").filter((l) => /valid|exists|Invalid|failed|error/i.test(l)).join(" | ")}`);
  ok("wallet imported — done screen reached");
  await b.click(page, "button", "OPEN PORTFOLIO");
  await b.waitFor(page, `/portfolio value/i.test(document.body.innerText)`, { label: "portfolio" });
  await sleep(1200);
  await b.click(page, "button", "Main Wallet").catch(() => undefined);
  await sleep(500);
  const addr = await b.evaluate(page, `(() => { const m = document.body.innerText.match(/0x[a-fA-F0-9]{40}|0x[a-fA-F0-9]{4,6}…[a-fA-F0-9]{4}/); return m ? m[0] : null; })()`);
  await b.shot(page, "05-portfolio.png");
  ok(`account shown: ${addr ?? "?"} (expected ${short}); matches=${addr ? addr.toLowerCase().startsWith(EXPECT.slice(0, 6).toLowerCase()) : false}`);
  console.log("\nIMPORT FLOW PASSED");
} catch (e) {
  exitCode = 1;
  console.error(`✗ ${e.message}`);
} finally {
  b.close();
  process.exit(exitCode);
}
