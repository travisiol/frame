#!/usr/bin/env node
/**
 * Builds the extension into apps/extension/dist:
 *   1. pages + background (ES modules)      → vite.config.ts
 *   2. content script (IIFE)                → vite.content.config.ts
 *   3. inpage provider (IIFE)               → vite.inpage.config.ts
 *   4. manifest.json with brand values, icons from public/
 *
 * Load the result in Chrome/Brave/Edge via chrome://extensions → "Load unpacked" → apps/extension/dist
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const root = resolve(app, "../..");
const dist = resolve(app, "dist");

const { BRAND } = await import(new URL("../../../packages/config/src/brand.ts", import.meta.url).href);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

if (!existsSync(resolve(app, "public/icons/icon-128.png"))) {
  console.log("› rendering icons");
  execSync(`node "${resolve(root, "scripts/render-icons.mjs")}"`, { stdio: "inherit", cwd: root });
}

const run = (label, cmd) => {
  console.log(`› ${label}`);
  execSync(cmd, { stdio: "inherit", cwd: app, env: { ...process.env, FORCE_COLOR: "1" } });
};
run("pages + background", "npx vite build");
run("content script", "npx vite build -c vite.content.config.ts");
run("inpage provider", "npx vite build -c vite.inpage.config.ts");

const manifest = readFileSync(resolve(app, "manifest.json"), "utf8")
  .replaceAll("__NAME__", BRAND.name)
  .replaceAll("__DESCRIPTION__", BRAND.description)
  .replaceAll("__VERSION__", BRAND.version);
writeFileSync(resolve(dist, "manifest.json"), manifest);

// Sanity: the CSP must stay strict and nothing may be loaded remotely.
const parsed = JSON.parse(manifest);
if (!/script-src 'self'/.test(parsed.content_security_policy.extension_pages) || /unsafe-eval|http/.test(parsed.content_security_policy.extension_pages)) {
  throw new Error("Manifest CSP is not strict.");
}
for (const f of ["popup.html", "dashboard.html", "approval.html", "background.js", "content.js", "inpage.js", "icons/icon-128.png"]) {
  if (!existsSync(resolve(dist, f))) throw new Error(`Missing build output: ${f}`);
}
const html = readFileSync(resolve(dist, "popup.html"), "utf8");
if (/<script(?![^>]*\bsrc=)[^>]*>[^<]/.test(html)) throw new Error("popup.html contains an inline script — forbidden by the extension CSP.");
console.log(`✓ ${BRAND.name} ${BRAND.version} built → ${dist}`);
