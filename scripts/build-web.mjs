#!/usr/bin/env node
/**
 * Builds the public website into apps/landing/dist (what Vercel serves):
 *   /            landing + /download page
 *   /app/        the web wallet (LIVE, Robinhood Chain mainnet)
 *   /downloads/  the packaged extension (zip + latest.json with size and SHA-256)
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND } from "./brand.mjs";
import { zipDirectory } from "./zip.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (label, cmd, cwd) => {
  console.log(`› ${label}`);
  execSync(cmd, { stdio: "inherit", cwd, env: { ...process.env, FORCE_COLOR: "1" } });
};

if (!existsSync(resolve(root, "apps/landing/public/icons/icon-512.png"))) run("icons", "node scripts/render-icons.mjs", root);
run("extension", "node scripts/build.mjs", resolve(root, "apps/extension"));
run("landing", "npx vite build", resolve(root, "apps/landing"));

// Package the extension exactly as built — the download page shows this file's size and checksum.
const zip = zipDirectory(resolve(root, "apps/extension/dist"));
const file = `${BRAND.name.toLowerCase()}-${BRAND.version}-extension.zip`;
const downloads = resolve(root, "apps/landing/dist/downloads");
mkdirSync(downloads, { recursive: true });
writeFileSync(resolve(downloads, file), zip);
const sha256 = createHash("sha256").update(zip).digest("hex");
writeFileSync(
  resolve(downloads, "latest.json"),
  JSON.stringify({ name: BRAND.name, version: BRAND.version, file: `/downloads/${file}`, bytes: zip.length, sha256, minChrome: 116, builtAt: new Date().toISOString() }, null, 2),
);
console.log(`› packaged ${file} (${zip.length} bytes, sha256 ${sha256.slice(0, 16)}…)`);

run("web app", "npx vite build", resolve(root, "apps/web"));
const app = resolve(root, "apps/landing/dist/app");
rmSync(app, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
cpSync(resolve(root, "apps/web/dist"), app, { recursive: true });
console.log("✓ website built → apps/landing/dist (landing at /, web app at /app/, extension at /downloads/)");
