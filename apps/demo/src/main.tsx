import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BRAND, ENV } from "@frame/config";
import { WebStorageStore } from "@frame/storage";
import { WalletService } from "@frame/wallet-core";
import { FRAME_FLOATING_ITEMS, FloatingField, Icon, Logo } from "@frame/ui";
import { WalletApp, createBridgeProviders, createMarketData, createSwapProviders, type AppEnvironment } from "@frame/wallet-app";
import "@frame/ui/styles.css";
import "./demo.css";

/**
 * Web demo: the exact same wallet application, with the wallet service running
 * in-process on the simulated chain (or live RPC when VITE_APP_MODE=live for
 * development). Vault + settings persist in localStorage; the unlocked session
 * key lives in sessionStorage, mirroring the extension's chrome.storage.session.
 */
const mode = ENV.appMode;
const service = new WalletService({
  mode,
  defaultNetworkMode: ENV.networkMode,
  persistent: new WebStorageStore(window.localStorage, `frame:${mode}:`),
  session: new WebStorageStore(window.sessionStorage, `frame:${mode}:session:`),
  rpcEnv: ENV.rpc,
  marketData: createMarketData(mode),
});
void service.init();
const market = createMarketData(mode);

function DemoPage() {
  const [expanded, setExpanded] = useState(() => {
    try {
      return window.localStorage.getItem("frame:demo:expanded") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("frame:demo:expanded", expanded ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, [expanded]);

  const env = useMemo<AppEnvironment>(
    () => ({
      backend: service,
      market,
      swapProviders: createSwapProviders(mode, market, ENV.lifiApiUrl),
      bridgeProviders: createBridgeProviders(mode, market, ENV.lifiApiUrl),
      surface: expanded ? "dashboard" : "demo",
      openExternal: (url) => {
        if (/^https?:\/\//.test(url) || url.startsWith("mailto:")) window.open(url, "_blank", "noopener,noreferrer");
      },
      openDashboard: expanded ? undefined : () => setExpanded(true),
      allowExpandedToggle: true,
    }),
    [expanded],
  );

  const landingHref = import.meta.env.BASE_URL === "/" ? "/" : "../";

  if (expanded) {
    return (
      <div className="flex h-screen flex-col">
        <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-2 text-[12px]">
          <a href={landingHref} className="inline-flex items-center gap-2 text-ink-2 hover:text-ink">
            <Logo size={14} className="text-accent" /> <span className="display tracking-[0.16em]">{BRAND.name}</span> <span className="text-ink-3">· interactive demo</span>
          </a>
          <div className="flex items-center gap-3">
            <span className="pill pill-accent">Demo</span>
            <button className="inline-flex items-center gap-1 text-ink-2 hover:text-ink" onClick={() => setExpanded(false)}>
              <Icon.Close size={13} /> Compact view
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <WalletApp env={env} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-base">
      <FloatingField
        items={FRAME_FLOATING_ITEMS}
        count={26}
        seed={23}
        minSize={30}
        maxSize={120}
        avoid={[
          { x: 10, y: 16, w: 46, h: 72 }, // copy column
          { x: 56, y: 10, w: 36, h: 84 }, // phone
          { x: 70, y: 0, w: 30, h: 12 }, // top-right pills
        ]}
      />
      <div className="page-vignette pointer-events-none absolute inset-0" />
      <a href={landingHref} className="nav-corner left-5 rounded-full px-2 py-1.5">
        <Logo size={22} className="text-accent" />
        <span className="display text-[15px] tracking-[0.18em] text-ink">{BRAND.name}</span>
      </a>
      <div className="nav-corner right-5">
        <button className="pill-cta pill-cta-ink" onClick={() => setExpanded(true)}>
          <Icon.Expand size={15} /> Expanded view
        </button>
        <a className="pill-cta pill-cta-lime" href={landingHref + "#get"}>
          Get {BRAND.name}
        </a>
      </div>
      <main className="relative z-10 mx-auto grid min-h-screen max-w-[1120px] items-center gap-12 px-6 pb-16 pt-28 md:grid-cols-[1fr_400px]">
        <div>
          <p className="eyebrow">Interactive demo</p>
          <h1 className="display-xl mt-4 max-w-[12ch]">Try {BRAND.name} in your browser.</h1>
          <p className="lede mt-5 max-w-[46ch]">The real {BRAND.name} application on a simulated Robinhood Chain. Create a wallet, lock it, send, swap, bridge, review transactions. Balances and transactions are simulated — nothing is broadcast, no real funds are involved.</p>
          <ul className="mt-7 space-y-2.5 text-[14px] text-ink-2">
            {["Encrypted vault, password, auto-lock — all real", "Demo portfolio with Stock Tokens, crypto and stables", "Readable transaction reviews with risk flags", "Swap and bridge quotes from labelled demo routes"].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <Icon.Check size={15} className="mt-0.5 shrink-0 text-accent" /> {t}
              </li>
            ))}
          </ul>
          <p className="mt-9 max-w-[52ch] text-[11px] leading-relaxed text-ink-3">{BRAND.disclaimer}</p>
        </div>
        <div className="device-glow relative mx-auto h-[600px] w-[380px] overflow-hidden rounded-[32px] bg-base">
          <WalletApp env={env} />
        </div>
      </main>
    </div>
  );
}

// Reuse the React root across Vite HMR re-executions of this entry (dev only; production runs it once).
const host = window as unknown as { __frameRoot?: ReturnType<typeof createRoot> };
host.__frameRoot ??= createRoot(document.getElementById("root")!);
host.__frameRoot.render(
  <StrictMode>
    <DemoPage />
  </StrictMode>,
);
