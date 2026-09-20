import { describe, expect, it } from "vitest";
import {
  VAULT_VERSION,
  VaultError,
  assessPassword,
  changeVaultPassword,
  decryptVault,
  decryptVaultWithKey,
  encryptVault,
  isEncryptedVaultBlob,
  looksLikeMnemonic,
  redact,
  safeErrorMessage,
  serializeError,
  verifyPassword,
  type VaultPayload,
} from "../src";

const ITER = 1_000; // tests only — production uses 600k
const MNEMONIC = "test test test test test test test test test test test junk";
const payload: VaultPayload = { version: VAULT_VERSION, mnemonic: MNEMONIC, hdIndices: [0, 1], imported: [{ privateKey: `0x${"ab".repeat(32)}` }] };

describe("EncryptedVault", () => {
  it("round-trips a payload and never stores plaintext", async () => {
    const { blob, keyBits } = await encryptVault(payload, "correct horse battery", { iterations: ITER });
    expect(isEncryptedVaultBlob(blob)).toBe(true);
    expect(keyBits.length).toBe(32);
    const json = JSON.stringify(blob);
    expect(json).not.toContain("junk");
    expect(json).not.toContain("abab");
    const { payload: out } = await decryptVault(blob, "correct horse battery");
    expect(out).toEqual(payload);
  });

  it("rejects a wrong password without leaking why", async () => {
    const { blob } = await encryptVault(payload, "correct horse battery", { iterations: ITER });
    await expect(decryptVault(blob, "wrong")).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
    expect(await verifyPassword(blob, "wrong")).toBe(false);
    expect(await verifyPassword(blob, "correct horse battery")).toBe(true);
  });

  it("uses a fresh random salt and IV per encryption", async () => {
    const a = await encryptVault(payload, "pw12345678", { iterations: ITER });
    const b = await encryptVault(payload, "pw12345678", { iterations: ITER });
    expect(a.blob.kdf.salt).not.toBe(b.blob.kdf.salt);
    expect(a.blob.cipher.iv).not.toBe(b.blob.cipher.iv);
    expect(a.blob.data).not.toBe(b.blob.data);
  });

  it("detects tampering (authenticated encryption)", async () => {
    const { blob } = await encryptVault(payload, "pw12345678", { iterations: ITER });
    const bytes = Buffer.from(blob.data, "base64");
    bytes[5] = (bytes[5]! + 1) & 0xff;
    const tampered = { ...blob, data: bytes.toString("base64") };
    await expect(decryptVault(tampered, "pw12345678")).rejects.toBeInstanceOf(VaultError);
    // Changing KDF params (bound as AAD) also fails authentication.
    const aadTampered = { ...blob, kdf: { ...blob.kdf, iterations: blob.kdf.iterations + 1 } };
    await expect(decryptVault(aadTampered, "pw12345678")).rejects.toBeInstanceOf(VaultError);
  });

  it("decrypts with a cached key and rejects a wrong key", async () => {
    const { blob, keyBits } = await encryptVault(payload, "pw12345678", { iterations: ITER });
    expect((await decryptVaultWithKey(blob, keyBits)).mnemonic).toBe(MNEMONIC);
    const wrong = new Uint8Array(32);
    await expect(decryptVaultWithKey(blob, wrong)).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
  });

  it("changes the password and invalidates the old one", async () => {
    const { blob } = await encryptVault(payload, "old-password", { iterations: ITER });
    const changed = await changeVaultPassword(blob, "old-password", "new-password", { iterations: ITER });
    expect(changed.blob.createdAt).toBe(blob.createdAt);
    expect(await verifyPassword(changed.blob, "old-password")).toBe(false);
    expect((await decryptVault(changed.blob, "new-password")).payload.mnemonic).toBe(MNEMONIC);
    await expect(changeVaultPassword(blob, "nope", "x", { iterations: ITER })).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
  });

  it("refuses empty passwords and malformed blobs", async () => {
    await expect(encryptVault(payload, "", { iterations: ITER })).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    expect(isEncryptedVaultBlob({ version: 1, data: "x" })).toBe(false);
    await expect(decryptVault({ version: 1 } as never, "pw")).rejects.toMatchObject({ code: "CORRUPT_VAULT" });
  });
});

describe("password policy", () => {
  it("scores passwords offline", () => {
    expect(assessPassword("short").ok).toBe(false);
    expect(assessPassword("password").ok).toBe(false);
    expect(assessPassword("aaaaaaaaaa").ok).toBe(false);
    expect(assessPassword("Tr0ub4dor&3xyz").ok).toBe(true);
    expect(assessPassword("correct horse battery staple 2026!").score).toBe(4);
  });
});

describe("redaction", () => {
  it("redacts secrets by key and by shape", () => {
    expect(looksLikeMnemonic(MNEMONIC)).toBe(true);
    const out = redact({ password: "hunter22", nested: { mnemonic: MNEMONIC, note: MNEMONIC, pk: `0x${"ab".repeat(32)}` }, ok: "fine" }) as Record<string, unknown>;
    expect(out.password).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).mnemonic).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).note).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).pk).toBe("[REDACTED]");
    expect(out.ok).toBe("fine");
  });

  it("strips key-like material from error messages", () => {
    const e = new Error(`failed with key 0x${"cd".repeat(32)} at step 2`);
    expect(safeErrorMessage(e)).not.toContain("cdcd");
    const ser = serializeError(Object.assign(new Error("boom"), { code: 4001 }));
    expect(ser).toEqual({ code: 4001, message: "boom" });
  });
});
