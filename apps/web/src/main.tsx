import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BRAND, ENV, relayRpcOverrides } from "@frame/config";
import { WebStorageStore } from "@frame/storage";
import { WalletService } from "@frame/wallet-core";
import { WalletApp, createBridgeProviders, createMarketData, createSwapProviders, type AppEnvironment } from "@frame/wallet-app";
import "@frame/ui/styles.css";

/**
 * The web wallet: the exact same application as the extension, running in a
 * browser tab with the WalletService in-process on Robinhood Chain (LIVE).
 *
 * Storage mirrors the extension: the encrypted vault and settings persist in
 * this origin's localStorage; the unlocked session key lives in sessionStorage
 * (per tab, gone when the tab closes), like chrome.storage.session.
 *
 * Reads and signed transactions go through the same-origin relays under /api
 * in production (browsers cannot use the public RPCs reliably); a development
 * build talks to the chain directly. Keys never go anywhere.
 */
const mode = ENV.appMode;
const production = import.meta.env.PROD;
const rpcRelay = ENV.rpcRelay === "off" ? null : (ENV.rpcRelay ?? (production ? "/api/rpc" : null));
const marketRelay = ENV.marketRelay === "off" ? null : (ENV.marketRelay ?? (production ? "/api/market" : null));

const market = createMarketData(mode, { relay: marketRelay });
const service = new WalletService({
  mode,
  defaultNetworkMode: ENV.networkMode,
  persistent: new WebStorageStore(window.localStorage, `frame:${mode}:`),
  session: new WebStorageStore(window.sessionStorage, `frame:${mode}:session:`),
  rpcEnv: ENV.rpc,
  rpcRelay: rpcRelay ? relayRpcOverrides(rpcRelay, window.location.origin) : undefined,
  marketData: market,
});
void service.init().then(() => {
  // Incoming-funds watcher (the extension runs the same check from its service worker).
  const poll = () => void service.pollIncoming().catch(() => undefined);
  poll();
  window.setInterval(poll, 30_000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) poll();
  });
});

function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 900px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

function WebWallet() {
  const wide = useWide();
  const env = useMemo<AppEnvironment>(
    () => ({
      backend: service,
      market,
      swapProviders: createSwapProviders(mode, market, ENV.lifiApiUrl),
      bridgeProviders: createBridgeProviders(mode, market, ENV.lifiApiUrl),
      // Wide screens get the full dashboard; phones get the compact layout the extension popup uses.
      surface: wide ? "dashboard" : "popup",
      platform: "web",
      homeUrl: import.meta.env.BASE_URL === "/" ? "/" : "../",
      openExternal: (url) => {
        if (/^https?:\/\//.test(url) || url.startsWith("mailto:")) window.open(url, "_blank", "noopener,noreferrer");
      },
    }),
    [wide],
  );
  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-base">
      <WalletApp env={env} />
    </div>
  );
}

document.title = `${BRAND.name} — ${BRAND.tagline}`;

// Reuse the React root across Vite HMR re-executions of this entry (dev only; production runs it once).
const host = window as unknown as { __frameRoot?: ReturnType<typeof createRoot> };
host.__frameRoot ??= createRoot(document.getElementById("root")!);
host.__frameRoot.render(
  <StrictMode>
    <WebWallet />
  </StrictMode>,
);
