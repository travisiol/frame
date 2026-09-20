/**
 * Storage abstraction.
 *
 * The wallet core never touches a concrete storage API: it receives a
 * `KeyValueStore` for persistent data (encrypted vault, account metadata,
 * settings, permissions) and one for session data (the derived vault key
 * while unlocked). The extension wires chrome.storage.local / .session, the
 * web demo wires localStorage / memory.
 */
export interface KeyValueStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

/** In-memory store — tests, demo, and the extension's fallback when chrome.storage.session is unavailable. */
export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    // Structured clone so callers cannot mutate stored state by reference.
    this.map.set(key, structuredClone(value));
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }
  async clear(): Promise<void> {
    this.map.clear();
  }
}

/** Wrapper over window.localStorage / sessionStorage (web demo only). */
export class WebStorageStore implements KeyValueStore {
  constructor(
    private readonly storage: Storage,
    private readonly prefix = "frame:",
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const raw = this.storage.getItem(this.prefix + key);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.storage.setItem(this.prefix + key, JSON.stringify(value));
  }
  async remove(key: string): Promise<void> {
    this.storage.removeItem(this.prefix + key);
  }
  async keys(): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const k = this.storage.key(i);
      if (k && k.startsWith(this.prefix)) out.push(k.slice(this.prefix.length));
    }
    return out;
  }
  async clear(): Promise<void> {
    for (const k of await this.keys()) this.storage.removeItem(this.prefix + k);
  }
}

/** Minimal surface of chrome.storage.StorageArea we rely on (kept structural so tests can stub it). */
export interface ChromeStorageAreaLike {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
}

/** chrome.storage.local (persistent) or chrome.storage.session (memory-only, cleared when the browser closes). */
export class ChromeStorageStore implements KeyValueStore {
  constructor(
    private readonly area: ChromeStorageAreaLike,
    private readonly prefix = "frame:",
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const res = await this.area.get(this.prefix + key);
    return res[this.prefix + key] as T | undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    await this.area.set({ [this.prefix + key]: value });
  }
  async remove(key: string): Promise<void> {
    await this.area.remove(this.prefix + key);
  }
  async keys(): Promise<string[]> {
    const all = await this.area.get(null);
    return Object.keys(all)
      .filter((k) => k.startsWith(this.prefix))
      .map((k) => k.slice(this.prefix.length));
  }
  async clear(): Promise<void> {
    const ks = await this.keys();
    if (ks.length) await this.area.remove(ks.map((k) => this.prefix + k));
  }
}

/** Scopes a store under a sub-prefix (e.g. one namespace per chain). */
export class NamespacedStore implements KeyValueStore {
  constructor(
    private readonly base: KeyValueStore,
    private readonly ns: string,
  ) {}
  private k(key: string) {
    return `${this.ns}/${key}`;
  }
  get<T>(key: string) {
    return this.base.get<T>(this.k(key));
  }
  set<T>(key: string, value: T) {
    return this.base.set(this.k(key), value);
  }
  remove(key: string) {
    return this.base.remove(this.k(key));
  }
  async keys() {
    const p = `${this.ns}/`;
    return (await this.base.keys()).filter((k) => k.startsWith(p)).map((k) => k.slice(p.length));
  }
  async clear() {
    for (const k of await this.keys()) await this.remove(k);
  }
}
