import type { Address, OriginPermission } from "@frame/types";
import type { KeyValueStore } from "@frame/storage";
import { sameAddress } from "@frame/chain";

const KEY = "permissions";

/** Validates and canonicalises a web origin. Only http(s) origins can hold permissions. */
export function normalizeOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("Invalid origin.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported origin protocol.");
  return url.origin.toLowerCase();
}

/** Permissions are stored by origin. A site only ever sees the accounts it was granted. */
export class PermissionStore {
  constructor(private readonly store: KeyValueStore) {}

  async list(): Promise<OriginPermission[]> {
    return (await this.store.get<OriginPermission[]>(KEY)) ?? [];
  }

  private async save(list: OriginPermission[]): Promise<void> {
    await this.store.set(KEY, list);
  }

  async get(origin: string): Promise<OriginPermission | undefined> {
    const o = normalizeOrigin(origin);
    return (await this.list()).find((p) => p.origin === o);
  }

  async grant(origin: string, accounts: Address[]): Promise<OriginPermission> {
    const o = normalizeOrigin(origin);
    if (!accounts.length) throw new Error("At least one account is required.");
    const list = await this.list();
    const existing = list.find((p) => p.origin === o);
    const merged: Address[] = existing ? [...existing.accounts] : [];
    for (const a of accounts) if (!merged.some((m) => sameAddress(m, a))) merged.push(a);
    const perm: OriginPermission = {
      origin: o,
      accounts: merged,
      connectedAt: existing?.connectedAt ?? Date.now(),
      lastUsedAt: Date.now(),
      methods: "standard",
    };
    await this.save([...list.filter((p) => p.origin !== o), perm]);
    return perm;
  }

  async revoke(origin: string): Promise<boolean> {
    const o = normalizeOrigin(origin);
    const list = await this.list();
    const next = list.filter((p) => p.origin !== o);
    await this.save(next);
    return next.length !== list.length;
  }

  async revokeAll(): Promise<void> {
    await this.save([]);
  }

  async touch(origin: string): Promise<void> {
    const o = normalizeOrigin(origin);
    const list = await this.list();
    const p = list.find((x) => x.origin === o);
    if (p) {
      p.lastUsedAt = Date.now();
      await this.save(list);
    }
  }

  async hasAccount(origin: string, address: Address): Promise<boolean> {
    const p = await this.get(origin);
    return !!p && p.accounts.some((a) => sameAddress(a, address));
  }

  /** Called when an account is deleted: no origin keeps a grant for it. */
  async removeAccount(address: Address): Promise<void> {
    const list = await this.list();
    const next = list
      .map((p) => ({ ...p, accounts: p.accounts.filter((a) => !sameAddress(a, address)) }))
      .filter((p) => p.accounts.length > 0);
    await this.save(next);
  }
}
