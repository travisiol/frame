/**
 * Content script — a dumb, stateless bridge.
 *
 * Injects the inpage provider and relays JSON-RPC messages between the page
 * and the background service worker. It never sees keys, never decides
 * anything about permissions, and forwards nothing but {id, method, params}.
 */
import { CHANNEL, CONTENT_TARGET, INPAGE_TARGET, isProviderRequestMessage, type PortEvent, type PortResponse } from "./shared/protocol";

function injectInpage() {
  try {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("inpage.js");
    script.async = false;
    script.dataset.frame = "inpage";
    const parent = document.head ?? document.documentElement;
    parent.insertBefore(script, parent.firstChild);
    script.addEventListener("load", () => script.remove());
  } catch {
    /* CSP-blocked pages: the wallet simply is not available there */
  }
}

let port: chrome.runtime.Port | null = null;
const inflight = new Set<string>();

function reply(message: PortResponse | PortEvent) {
  window.postMessage({ target: INPAGE_TARGET, ...message }, window.location.origin);
}

function getPort(): chrome.runtime.Port {
  if (port) return port;
  const p = chrome.runtime.connect({ name: CHANNEL.providerPort });
  p.onMessage.addListener((msg: PortResponse | PortEvent) => {
    if ("id" in msg && typeof msg.id === "string") inflight.delete(msg.id);
    reply(msg);
  });
  p.onDisconnect.addListener(() => {
    port = null;
    // The service worker went away: fail what was in flight so the page does not hang.
    for (const id of inflight) reply({ id, error: { code: 4900, message: "The wallet disconnected. Please retry." } });
    inflight.clear();
  });
  port = p;
  return p;
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data: unknown = event.data;
  if (!isProviderRequestMessage(data)) return;
  if (data.target !== CONTENT_TARGET) return;
  try {
    inflight.add(data.id);
    getPort().postMessage({ id: data.id, method: data.method, params: data.params });
  } catch {
    inflight.delete(data.id);
    reply({ id: data.id, error: { code: 4900, message: "The wallet is unavailable." } });
  }
});

injectInpage();
