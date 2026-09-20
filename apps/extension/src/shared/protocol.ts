import type { SerializedError, WalletEvent } from "@frame/types";

/** Names of the runtime channels. Anything not on this list is ignored. */
export const CHANNEL = {
  /** UI → background one-shot API calls (chrome.runtime.sendMessage). */
  api: "frame:api",
  /** UI ↔ background long-lived port for wallet events. */
  uiPort: "frame:ui",
  /** Content script ↔ background long-lived port for dApp requests. */
  providerPort: "frame:provider",
} as const;

/** window.postMessage targets between the page's inpage provider and the content script. */
export const INPAGE_TARGET = "frame:inpage" as const;
export const CONTENT_TARGET = "frame:content" as const;

export interface ProviderRequestMessage {
  target: typeof CONTENT_TARGET;
  id: string;
  method: string;
  params?: unknown;
}

export interface ProviderResponseMessage {
  target: typeof INPAGE_TARGET;
  id: string;
  result?: unknown;
  error?: SerializedError;
}

export type ProviderEventName = "accountsChanged" | "chainChanged" | "connect" | "disconnect";

export interface ProviderEventMessage {
  target: typeof INPAGE_TARGET;
  event: ProviderEventName;
  data: unknown;
}

/** Port message shapes (content ↔ background). */
export interface PortRequest {
  id: string;
  method: string;
  params?: unknown;
}
export interface PortResponse {
  id: string;
  result?: unknown;
  error?: SerializedError;
}
export interface PortEvent {
  event: ProviderEventName;
  data: unknown;
}

export interface ApiRequest {
  channel: typeof CHANNEL.api;
  method: string;
  params?: unknown;
}
export type ApiResponse = { ok: true; result: unknown } | { ok: false; error: SerializedError };

export interface UiPortMessage {
  type: "event";
  event: WalletEvent;
}

export function isProviderRequestMessage(v: unknown): v is ProviderRequestMessage {
  return typeof v === "object" && v !== null && (v as { target?: unknown }).target === CONTENT_TARGET && typeof (v as { id?: unknown }).id === "string" && typeof (v as { method?: unknown }).method === "string";
}

export function isApiRequest(v: unknown): v is ApiRequest {
  return typeof v === "object" && v !== null && (v as { channel?: unknown }).channel === CHANNEL.api && typeof (v as { method?: unknown }).method === "string";
}
