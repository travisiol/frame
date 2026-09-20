import type { SerializedError } from "@frame/types";

/**
 * Redaction helpers — the last line of defence of the NEVER LOG rule.
 *
 * Anything that reaches a log, an error report or a UI error message goes
 * through redact()/safeErrorMessage(). Keys that look like secrets are
 * replaced; strings that look like private keys or recovery phrases are
 * replaced even when they sit under an innocent key.
 */

const SECRET_KEY = /mnemonic|seed|phrase|private|secret|password|passphrase|vaultkey|keybits|decrypted|signature/i;
const PRIVATE_KEY_LIKE = /\b(?:0x)?[0-9a-fA-F]{64}\b/g;
const REDACTED = "[REDACTED]";

/** Lowercase, accents stripped, anything that is not a letter becomes a space (numbering, commas, line breaks). */
export function normalizeMnemonicText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/** Heuristic: 12/15/18/21/24 lowercase words of 3–8 letters → treat as a recovery phrase. */
export function looksLikeMnemonic(value: string): boolean {
  const words = normalizeMnemonicText(value).split(" ").filter(Boolean);
  if (![12, 15, 18, 21, 24].includes(words.length)) return false;
  return words.every((w) => /^[a-z]{3,8}$/.test(w));
}

export function looksLikePrivateKey(value: string): boolean {
  return /^(?:0x)?[0-9a-fA-F]{64}$/.test(value.trim());
}

export function redactString(value: string): string {
  if (looksLikeMnemonic(value) || looksLikePrivateKey(value)) return REDACTED;
  return value.replace(PRIVATE_KEY_LIKE, REDACTED);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth]";
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object" || value === null) return value;
  if (value instanceof Uint8Array) return `[bytes ${value.length}]`;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

export function safeErrorMessage(err: unknown, fallback = "Something went wrong."): string {
  if (err instanceof Error) return redactString(err.message) || fallback;
  if (typeof err === "string") return redactString(err) || fallback;
  if (typeof err === "object" && err !== null && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return redactString(m) || fallback;
  }
  return fallback;
}

/** Serializes an error for transport (extension messaging) without stack traces or secrets. */
export function serializeError(err: unknown, fallbackCode = -32603): SerializedError {
  const code =
    typeof err === "object" && err !== null && typeof (err as { code?: unknown }).code === "number"
      ? (err as { code: number }).code
      : fallbackCode;
  const data =
    typeof err === "object" && err !== null && "data" in err ? redact((err as { data?: unknown }).data) : undefined;
  return { code, message: safeErrorMessage(err), ...(data !== undefined ? { data } : {}) };
}
