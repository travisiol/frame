import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { WalletEvent } from "@frame/types";
import { BRAND, ENV } from "@frame/config";
import { WALLET_API_METHODS, type WalletBackend } from "@frame/wallet-core";
import { WalletApp, createBridgeProviders, createMarketData, createSwapProviders, type AppEnvironment, type Surface } from "@frame/wallet-app";
import { CHANNEL, type ApiRequest, type ApiResponse, type UiPortMessage } from "../shared/protocol";
import "@frame/ui/styles.css";

/** UI-side backend: every WalletApi method becomes a message to the background; events arrive over a port. */
function createExtensionBackend(): WalletBackend {
  const call = async (method: string, params: unknown): Promise<unknown> => {
    const req: ApiRequest = { channel: CHANNEL.api, method, params };
    const res = (await chrome.runtime.sendMessage(req)) as ApiResponse | undefined;
    if (!res) throw new Error("The wallet service did not respond.");
    if (!res.ok) {
      const err = new Error(res.error.message) as Error & { code?: number; data?: unknown };
      err.code = res.error.code;
      err.data = res.error.data;
      throw err;
    }
    return res.result;
  };
  const backend: Record<string, unknown> = {
    subscribe(listener: (event: WalletEvent) => void) {
      let port: chrome.runtime.Port | null = null;
      const connect = () => {
        port = chrome.runtime.connect({ name: CHANNEL.uiPort });
        port.onMessage.addListener((msg: UiPortMessage) => {
          if (msg?.type === "event") listener(msg.event);
        });
        port.onDisconnect.addListener(() => {
          port = null;
          // The service worker restarted: reconnect and refresh state.
          window.setTimeout(() => {
            if (!disposed) {
              connect();
              listener({ type: "state" });
            }
          }, 300);
        });
      };
      let disposed = false;
      connect();
      return () => {
        disposed = true;
        port?.disconnect();
      };
    },
  };
  for (const m of WALLET_API_METHODS) backend[m] = (params: unknown) => call(m, params);
  return backend as unknown as WalletBackend;
}

const surface = (document.body.dataset.surface as Surface | undefined) ?? "popup";
const params = new URLSearchParams(window.location.search);
const market = createMarketData(ENV.appMode);

const env: AppEnvironment = {
  backend: createExtensionBackend(),
  market,
  swapProviders: createSwapProviders(ENV.appMode, market, ENV.lifiApiUrl),
  bridgeProviders: createBridgeProviders(ENV.appMode, market, ENV.lifiApiUrl),
  surface,
  platform: "extension",
  requestId: params.get("requestId") ?? undefined,
  openDashboard: surface === "dashboard" ? undefined : (path = "/") => void chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html#${path}`) }),
  openExternal: (url) => {
    if (/^https?:\/\//.test(url) || url.startsWith("mailto:")) void chrome.tabs.create({ url });
  },
  closeWindow: surface === "approval" ? () => window.close() : undefined,
};

document.title = surface === "dashboard" ? `${BRAND.name} — ${BRAND.tagline}` : BRAND.name;

const rootEl = document.getElementById("root")!;
rootEl.className = surface === "dashboard" ? "h-screen w-screen" : "relative h-[600px] w-[380px] overflow-hidden";
createRoot(rootEl).render(
  <StrictMode>
    <WalletApp env={env} />
  </StrictMode>,
);
