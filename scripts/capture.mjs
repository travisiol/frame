#!/usr/bin/env node
/**
 * Scroll-through captures of a page with headless Chrome over CDP (zero deps).
 *
 *   node scripts/capture.mjs <url> <outDir> [--step 900] [--width 1440] [--height 900] [--settle 900] [--max 20]
 *
 * Writes <outDir>/shot-<index>-<scrollY>.png for each scroll offset until the
 * bottom of the document (or --max shots). Scroll-driven animations get
 * `--settle` ms to play before each capture.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
const url = args[0];
const outDir = args[1];
if (!url || !outDir) {
  console.error("usage: capture.mjs <url> <outDir> [--step 900] [--width 1440] [--height 900] [--settle 900] [--max 20]");
  process.exit(2);
}
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const step = opt("--step", 900);
const width = opt("--width", 1440);
const height = opt("--height", 900);
const settle = opt("--settle", 900);
const max = opt("--max", 20);
const wait = opt("--wait", 3500);
const port = 9222 + Math.floor(Math.random() * 500);

const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outDir, { recursive: true });
const profile = resolve(outDir, ".profile");
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--no-first-run",
    "--no-sandbox",
    "--disable-gpu-sandbox",
    `--user-data-dir=${profile}`,
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--hide-scrollbars",
    `--window-size=${width},${height}`,
    `--remote-debugging-port=${port}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return r.json();
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("Chrome devtools did not come up");
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

try {
  await waitForDevtools();
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url });
  await sleep(wait);
  const evalNum = async (expr) => Number((await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true })).result.value);
  const docH = await evalNum("document.documentElement.scrollHeight");
  console.log(`document height ${docH}px, viewport ${width}x${height}, step ${step}`);
  let i = 0;
  for (let y = 0; y <= docH - height + 1 && i < max; y += step, i++) {
    await cdp.send("Runtime.evaluate", { expression: `window.scrollTo(0, ${y})` });
    await sleep(settle);
    const actual = await evalNum("window.scrollY");
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    const file = resolve(outDir, `shot-${String(i).padStart(2, "0")}-${Math.round(actual)}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`  ${file}`);
  }
  ws.close();
} finally {
  chrome.kill();
}
