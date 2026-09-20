/**
 * Inpage provider — injected into every page by the content script.
 *
 * Implements EIP-1193 (request / events) and EIP-6963 (provider discovery).
 * It holds NO wallet state beyond the last known chain id and accounts, and
 * it can only talk to the content script through window.postMessage. The
 * page can never reach the extension's storage, keys or background directly.
 */
import { CONTENT_TARGET, INPAGE_TARGET, type ProviderEventName, type ProviderRequestMessage } from "./shared/protocol";

declare const __FRAME_NAME__: string;
declare const __FRAME_RDNS__: string;
declare const __FRAME_ICON__: string;
declare const __FRAME_VERSION__: string;

type Listener = (...args: unknown[]) => void;

class ProviderRpcError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "ProviderRpcError";
    this.code = code;
    this.data = data;
  }
}

class FrameProvider {
  readonly isFrame = true;
  /** Never claim to be another wallet. */
  readonly isMetaMask = false;
  chainId: string | null = null;
  selectedAddress: string | null = null;
  private connected = false;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private seq = 0;

  constructor() {
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data as { target?: string; id?: string; event?: ProviderEventName; result?: unknown; error?: { code: number; message: string; data?: unknown }; data?: unknown } | null;
      if (!data || data.target !== INPAGE_TARGET) return;
      if (typeof data.id === "string") {
        const p = this.pending.get(data.id);
        if (!p) return;
        this.pending.delete(data.id);
        if (data.error) p.reject(new ProviderRpcError(data.error.code, data.error.message, data.error.data));
        else p.resolve(data.result);
        return;
      }
      if (data.event) this.handleEvent(data.event, data.data);
    });
    void this.bootstrap();
  }

  private async bootstrap() {
    try {
      const chainId = (await this.request({ method: "eth_chainId" })) as string;
      this.chainId = chainId;
      this.connected = true;
      this.emit("connect", { chainId });
      const accounts = (await this.request({ method: "eth_accounts" })) as string[];
      this.selectedAddress = accounts[0] ?? null;
    } catch {
      /* the extension is unavailable on this page */
    }
  }

  private handleEvent(event: ProviderEventName, data: unknown) {
    if (event === "accountsChanged") {
      const accounts = Array.isArray(data) ? (data as string[]) : [];
      this.selectedAddress = accounts[0] ?? null;
      this.emit("accountsChanged", accounts);
    } else if (event === "chainChanged") {
      this.chainId = typeof data === "string" ? data : null;
      this.emit("chainChanged", this.chainId);
    } else if (event === "connect") {
      this.connected = true;
      this.emit("connect", data);
    } else if (event === "disconnect") {
      this.connected = false;
      this.emit("disconnect", new ProviderRpcError(4900, "Disconnected"));
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  request(args: { method: string; params?: unknown }): Promise<unknown> {
    if (!args || typeof args !== "object" || typeof args.method !== "string") {
      return Promise.reject(new ProviderRpcError(-32600, "Expected a single, non-array, object argument with a string method."));
    }
    const id = `${Date.now().toString(36)}-${(++this.seq).toString(36)}`;
    const msg: ProviderRequestMessage = { target: CONTENT_TARGET, id, method: args.method, params: args.params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      window.postMessage(msg, window.location.origin);
    });
  }

  /** Legacy helpers some dApps still call. */
  enable(): Promise<unknown> {
    return this.request({ method: "eth_requestAccounts" });
  }

  on(event: string, listener: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return this;
  }
  addListener(event: string, listener: Listener): this {
    return this.on(event, listener);
  }
  once(event: string, listener: Listener): this {
    const wrapped: Listener = (...args) => {
      this.removeListener(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }
  removeListener(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }
  off(event: string, listener: Listener): this {
    return this.removeListener(event, listener);
  }
  removeAllListeners(event?: string): this {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
    return this;
  }
  private emit(event: string, ...args: unknown[]) {
    for (const l of this.listeners.get(event) ?? []) {
      try {
        l(...args);
      } catch {
        /* listener errors never break the provider */
      }
    }
  }
}

const provider = new FrameProvider();

// EIP-6963: announce ourselves without clobbering other wallets.
const info = Object.freeze({
  uuid: crypto.randomUUID(),
  name: __FRAME_NAME__,
  icon: __FRAME_ICON__,
  rdns: __FRAME_RDNS__,
});
const announce = () => {
  window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
};
window.addEventListener("eip6963:requestProvider", announce);
announce();

// Legacy window.ethereum: only if nothing else claimed it.
const w = window as unknown as { ethereum?: unknown; frame?: unknown };
if (!w.ethereum) {
  try {
    Object.defineProperty(w, "ethereum", { value: provider, writable: true, configurable: true, enumerable: true });
  } catch {
    /* another script locked window.ethereum */
  }
}
Object.defineProperty(w, "frame", { value: provider, writable: false, configurable: true, enumerable: false });
void __FRAME_VERSION__;
