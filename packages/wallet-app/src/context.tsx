import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WalletBackend } from "@frame/wallet-core";
import type { BridgeProvider, MarketDataProvider, SwapProvider } from "@frame/markets";
import type { WalletEvent } from "@frame/types";
import { ToastProvider } from "@frame/ui";
import { useAppStore } from "./state/store";

export type Surface = "popup" | "dashboard" | "approval" | "demo";

export interface AppEnvironment {
  backend: WalletBackend;
  market: MarketDataProvider;
  swapProviders: SwapProvider[];
  bridgeProviders: BridgeProvider[];
  surface: Surface;
  /** Opens the full-page dashboard (extension: new tab). */
  openDashboard?: (path?: string) => void;
  /** Opens an external URL (explorer, docs). */
  openExternal: (url: string) => void;
  /** Approval surface: the request this window was opened for. */
  requestId?: string;
  /** Closes the current window (approval popup). */
  closeWindow?: () => void;
  /** Whether the demo phone frame should offer the "expanded" toggle. */
  allowExpandedToggle?: boolean;
  /** Called by the shell when the wallet emits an event (extension: notifications). */
  onEvent?: (event: WalletEvent) => void;
}

const Ctx = createContext<AppEnvironment | null>(null);

export function useApp(): AppEnvironment {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used within <AppProvider>");
  return v;
}

export function useBackend(): WalletBackend {
  return useApp().backend;
}

export function AppProvider({ env, children }: { env: AppEnvironment; children: ReactNode }) {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 5_000, gcTime: 5 * 60_000 },
        },
      }),
    [],
  );
  const setSnapshot = useAppStore((s) => s.setSnapshot);
  const setError = useAppStore((s) => s.setError);

  useEffect(() => {
    // In-flight de-duplication is scoped to this effect run: StrictMode's double
    // invocation must not leave a stale, cancelled promise behind.
    let cancelled = false;
    let inflight: Promise<void> | null = null;
    const refresh = () => {
      if (inflight) return inflight;
      const p = env.backend
        .getSnapshot()
        .then((snap) => {
          if (!cancelled) setSnapshot(snap);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : "The wallet service is not responding.");
        })
        .finally(() => {
          inflight = null;
        });
      inflight = p;
      return p;
    };
    void refresh();
    const unsubscribe = env.backend.subscribe((event) => {
      env.onEvent?.(event);
      if (event.type === "tx") {
        void queryClient.invalidateQueries({ queryKey: ["balances"] });
        void queryClient.invalidateQueries({ queryKey: ["activity"] });
        void queryClient.invalidateQueries({ queryKey: ["allowances"] });
      }
      if (event.type === "chainChanged") void queryClient.invalidateQueries();
      void refresh();
    });
    // Belt and braces: the service enforces auto-lock on every call, so poll lightly to reflect it.
    const interval = window.setInterval(() => void refresh(), 20_000);
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [env, queryClient, setSnapshot, setError]);

  return (
    <Ctx.Provider value={env}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </Ctx.Provider>
  );
}
