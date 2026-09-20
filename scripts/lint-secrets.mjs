#!/usr/bin/env node
/**
 * NEVER LOG rule, enforced.
 *
 * Fails the build when application code contains:
 *   - any console.* call whose arguments mention secret material
 *     (mnemonic, private key, password, vault key, decrypted payload…)
 *   - any console.* call at all in packages/ or apps/ src (production ships
 *     no debugging output) unless the line carries `// lint-allow-console`
 *   - eval / new Function / remote script injection in extension code
 *
 * Usage: node scripts/lint-secrets.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = ["packages", "apps"];
const EXT = new Set([".ts", ".tsx", ".js", ".mjs"]);
const SECRET = /mnemonic|privateKey|private_key|password|passphrase|keyBits|vaultKey|decrypted|seedPhrase|recoveryPhrase|secret/i;
const CONSOLE = /\bconsole\.(log|debug|info|warn|error|trace|table|dir)\s*\(/;
const DANGEROUS = /\beval\s*\(|new\s+Function\s*\(|\.innerHTML\s*=\s*[^"'`\s]|document\.write\s*\(/;

const problems = [];
const warnings = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".vite" || name === "test") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (EXT.has(name.slice(name.lastIndexOf(".")))) lint(full);
  }
}

function lint(file) {
  const rel = relative(root, file).replaceAll("\\", "/");
  if (rel.endsWith(".config.ts") || rel.includes("/scripts/")) return;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const where = `${rel}:${i + 1}`;
    if (CONSOLE.test(line)) {
      if (SECRET.test(line)) problems.push(`${where}: console call mentions secret material → ${line.trim()}`);
      else if (!line.includes("lint-allow-console")) problems.push(`${where}: console call in production code → ${line.trim()}`);
    }
    if (DANGEROUS.test(line) && !line.includes("lint-allow-dangerous")) problems.push(`${where}: dangerous construct → ${line.trim()}`);
    if (/dangerouslySetInnerHTML/.test(line) && !/qr|svg/i.test(lines.slice(Math.max(0, i - 3), i + 3).join(" "))) warnings.push(`${where}: dangerouslySetInnerHTML outside the QR renderer`);
  });
}

for (const d of SCAN) walk(resolve(root, d));

for (const w of warnings) console.warn(`warning: ${w}`);
if (problems.length) {
  for (const p of problems) console.error(`error: ${p}`);
  console.error(`\n${problems.length} problem(s). Secrets must never reach a log; production code ships without console output.`);
  process.exit(1);
}
console.log("✓ lint-secrets: no console output in production code, no secret material in logs, no eval.");
