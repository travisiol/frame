import { english, generateMnemonic, mnemonicToAccount, privateKeyToAccount, type HDAccount, type LocalAccount, type PrivateKeyAccount } from "viem/accounts";
import { validateMnemonic } from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english";
import type { Address, Hex } from "@frame/types";
import { looksLikePrivateKey, type VaultPayload, VAULT_VERSION } from "@frame/security";
import { sameAddress } from "@frame/chain";

/**
 * Keyring — holds the DECRYPTED vault payload in memory while the wallet is
 * unlocked and derives signing accounts on demand (BIP-39 → BIP-32/44
 * m/44'/60'/0'/0/i via viem, plus imported private keys). It never
 * serializes secrets except back into the encrypted vault, and it is the
 * only object the signer receives accounts from.
 */
export class Keyring {
  private payload: VaultPayload | null;
  private readonly accountCache = new Map<string, LocalAccount>();

  private constructor(payload: VaultPayload) {
    this.payload = payload;
  }

  static fromPayload(payload: VaultPayload): Keyring {
    return new Keyring({ ...payload, hdIndices: [...payload.hdIndices], imported: payload.imported.map((k) => ({ ...k })) });
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
    return input.trim().toLowerCase().split(/\s+/).join(" ");
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

  get locked(): boolean {
    return this.payload === null;
  }

  get hasMnemonic(): boolean {
    return !!this.payload?.mnemonic;
  }

  private require(): VaultPayload {
    if (!this.payload) throw new Error("Wallet is locked.");
    return this.payload;
  }

  private hdAccount(index: number): HDAccount {
    const p = this.require();
    if (!p.mnemonic) throw new Error("This vault has no recovery phrase.");
    const key = `hd:${index}`;
    const cached = this.accountCache.get(key);
    if (cached) return cached as HDAccount;
    const acct = mnemonicToAccount(p.mnemonic, { addressIndex: index });
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

  hdAddresses(): { index: number; address: Address }[] {
    const p = this.require();
    return p.hdIndices.map((index) => ({ index, address: this.hdAccount(index).address }));
  }

  importedAddresses(): Address[] {
    return this.require().imported.map((k) => this.importedAccount(k.privateKey).address);
  }

  addresses(): Address[] {
    return [...this.hdAddresses().map((a) => a.address), ...this.importedAddresses()];
  }

  /** Next unused HD index (fills gaps, so removed accounts can be re-derived deterministically). */
  addHdAccount(): { index: number; address: Address } {
    const p = this.require();
    if (!p.mnemonic) throw new Error("This vault has no recovery phrase; import an account instead.");
    let index = 0;
    while (p.hdIndices.includes(index)) index++;
    p.hdIndices.push(index);
    return { index, address: this.hdAccount(index).address };
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
    for (const index of p.hdIndices) {
      const a = this.hdAccount(index);
      if (sameAddress(a.address, address)) return a;
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

  exportMnemonic(): string {
    const p = this.require();
    if (!p.mnemonic) throw new Error("This vault has no recovery phrase.");
    return p.mnemonic;
  }

  exportPrivateKey(address: Address): Hex {
    const p = this.require();
    for (const index of p.hdIndices) {
      const a = this.hdAccount(index);
      if (sameAddress(a.address, address)) {
        const raw = a.getHdKey().privateKey;
        if (!raw) throw new Error("Private key unavailable.");
        return `0x${[...raw].map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
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
    return { version: VAULT_VERSION, mnemonic: p.mnemonic, hdIndices: [...p.hdIndices], imported: p.imported.map((k) => ({ ...k })) };
  }

  /** Drops key material. JS cannot guarantee memory is scrubbed, but nothing keeps a reference after this. */
  lock(): void {
    if (this.payload) {
      this.payload.mnemonic = undefined;
      this.payload.imported = [];
      this.payload.hdIndices = [];
    }
    this.payload = null;
    this.accountCache.clear();
  }
}
