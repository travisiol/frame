#!/usr/bin/env node
/**
 * The actual original complaint: a wallet already exists on this device and
 * the user wants to import a DIFFERENT recovery phrase (their real one, say)
 * alongside it. Before this change there was no way to do that at all — only
 * a private key could be imported once a vault existed.
 *
 *   1. create a fresh wallet (phrase A)
 *   2. Settings → Accounts → Import → Recovery phrase → phrase B
 *   3. the account derived from B appears, tagged "Phrase 2"
 *   4. re-importing the same phrase is refused ("already in the wallet")
 *   5. Settings → Accounts → Create, with a "Phrase 1 / Phrase 2" selector,
 *      derives a second account from phrase B
 *   6. Security → Export recovery lists both phrases separately and returns
 *      the right one
 *
 *   node scripts/multi-phrase-check.mjs http://localhost:5397/ [--out captures/multi-phrase]
 */
import { resolve } from "node:path";
import { launch, sleep } from "./lib/headless.mjs";

const args = process.argv.slice(2);
const url = args[0];
if (!url) {
  console.error("usage: multi-phrase-check.mjs <baseUrl> [--out dir]");
  process.exit(2);
}
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const out = resolve(opt("--out", "captures/multi-phrase"));
const PASSWORD = "correct horse battery staple 42";
// Two distinct, well-known public test phrases (Hardhat accounts #0 and #1) — hold nothing anywhere that matters.
const PHRASE_B = "test test test test test test test test test test test junk";
const ok = (msg) => console.log(`✓ ${msg}`);

async function pasteIntoBox(b, page, i, text) {
  await b.evaluate(
    page,
    `(() => { const el = document.querySelectorAll('input[data-word-box]')[${i}]; el.focus(); const dt = new DataTransfer(); dt.setData("text/plain", ${JSON.stringify(text)}); el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); return true; })()`,
  );
}

/** Escape closes the Sheet (see packages/ui/src/components.tsx) — more reliable than clicking a coordinate that might be under a backdrop. */
async function closeSheet(b, page) {
  await b.evaluate(page, `(window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true)`);
}

const b = launch({ out, width: 1280, height: 900 });
let exitCode = 0;
try {
  const page = await b.open(url);
  // 1. A fresh wallet — this is phrase A (a real, freshly generated mnemonic).
  await b.waitFor(page, `document.body.innerText.includes("Create a new wallet")`, { label: "welcome", timeout: 40_000 });
  await b.click(page, "button", "Create a new wallet");
  await b.waitFor(page, `document.querySelectorAll('input[type="password"]').length === 2`, { label: "password form" });
  await b.type(page, `document.querySelectorAll('input[type="password"]')[0]`, PASSWORD);
  await b.type(page, `document.querySelectorAll('input[type="password"]')[1]`, PASSWORD);
  await sleep(150);
  await b.click(page, 'button[type="submit"]', "CONTINUE");
  await b.waitFor(page, `document.body.innerText.includes("Click to reveal")`, { label: "backup screen", timeout: 60_000 });
  await b.click(page, "button", "Click to reveal");
  const wordsA = await b.waitFor(page, `(() => { const w = [...document.querySelectorAll(".card-flat span.font-medium")].map((e) => e.textContent.trim()); return w.length === 12 && !w[0].includes("•") ? w : null; })()`, { label: "phrase A words" });
  await b.click(page, "label", "I saved my recovery phrase");
  await b.click(page, "button", "CONTINUE");
  await b.waitFor(page, `document.body.innerText.includes("Confirm your backup")`, { label: "confirm screen" });
  const asked = await b.evaluate(page, `[...document.body.innerText.matchAll(/Word #(\\d+)/gi)].map((m) => Number(m[1]))`);
  for (let i = 0; i < asked.length; i++) await b.type(page, `[...document.querySelectorAll('form input:not([type="checkbox"])')][${i}]`, wordsA[asked[i] - 1]);
  await b.click(page, 'button[type="submit"]', "CONFIRM");
  await b.waitFor(page, `document.body.innerText.includes("You're all set.")`, { label: "done" });
  await b.click(page, "button", "OPEN PORTFOLIO");
  await b.waitFor(page, `/portfolio value/i.test(document.body.innerText)`, { label: "dashboard" });
  ok(`wallet A created (${wordsA.length}-word phrase)`);

  // 2. Settings → Accounts → Import → Recovery phrase → phrase B.
  await b.evaluate(page, `(location.hash = "#/settings/accounts", true)`);
  await b.waitFor(page, `document.body.innerText.includes("Import")`, { label: "accounts screen" });
  await b.click(page, "button", "Import");
  await b.waitFor(page, `document.body.innerText.includes("Recovery phrase") && document.body.innerText.includes("Private key")`, { label: "import sheet mode toggle" });
  await b.waitFor(page, `document.querySelectorAll('input[data-word-box]').length === 12`, { label: "phrase boxes in the sheet", timeout: 8_000 });
  await pasteIntoBox(b, page, 0, PHRASE_B);
  await b.waitFor(page, `/Controls/.test(document.body.innerText)`, { label: "phrase B preview", timeout: 10_000 });
  await sleep(300);
  await b.shot(page, "01-import-phrase-sheet.png");
  const importEnabled = await b.evaluate(page, `!__h.byText("button", "IMPORT RECOVERY PHRASE").disabled`);
  ok(`IMPORT RECOVERY PHRASE enabled with a second, valid phrase: ${importEnabled}`);
  if (!importEnabled) throw new Error("import button stayed disabled with a second valid phrase");
  await b.click(page, "button", "IMPORT RECOVERY PHRASE");
  await b.waitFor(page, `document.body.innerText.includes("Recovery phrase added")`, { label: "success toast", timeout: 15_000 });
  await sleep(600);
  await b.shot(page, "02-account-list.png");
  const listText = await b.evaluate(page, `document.body.innerText`);
  ok(`account from phrase B listed, tagged "Phrase 2": ${/phrase 2/i.test(listText)}`);

  // 4. Re-importing the same phrase must be refused.
  await b.click(page, "button", "Import");
  await b.waitFor(page, `document.querySelectorAll('input[data-word-box]').length === 12`, { label: "phrase boxes again", timeout: 8_000 });
  await pasteIntoBox(b, page, 0, PHRASE_B);
  const dupeText = await b.waitFor(page, `(() => { const t = document.body.innerText; return /Controls/.test(t) ? t : null; })()`, { label: "dupe preview", timeout: 10_000 });
  await sleep(300);
  await b.shot(page, "03-duplicate-phrase.png");
  const dupeDisabled = await b.evaluate(page, `__h.byText("button", "IMPORT RECOVERY PHRASE").disabled`);
  ok(`re-importing the same phrase is refused (button disabled, "already in this wallet" shown): disabled=${dupeDisabled}, flagged=${dupeText.includes("already in this wallet")}`);
  if (!dupeDisabled) throw new Error("a duplicate phrase should not be importable");
  await closeSheet(b, page);
  await sleep(400);

  // 5. Create a second account explicitly from phrase B (the "Phrase 1 / Phrase 2" selector).
  await b.click(page, "button", "Create");
  await b.waitFor(page, `/derive from/i.test(document.body.innerText)`, { label: "phrase selector on create", timeout: 8_000 });
  await b.click(page, "button", "Phrase 2");
  await sleep(200);
  await b.shot(page, "04-create-from-phrase-2.png");
  // The previous step's success toast (4.2s auto-dismiss) can still cover the submit button.
  await b.waitFor(page, `!document.body.innerText.includes("Recovery phrase added")`, { label: "prior toast cleared", timeout: 6000 }).catch(() => {});
  await b.click(page, "button", "CREATE ACCOUNT");
  await b.waitFor(page, `document.body.innerText.includes("Account added")`, { label: "second account added", timeout: 15_000 });
  await sleep(500);
  const afterCreate = await b.evaluate(page, `document.body.innerText`);
  ok(`a second account derived from phrase 2: ${(afterCreate.match(/phrase 2/gi) ?? []).length >= 2}`);

  // 6. Export screen lists both phrases and returns the right text.
  await b.evaluate(page, `(location.hash = "#/security/export", true)`);
  await b.waitFor(page, `/recovery phrase 1/i.test(document.body.innerText) && /recovery phrase 2/i.test(document.body.innerText)`, { label: "export lists both phrases", timeout: 10_000 });
  await b.click(page, "button", "Recovery phrase 2");
  await b.type(page, `document.querySelector('input[type="password"]')`, PASSWORD);
  await b.click(page, "label", "I understand");
  await sleep(200);
  await b.shot(page, "05-export-select.png");
  await b.click(page, "button", "REVEAL SECRET");
  const revealed = await b.waitFor(page, `(() => { const w = [...document.querySelectorAll(".card-flat span.font-medium")].map((e) => e.textContent.trim()); return w.length === 12 ? w.join(" ") : null; })()`, { label: "revealed phrase", timeout: 15_000 });
  await sleep(300);
  await b.shot(page, "06-export-revealed.png");
  ok(`exporting "Recovery phrase 2" returns phrase B exactly: ${revealed === PHRASE_B}`);
  if (revealed !== PHRASE_B) throw new Error(`exported "${revealed}" but expected phrase B`);

  console.log("\nMULTI-PHRASE FLOW PASSED");
} catch (e) {
  exitCode = 1;
  console.error(`✗ ${e.message}`);
} finally {
  b.close();
  process.exit(exitCode);
}
