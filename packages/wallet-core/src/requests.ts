import type { DappRequest } from "@frame/types";
import { RpcError } from "@frame/types";

interface Pending {
  request: DappRequest;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/**
 * Queue of dApp requests waiting for the user. Each entry holds the promise
 * the provider is awaiting; the approval UI resolves or rejects it.
 */
export class RequestQueue {
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<() => void>();

  add(request: DappRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { request, resolve, reject });
      this.emit();
    });
  }

  list(): DappRequest[] {
    return [...this.pending.values()].map((p) => p.request).sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id: string): DappRequest | undefined {
    return this.pending.get(id)?.request;
  }

  has(id: string): boolean {
    return this.pending.has(id);
  }

  resolve(id: string, value: unknown): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    p.resolve(value);
    this.emit();
    return true;
  }

  reject(id: string, error: unknown = RpcError.userRejected()): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    p.reject(error);
    this.emit();
    return true;
  }

  rejectAllFrom(origin: string, error: unknown = RpcError.userRejected()): void {
    for (const [id, p] of this.pending) if (p.request.origin === origin) this.reject(id, error);
  }

  rejectAll(error: unknown = RpcError.userRejected("The wallet closed the request.")): void {
    for (const id of [...this.pending.keys()]) this.reject(id, error);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}

export function newId(prefix = "req"): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
