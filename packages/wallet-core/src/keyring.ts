import { english, generateMnemonic, mnemonicToAccount, privateKeyToAccount, type HDAccount, type LocalAccount, type PrivateKeyAccount } from "viem/accounts";
import { validateMnemonic } from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english";
import type { Address, Hex, MnemonicPreview } from "@frame/types";
import { looksLikePrivateKey, normalizeMnemonicText, type VaultPayload, VAULT_VERSION } from "@frame/security";
import { sameAddress } from "@frame/chain";

/**
 * Keyring — holds the DECRYPTED vault payload in memory while the wallet is
 * unlocked and derives signing accounts on demand (BIP-39 → BIP-32/44
 * m/44'/60'/0'/0/i via viem, plus imported private keys). It never
 * serializes secrets except back into the encrypted vault, and it is the
 * only object the signer receives accounts from.
 *
 * A vault can hold more than one recovery phrase (someone importing an older
 * wallet keeps using it alongside a new one, under the same password).
 * `payload.mnemonic` is phrase 0; `payload.phrases[i]` is phrase `i + 1`.
 * Callers refer to a phrase by that 0-based index; 0 is the common case and
 * is never shown in the UI as "Phrase 1" — it is just "the recovery phrase".
 */
export class Keyring {
  private payload: VaultPayload | null;
  private readonly accountCache = new Map<string, LocalAccount>();

  private constructor(payload: VaultPayload) {
    this.payload = payload;
  }

  static fromPayload(payload: VaultPayload): Keyring {
    return new Keyring({
      ...payload,
      hdIndices: [...payload.hdIndices],
      imported: payload.imported.map((k) => ({ ...k })),
      phrases: payload.phrases?.map((p) => ({ mnemonic: p.mnemonic, hdIndices: [...p.hdIndices] })),
    });
  }

  /** New wallet: 12-word English mnemonic (128-bit entropy) with one HD account. */
  static create(): { keyring: Keyring; mnemonic: string } {
    const mnemonic = generateMnemonic(english, 128);
    return { keyring: new Keyring({ version: VAULT_VERSION, mnemonic, hdIndices: [0], imported: [] }), mnemonic };
  }

  static fromMnemonic(input: string): Keyring {
    const mnemonic = Keyring.normalizeMnemonic(input);
    if (!Keyring.isValidMnemonic(mnemonic)) throw new Error("Invalid recovery phrase.");
    return new Keyring({ version: VAULT_VERSION, mnemonic, hdIndices: [0], imported: [] });
  }

  static fromPrivateKey(input: string): Keyring {
    const pk = Keyring.normalizePrivateKey(input);
    return new Keyring({ version: VAULT_VERSION, hdIndices: [], imported: [{ privateKey: pk }] });
  }

  static normalizeMnemonic(input: string): string {
    return normalizeMnemonicText(input);
  }

  static isValidMnemonic(mnemonic: string): boolean {
    try {
      return validateMnemonic(Keyring.normalizeMnemonic(mnemonic), englishWordlist);
    } catch {
      return false;
    }
  }

  static normalizePrivateKey(input: string): Hex {
    const v = input.trim();
    if (!looksLikePrivateKey(v)) throw new Error("Invalid private key. Expected 64 hexadecimal characters.");
    const hex = (v.startsWith("0x") ? v : `0x${v}`).toLowerCase() as Hex;
    // Reject the zero key and keys outside the curve order (privateKeyToAccount throws for those).
    privateKeyToAccount(hex);
    return hex;
  }

  /**
   * Reads a typed phrase without any wallet state: how many words, which
   * ones are not in the BIP-39 list (with position), whether the checksum
   * holds, and the address it would control. `alreadyControls` lets the
   * caller flag a phrase that is already in this wallet.
   */
  static previewMnemonic(input: string, alreadyControls?: (address: Address) => boolean): MnemonicPreview {
    const words = normalizeMnemonicText(input).split(" ").filter(Boolean);
    const wordCount = words.length;
    const invalidWords = words.map((word, i) => ({ position: i + 1, word })).filter(({ word }) => !englishWordlist.includes(word));
    if (invalidWords.length > 0 || ![12, 15, 18, 21, 24].includes(wordCount)) {
      return { wordCount, valid: false, invalidWords, checksumFailed: false, alreadyInWallet: false };
    }
    const mnemonic = words.join(" ");
    if (!validateMnemonic(mnemonic, englishWordlist)) {
      return { wordCount, valid: false, invalidWords: [], checksumFailed: true, alreadyInWallet: false };
    }
    const address = mnemonicToAccount(mnemonic, { addressIndex: 0 }).address;
    return { wordCount, valid: true, address, invalidWords: [], checksumFailed: false, alreadyInWallet: alreadyControls?.(address) ?? false };
  }

  get locked(): boolean {
    return this.payload === null;
  }

  get hasMnemonic(): boolean {
    return !!this.payload?.mnemonic;
  }

  /** Number of recovery phrases in this vault (0 for a wallet made only of imported keys). */
  get phraseCount(): number {
    const p = this.payload;
    if (!p) return 0;
    return (p.mnemonic ? 1 : 0) + (p.phrases?.length ?? 0);
  }

  private require(): VaultPayload {
    if (!this.payload) throw new Error("Wallet is locked.");
    return this.payload;
  }

  /** Mnemonic text for phrase `n` (0 = the vault's primary phrase). */
  private phraseMnemonic(n: number): string {
    const p = this.require();
    if (n === 0) {
      if (!p.mnemonic) throw new Error("This vault has no recovery phrase.");
      return p.mnemonic;
    }
    const extra = p.phrases?.[n - 1];
    if (!extra) throw new Error("This wallet has no such recovery phrase.");
    return extra.mnemonic;
  }

  /** The mutable HD-index list for phrase `n` — pushing into it persists via toPayload(). */
  private phraseIndices(n: number): number[] {
    const p = this.require();
    if (n === 0) {
      if (!p.mnemonic) throw new Error("This vault has no recovery phrase.");
      return p.hdIndices;
    }
    const extra = p.phrases?.[n - 1];
    if (!extra) throw new Error("This wallet has no such recovery phrase.");
    return extra.hdIndices;
  }

  private hdAccount(index: number, phrase = 0): HDAccount {
    const mnemonic = this.phraseMnemonic(phrase);
    const key = `hd:${phrase}:${index}`;
    const cached = this.accountCache.get(key);
    if (cached) return cached as HDAccount;
    const acct = mnemonicToAccount(mnemonic, { addressIndex: index });
    this.accountCache.set(key, acct);
    return acct;
  }

  private importedAccount(privateKey: Hex): PrivateKeyAccount {
    const key = `pk:${privateKey.slice(-8)}`;
    const cached = this.accountCache.get(key);
    if (cached) return cached as PrivateKeyAccount;
    const acct = privateKeyToAccount(privateKey);
    this.accountCache.set(key, acct);
    return acct;
  }

  hdAddresses(phrase = 0): { index: number; address: Address }[] {
    return this.phraseIndices(phrase).map((index) => ({ index, address: this.hdAccount(index, phrase).address }));
  }

  importedAddresses(): Address[] {
    return this.require().imported.map((k) => this.importedAccount(k.privateKey).address);
  }

  /** Every address this keyring controls, across every phrase and every imported key. */
  addresses(): Address[] {
    const p = this.require();
    const phrases = (p.mnemonic ? [0] : []).concat((p.phrases ?? []).map((_, i) => i + 1));
    return [...phrases.flatMap((n) => this.hdAddresses(n).map((a) => a.address)), ...this.importedAddresses()];
  }

  /** Next unused HD index within `phrase` (fills gaps, so removed accounts can be re-derived deterministically). */
  addHdAccount(phrase = 0): { index: number; address: Address } {
    const indices = this.phraseIndices(phrase);
    let index = 0;
    while (indices.includes(index)) index++;
    indices.push(index);
    return { index, address: this.hdAccount(index, phrase).address };
  }

  /**
   * Adds another recovery phrase to this vault. If the vault has no primary
   * phrase yet (it was created from a single imported private key), this
   * phrase becomes the primary one (phrase 0); otherwise it is appended.
   * Returns which phrase index it became and its first (index 0) address —
   * the caller is responsible for checking that address is not already in
   * the wallet before calling this (Keyring itself has no account list).
   */
  importMnemonic(input: string): { phrase: number; address: Address } {
    const p = this.require();
    const mnemonic = Keyring.normalizeMnemonic(input);
    if (!Keyring.isValidMnemonic(mnemonic)) throw new Error("Invalid recovery phrase.");
    if (!p.mnemonic) {
      p.mnemonic = mnemonic;
      p.hdIndices = [0];
      return { phrase: 0, address: this.hdAccount(0, 0).address };
    }
    p.phrases = p.phrases ?? [];
    const phrase = p.phrases.length + 1;
    p.phrases.push({ mnemonic, hdIndices: [0] });
    return { phrase, address: this.hdAccount(0, phrase).address };
  }

  importPrivateKey(input: string): Address {
    const p = this.require();
    const pk = Keyring.normalizePrivateKey(input);
    const address = this.importedAccount(pk).address;
    if (this.addresses().some((a) => sameAddress(a, address))) throw new Error("This account is already in the wallet.");
    p.imported.push({ privateKey: pk });
    return address;
  }

  removeImported(address: Address): boolean {
    const p = this.require();
    const before = p.imported.length;
    p.imported = p.imported.filter((k) => !sameAddress(this.importedAccount(k.privateKey).address, address));
    return p.imported.length !== before;
  }

  /** Signing account for an address this keyring controls. */
  getAccount(address: Address): LocalAccount {
    const p = this.require();
    const phrases = (p.mnemonic ? [0] : []).concat((p.phrases ?? []).map((_, i) => i + 1));
    for (const phrase of phrases) {
      for (const index of this.phraseIndices(phrase)) {
        const a = this.hdAccount(index, phrase);
        if (sameAddress(a.address, address)) return a;
      }
    }
    for (const k of p.imported) {
      const a = this.importedAccount(k.privateKey);
      if (sameAddress(a.address, address)) return a;
    }
    throw new Error("This account cannot sign (not controlled by this wallet).");
  }

  controls(address: Address): boolean {
    try {
      this.getAccount(address);
      return true;
    } catch {
      return false;
    }
  }

  /** Recovery phrase `n` (0 = primary). */
  exportMnemonic(phrase = 0): string {
    return this.phraseMnemonic(phrase);
  }

  exportPrivateKey(address: Address): Hex {
    const p = this.require();
    const phrases = (p.mnemonic ? [0] : []).concat((p.phrases ?? []).map((_, i) => i + 1));
    for (const phrase of phrases) {
      for (const index of this.phraseIndices(phrase)) {
        const a = this.hdAccount(index, phrase);
        if (sameAddress(a.address, address)) {
          const raw = a.getHdKey().privateKey;
          if (!raw) throw new Error("Private key unavailable.");
          return `0x${[...raw].map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
        }
      }
    }
    for (const k of p.imported) {
      if (sameAddress(this.importedAccount(k.privateKey).address, address)) return k.privateKey;
    }
    throw new Error("This account is not controlled by this wallet.");
  }

  /** Snapshot for re-encryption. */
  toPayload(): VaultPayload {
    const p = this.require();
    return {
      version: VAULT_VERSION,
      mnemonic: p.mnemonic,
      hdIndices: [...p.hdIndices],
      imported: p.imported.map((k) => ({ ...k })),
      phrases: p.phrases?.map((x) => ({ mnemonic: x.mnemonic, hdIndices: [...x.hdIndices] })),
    };
  }

  /** Drops key material. JS cannot guarantee memory is scrubbed, but nothing keeps a reference after this. */
  lock(): void {
    if (this.payload) {
      this.payload.mnemonic = undefined;
      this.payload.imported = [];
      this.payload.hdIndices = [];
      this.payload.phrases = [];
    }
    this.payload = null;
    this.accountCache.clear();
  }
}
