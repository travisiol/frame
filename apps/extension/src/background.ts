/**
 * Background service worker — the only place wallet secrets are ever
 * decrypted. It owns the WalletService (encrypted vault, signing, permissions,
 * auto-lock, dApp request queue) and exposes:
 *
 *   - an allowlisted API to the extension's own pages (popup/dashboard/approval)
 *   - a JSON-RPC surface to content scripts, keyed by their origin
 *
 * Content scripts and web pages can never call the API channel.
 */
import type { WalletEvent } from "@frame/types";
import { BRAND, ENV, toHexChainId } from "@frame/config";
import { ChromeStorageStore, MemoryStore } from "@frame/storage";
import { serializeError } from "@frame/security";
import { WalletService, isWalletApiMethod, type WalletApi } from "@frame/wallet-core";
import { createMarketData } from "@frame/wallet-app";
import { CHANNEL, isApiRequest, type ApiResponse, type PortEvent, type PortRequest, type PortResponse, type UiPortMessage } from "./shared/protocol";

const persistent = new ChromeStorageStore(chrome.storage.local);
const session = chrome.storage.session ? new ChromeStorageStore(chrome.storage.session) : new MemoryStore();
if (chrome.storage.session?.setAccessLevel) {
  // Session storage stays private to trusted extension contexts (never content scripts).
  void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}

const uiPorts = new Set<chrome.runtime.Port>();
const providerPorts = new Map<chrome.runtime.Port, string>(); // port → origin
const approvalWindows = new Map<string, number>(); // requestId → windowId
let keepAlive: ReturnType<typeof setInterval> | null = null;

const service = new WalletService({
  mode: ENV.appMode,
  defaultNetworkMode: ENV.networkMode,
  persistent,
  session,
  rpcEnv: ENV.rpc,
  marketData: createMarketData(ENV.appMode),
  openApprovalUi: openApprovalWindow,
  onEvent: broadcast,
});
const ready = service.init();

// ---------------------------------------------------------------------------
// Events → UI ports, provider ports, notifications
// ---------------------------------------------------------------------------

function broadcast(event: WalletEvent) {
  const uiMsg: UiPortMessage = { type: "event", event };
  for (const p of uiPorts) {
    try {
      p.postMessage(uiMsg);
    } catch {
      uiPorts.delete(p);
    }
  }
  void forwardToProviders(event);
  void maybeNotify(event);
  void manageKeepAlive();
}

async function forwardToProviders(event: WalletEvent) {
  if (event.type === "accountsChanged") {
    for (const [port, origin] of providerPorts) {
      if (!event.origin || origin === event.origin) send(port, { event: "accountsChanged", data: event.accounts });
    }
  } else if (event.type === "chainChanged") {
    const hex = toHexChainId(event.chainId);
    for (const port of providerPorts.keys()) send(port, { event: "chainChanged", data: hex });
  } else if (event.type === "locked") {
    for (const port of providerPorts.keys()) send(port, { event: "accountsChanged", data: [] });
  } else if (event.type === "unlocked") {
    const byOrigin = new Map<string, string[]>();
    for (const origin of new Set(providerPorts.values())) byOrigin.set(origin, await service.accountsForOrigin(origin));
    for (const [port, origin] of providerPorts) {
      const accounts = byOrigin.get(origin) ?? [];
      if (accounts.length) send(port, { event: "accountsChanged", data: accounts });
    }
  }
}

function send(port: chrome.runtime.Port, msg: PortEvent | PortResponse) {
  try {
    port.postMessage(msg);
  } catch {
    providerPorts.delete(port);
  }
}

async function maybeNotify(event: WalletEvent) {
  if (event.type !== "tx" || event.status === "pending" || !chrome.notifications) return;
  const snap = await service.getSnapshot();
  if (!snap.settings.notifications) return;
  const item = snap.localActivity.find((a) => a.hash === event.hash);
  const title = event.status === "confirmed" ? (item?.kind === "bridge" ? "Bridge completed" : item?.kind === "swap" ? "Swap completed" : "Transaction confirmed") : "Transaction failed";
  const message = item ? item.title : `${event.hash.slice(0, 10)}…`;
  chrome.notifications.create(`tx:${event.hash}`, { type: "basic", iconUrl: chrome.runtime.getURL("icons/icon-128.png"), title, message, silent: true });
}

/** MV3 workers idle out after ~30 s; keep it alive only while a user decision is pending. */
async function manageKeepAlive() {
  const pending = service.pendingRequestIds().length > 0;
  if (pending && !keepAlive) {
    keepAlive = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  } else if (!pending && keepAlive) {
    clearInterval(keepAlive);
    keepAlive = null;
  }
}

// ---------------------------------------------------------------------------
// Approval window
// ---------------------------------------------------------------------------

async function openApprovalWindow(requestId: string) {
  // The toolbar popup, if open, shows the queue itself.
  if ([...uiPorts].some((p) => p.name === CHANNEL.uiPort && p.sender?.url?.includes("popup.html"))) return;
  const url = chrome.runtime.getURL(`approval.html?requestId=${encodeURIComponent(requestId)}`);
  const current = await chrome.windows.getLastFocused().catch(() => undefined);
  const width = 380;
  const height = 640;
  const left = current?.left !== undefined && current.width !== undefined ? Math.max(0, current.left + current.width - width - 16) : undefined;
  const top = current?.top !== undefined ? Math.max(0, current.top + 60) : undefined;
  const win = await chrome.windows.create({ url, type: "popup", width, height, left, top, focused: true });
  if (win?.id !== undefined) approvalWindows.set(requestId, win.id);
}

chrome.windows.onRemoved.addListener((windowId) => {
  for (const [requestId, id] of approvalWindows) {
    if (id === windowId) {
      approvalWindows.delete(requestId);
      service.cancelRequest(requestId);
    }
  }
});

// ---------------------------------------------------------------------------
// UI API (extension pages only)
// ---------------------------------------------------------------------------

function isOwnPage(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && !!sender.url && sender.url.startsWith(chrome.runtime.getURL("")) && !sender.tab?.url?.startsWith("http");
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (r: ApiResponse) => void) => {
  if (!isApiRequest(message)) return false;
  if (!isOwnPage(sender)) {
    sendResponse({ ok: false, error: { code: 4100, message: "Unauthorized caller." } });
    return false;
  }
  const { method, params } = message;
  if (!isWalletApiMethod(method)) {
    sendResponse({ ok: false, error: { code: -32601, message: `Unknown method ${method}` } });
    return false;
  }
  ready
    .then(() => (service[method] as (p: unknown) => Promise<unknown>).call(service, params))
    .then((result) => sendResponse({ ok: true, result: result === undefined ? null : result }))
    .catch((e: unknown) => sendResponse({ ok: false, error: serializeError(e) }));
  return true;
});

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

chrome.runtime.onConnect.addListener((port) => {
  if (port.sender?.id !== chrome.runtime.id) {
    port.disconnect();
    return;
  }
  if (port.name === CHANNEL.uiPort) {
    if (!port.sender?.url?.startsWith(chrome.runtime.getURL(""))) {
      port.disconnect();
      return;
    }
    uiPorts.add(port);
    port.onDisconnect.addListener(() => uiPorts.delete(port));
    return;
  }
  if (port.name === CHANNEL.providerPort) {
    // The origin comes from the browser, never from the page.
    const origin = port.sender?.origin ?? (port.sender?.url ? new URL(port.sender.url).origin : null);
    if (!origin || !/^https?:$/.test(new URL(origin).protocol)) {
      port.disconnect();
      return;
    }
    providerPorts.set(port, origin);
    port.onMessage.addListener((msg: PortRequest) => {
      if (!msg || typeof msg.id !== "string" || typeof msg.method !== "string") return;
      ready
        .then(() => service.handleDappRequest(origin, msg.method, msg.params))
        .then((result) => send(port, { id: msg.id, result: result === undefined ? null : result }))
        .catch((e: unknown) => send(port, { id: msg.id, error: serializeError(e) }));
    });
    port.onDisconnect.addListener(() => {
      providerPorts.delete(port);
      if (![...providerPorts.values()].includes(origin)) service.cancelRequestsFrom(origin);
    });
  }
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.alarms.create("frame:autolock", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "frame:autolock") void ready.then(() => service.tick());
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html#/") });
  }
});

chrome.runtime.onStartup.addListener(() => void ready);

void BRAND;
export type { WalletApi };
