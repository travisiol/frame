#!/usr/bin/env node
/**
 * Builds the public website: landing at / and the interactive demo at /demo/.
 * Output: apps/landing/dist (what Vercel serves — see vercel.json).
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (label, cmd, cwd) => {
  console.log(`› ${label}`);
  execSync(cmd, { stdio: "inherit", cwd, env: { ...process.env, FORCE_COLOR: "1" } });
};

if (!existsSync(resolve(root, "apps/landing/public/icons/icon-512.png"))) run("icons", "node scripts/render-icons.mjs", root);
run("landing", "npx vite build", resolve(root, "apps/landing"));
run("demo", "npx vite build", resolve(root, "apps/demo"));

const out = resolve(root, "apps/landing/dist/demo");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(resolve(root, "apps/demo/dist"), out, { recursive: true });
console.log("✓ website built → apps/landing/dist (landing at /, demo at /demo/)");
