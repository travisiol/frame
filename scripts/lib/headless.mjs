/**
 * Headless Chrome over the DevTools pipe — zero dependencies.
 *
 * Used by scripts/ext-check.mjs (loads the extension) and scripts/web-check.mjs
 * (drives the web wallet). Every interaction goes through real input events
 * (Input.dispatchMouseEvent / Input.insertText) so React sees what a user does,
 * and every page is brought to the front so requestAnimationFrame keeps running
 * (background tabs freeze it, which stalls framer-motion transitions).
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export { sleep };

const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

class Pipe {
  constructor(proc) {
    this.proc = proc;
    this.id = 0;
    this.pending = new Map();
    this.buf = Buffer.alloc(0);
    proc.stdio[4].on("data", (chunk) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      let i;
      while ((i = this.buf.indexOf(0)) >= 0) {
        const msg = JSON.parse(this.buf.subarray(0, i).toString("utf8"));
        this.buf = this.buf.subarray(i + 1);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? reject(new Error(`${msg.error.message}${msg.error.data ? ` — ${msg.error.data}` : ""}`)) : resolve(msg.result);
        }
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.proc.stdio[3].write(JSON.stringify(payload) + "\0");
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const HELPERS = `
window.__h = window.__h || {
  byText(sel, text) { return [...document.querySelectorAll(sel)].find((e) => (e.textContent || "").replace(/\\s+/g, " ").trim().includes(text)); },
  text() { return document.body.innerText; },
};
true;`;

/**
 * Starts Chrome and returns a small driver. `extension` (a directory) is loaded
 * unpacked through the Extensions domain, which needs the pipe transport.
 */
export function launch({ out, extension, width = 1280, height = 860 }) {
  mkdirSync(out, { recursive: true });
  const profile = resolve(out, ".profile");
  // A fresh profile every run: the previous run left a vault behind and the wallet would start locked.
  rmSync(profile, { recursive: true, force: true });
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--no-sandbox",
      "--disable-gpu-sandbox",
      "--remote-debugging-pipe",
      ...(extension ? ["--enable-unsafe-extension-debugging"] : []),
      `--user-data-dir=${profile}`,
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--hide-scrollbars",
      `--window-size=${width},${height}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
  );
  const cdp = new Pipe(chrome);

  async function attach(targetId, size) {
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const s = { targetId, sessionId };
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId).catch(() => {});
    if (size) await cdp.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false }, sessionId);
    await front(s);
    return s;
  }

  async function front(s) {
    await cdp.send("Target.activateTarget", { targetId: s.targetId }).catch(() => {});
    await cdp.send("Page.bringToFront", {}, s.sessionId).catch(() => {});
  }

  async function open(url, size) {
    const { targetId } = await cdp.send("Target.createTarget", { url, ...(size ? { width: size.width, height: size.height, newWindow: true } : {}) });
    return attach(targetId, size);
  }

  async function evaluate(s, expression) {
    const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, s.sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  async function waitFor(s, expression, { timeout = 25_000, label = expression } = {}) {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < timeout) {
      try {
        last = await evaluate(s, expression);
        if (last) return last;
      } catch (e) {
        last = e.message;
      }
      await sleep(250);
    }
    const body = await evaluate(s, `document.body.innerText.slice(-700)`).catch(() => "?");
    throw new Error(`timeout: ${label} (last: ${String(last).slice(0, 120)})\n--- page text ---\n${body}`);
  }

  async function shot(s, name) {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, s.sessionId);
    writeFileSync(resolve(out, name), Buffer.from(data, "base64"));
    console.log(`  ✓ ${name}`);
  }

  const helpers = (s) => evaluate(s, HELPERS);

  /** Clicks the centre of the first `sel` element whose text includes `text`, with real mouse events. */
  async function click(s, sel, text) {
    await helpers(s);
    const at = await evaluate(
      s,
      `(() => { const e = __h.byText(${JSON.stringify(sel)}, ${JSON.stringify(text)}); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
    );
    if (!at) throw new Error(`no ${sel} with text "${text}"`);
    await front(s);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y }, s.sessionId);
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", clickCount: 1 }, s.sessionId);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", clickCount: 1 }, s.sessionId);
  }

  /** Focuses the element returned by `elementExpr` and types `text` with real key input. */
  async function type(s, elementExpr, text) {
    await front(s);
    const focused = await evaluate(s, `(() => { const el = ${elementExpr}; if (!el) return false; el.focus(); return document.activeElement === el; })()`);
    if (!focused) throw new Error(`cannot focus ${elementExpr}`);
    await cdp.send("Input.insertText", { text }, s.sessionId);
  }

  async function findTarget(predicate, { timeout = 15_000 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const { targetInfos } = await cdp.send("Target.getTargets");
      const t = targetInfos.find(predicate);
      if (t) return t;
      await sleep(250);
    }
    return null;
  }

  const close = () => chrome.kill();
  return { cdp, open, attach, front, evaluate, waitFor, shot, click, type, helpers, findTarget, close };
}
