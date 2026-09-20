/**
 * Reads the product identity from packages/config/src/brand.ts without a
 * TypeScript loader, so build scripts run on any Node version (locally and on
 * the deploy host). The brand file stays the single source of truth.
 */
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../packages/config/src/brand.ts", import.meta.url), "utf8");

function field(name) {
  // `name: "value"` — the value may sit on the next line and may contain escaped quotes.
  const re = new RegExp("\\b" + name + ":\\s*\\n?\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
  const m = re.exec(src);
  if (!m) throw new Error(`brand.ts: field "${name}" not found`);
  return m[1].replace(/\\"/g, '"');
}

export const BRAND = {
  name: field("name"),
  displayName: field("displayName"),
  tagline: field("tagline"),
  description: field("description"),
  version: field("version"),
  disclaimer: field("disclaimer"),
};
