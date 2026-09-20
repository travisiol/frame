/**
 * EncryptedVault
 *
 * Password → PBKDF2-HMAC-SHA-256 (random 16-byte salt, 600k iterations)
 *          → 256-bit key → AES-256-GCM (random 96-bit IV, version + KDF
 *            params bound as additional authenticated data)
 *
 * Only WebCrypto primitives are used. Nothing here is home-grown crypto.
 * The password is never stored; the derived key may be held in memory (or
 * in chrome.storage.session, which is memory-only) while the wallet is
 * unlocked, and is discarded on lock.
 */
import type { Hex } from "@frame/types";
import { asBufferSource, fromBase64, randomBytes, toBase64, utf8Decode, utf8Encode, zeroize } from "./bytes";

export const VAULT_VERSION = 1 as const;
/** OWASP (2023) recommendation for PBKDF2-HMAC-SHA256. Tests may pass a lower value explicitly. */
export const DEFAULT_KDF_ITERATIONS = 600_000;
export const MIN_KDF_ITERATIONS = 1_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

export interface VaultKdfParams {
  name: "PBKDF2";
  hash: "SHA-256";
  iterations: number;
  /** base64 */
  salt: string;
}

export interface EncryptedVaultBlob {
  version: typeof VAULT_VERSION;
  kdf: VaultKdfParams;
  cipher: { name: "AES-GCM"; iv: string };
  /** base64 ciphertext + GCM tag */
  data: string;
  createdAt: number;
  updatedAt: number;
}

export interface ImportedKeyEntry {
  privateKey: Hex;
}

/** Decrypted vault contents — the only place secret key material exists in structured form. */
export interface VaultPayload {
  version: typeof VAULT_VERSION;
  /** BIP-39 mnemonic (absent for vaults created from a single imported private key). */
  mnemonic?: string;
  /** Address indices derived from the mnemonic. */
  hdIndices: number[];
  imported: ImportedKeyEntry[];
  /** Additional recovery phrases imported later, each with its own derived indices. */
  phrases?: { mnemonic: string; hdIndices: number[] }[];
}

export type VaultErrorCode = "INVALID_PASSWORD" | "CORRUPT_VAULT" | "UNSUPPORTED_VERSION" | "WEAK_PASSWORD";

export class VaultError extends Error {
  constructor(
    readonly code: VaultErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "VaultError";
  }
}

const subtle = () => globalThis.crypto.subtle;

export function isEncryptedVaultBlob(value: unknown): value is EncryptedVaultBlob {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const kdf = v.kdf as Record<string, unknown> | undefined;
  const cipher = v.cipher as Record<string, unknown> | undefined;
  return (
    v.version === VAULT_VERSION &&
    typeof v.data === "string" &&
    !!kdf &&
    kdf.name === "PBKDF2" &&
    kdf.hash === "SHA-256" &&
    typeof kdf.iterations === "number" &&
    typeof kdf.salt === "string" &&
    !!cipher &&
    cipher.name === "AES-GCM" &&
    typeof cipher.iv === "string"
  );
}

/** Derives the raw 256-bit vault key from a password. The result must be zeroized by the caller when no longer needed. */
export async function deriveKeyBits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  if (iterations < MIN_KDF_ITERATIONS) throw new VaultError("CORRUPT_VAULT", "KDF iterations below minimum");
  const pw = asBufferSource(utf8Encode(password));
  const baseKey = await subtle().importKey("raw", pw, "PBKDF2", false, ["deriveBits"]);
  zeroize(pw);
  const bits = await subtle().deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: asBufferSource(salt), iterations },
    baseKey,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

async function importAesKey(keyBits: Uint8Array): Promise<CryptoKey> {
  if (keyBits.length !== KEY_BITS / 8) throw new VaultError("CORRUPT_VAULT", "Bad key length");
  return subtle().importKey("raw", asBufferSource(keyBits), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function aad(version: number, kdf: VaultKdfParams): Uint8Array<ArrayBuffer> {
  return asBufferSource(utf8Encode(JSON.stringify({ version, kdf })));
}

function validatePayload(payload: VaultPayload): void {
  if (payload.version !== VAULT_VERSION) throw new VaultError("UNSUPPORTED_VERSION");
  if (!Array.isArray(payload.hdIndices) || !Array.isArray(payload.imported)) throw new VaultError("CORRUPT_VAULT");
  if (payload.phrases !== undefined && (!Array.isArray(payload.phrases) || payload.phrases.some((p) => typeof p?.mnemonic !== "string" || !Array.isArray(p.hdIndices)))) {
    throw new VaultError("CORRUPT_VAULT");
  }
}

/** Encrypts a payload with an already-derived key, reusing the KDF params of an existing blob (fresh IV every time). */
export async function encryptVaultWithKey(
  payload: VaultPayload,
  keyBits: Uint8Array,
  kdf: VaultKdfParams,
  createdAt = Date.now(),
): Promise<EncryptedVaultBlob> {
  validatePayload(payload);
  const key = await importAesKey(keyBits);
  const iv = randomBytes(IV_BYTES);
  const plaintext = asBufferSource(utf8Encode(JSON.stringify(payload)));
  const ciphertext = await subtle().encrypt(
    { name: "AES-GCM", iv: asBufferSource(iv), additionalData: aad(VAULT_VERSION, kdf) },
    key,
    plaintext,
  );
  zeroize(plaintext);
  const now = Date.now();
  return {
    version: VAULT_VERSION,
    kdf,
    cipher: { name: "AES-GCM", iv: toBase64(iv) },
    data: toBase64(new Uint8Array(ciphertext)),
    createdAt,
    updatedAt: now,
  };
}

/** Creates a brand-new encrypted vault from a password. Returns the blob and the derived key (caller owns/zeroizes it). */
export async function encryptVault(
  payload: VaultPayload,
  password: string,
  options: { iterations?: number } = {},
): Promise<{ blob: EncryptedVaultBlob; keyBits: Uint8Array }> {
  if (typeof password !== "string" || password.length === 0) throw new VaultError("WEAK_PASSWORD", "Password required");
  const iterations = options.iterations ?? DEFAULT_KDF_ITERATIONS;
  const salt = randomBytes(SALT_BYTES);
  const kdf: VaultKdfParams = { name: "PBKDF2", hash: "SHA-256", iterations, salt: toBase64(salt) };
  const keyBits = await deriveKeyBits(password, salt, iterations);
  const blob = await encryptVaultWithKey(payload, keyBits, kdf);
  return { blob, keyBits };
}

/** Decrypts with an already-derived key (session cache). Throws INVALID_PASSWORD when the key does not authenticate. */
export async function decryptVaultWithKey(blob: EncryptedVaultBlob, keyBits: Uint8Array): Promise<VaultPayload> {
  if (!isEncryptedVaultBlob(blob)) throw new VaultError("CORRUPT_VAULT");
  const key = await importAesKey(keyBits);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await subtle().decrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(fromBase64(blob.cipher.iv)),
        additionalData: aad(blob.version, blob.kdf),
      },
      key,
      asBufferSource(fromBase64(blob.data)),
    );
  } catch {
    // AES-GCM authentication failure: wrong key (wrong password) or tampered blob. Never say which.
    throw new VaultError("INVALID_PASSWORD", "Incorrect password.");
  }
  const bytes = new Uint8Array(plaintext);
  let payload: VaultPayload;
  try {
    payload = JSON.parse(utf8Decode(bytes)) as VaultPayload;
  } catch {
    throw new VaultError("CORRUPT_VAULT");
  } finally {
    zeroize(bytes);
  }
  validatePayload(payload);
  return payload;
}

/** Decrypts with a password. Returns the payload and the derived key so the caller can cache it for the unlocked session. */
export async function decryptVault(
  blob: EncryptedVaultBlob,
  password: string,
): Promise<{ payload: VaultPayload; keyBits: Uint8Array }> {
  if (!isEncryptedVaultBlob(blob)) throw new VaultError("CORRUPT_VAULT");
  const keyBits = await deriveKeyBits(password, fromBase64(blob.kdf.salt), blob.kdf.iterations);
  try {
    const payload = await decryptVaultWithKey(blob, keyBits);
    return { payload, keyBits };
  } catch (e) {
    zeroize(keyBits);
    throw e;
  }
}

/** True when the password decrypts the vault. Never logs, never throws for a wrong password. */
export async function verifyPassword(blob: EncryptedVaultBlob, password: string): Promise<boolean> {
  try {
    const { keyBits } = await decryptVault(blob, password);
    zeroize(keyBits);
    return true;
  } catch (e) {
    if (e instanceof VaultError && e.code === "INVALID_PASSWORD") return false;
    throw e;
  }
}

/** Re-encrypts the vault under a new password (new salt, fresh key). */
export async function changeVaultPassword(
  blob: EncryptedVaultBlob,
  currentPassword: string,
  newPassword: string,
  options: { iterations?: number } = {},
): Promise<{ blob: EncryptedVaultBlob; keyBits: Uint8Array }> {
  const { payload, keyBits: oldKey } = await decryptVault(blob, currentPassword);
  zeroize(oldKey);
  const result = await encryptVault(payload, newPassword, { iterations: options.iterations ?? blob.kdf.iterations });
  return { blob: { ...result.blob, createdAt: blob.createdAt }, keyBits: result.keyBits };
}
