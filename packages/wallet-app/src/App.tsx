import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BRAND, chainName, isPrimaryChain } from "@frame/config";
import { formatTokenAmount } from "@frame/chain";
import { Button, Logo, Spinner, useToast } from "@frame/ui";
import { AppProvider, useApp, type AppEnvironment } from "./context";
import { useAppStore, useSnapshot } from "./state/store";
import { useRoute } from "./nav";
import { PopupShell, DashboardShell } from "./layout/Shell";
import { Onboarding } from "./screens/Onboarding";
import { LockScreen } from "./screens/Lock";
import { HomeScreen } from "./screens/Home";
import { DashboardHome } from "./screens/DashboardHome";
import { AssetScreen } from "./screens/Asset";
import { SendScreen } from "./screens/Send";
import { ReceiveScreen } from "./screens/Receive";
import { SwapScreen } from "./screens/Swap";
import { BridgeScreen } from "./screens/Bridge";
import { MarketsScreen } from "./screens/Markets";
import { ActivityScreen } from "./screens/Activity";
import { SecurityScreen } from "./screens/Security";
import { SettingsScreen } from "./screens/Settings";
import { HiddenTokensScreen } from "./screens/Hidden";
import { ApprovalQueue } from "./screens/Approvals";

export type { AppEnvironment, Surface } from "./context";

export function WalletApp({ env }: { env: AppEnvironment }) {
  return (
    <AppProvider env={env}>
      <FundsWatch />
      <Root />
    </AppProvider>
  );
}

/** Announces funds the service detects arriving (on any chain) and refreshes balances. */
function FundsWatch() {
  const { backend } = useApp();
  const toast = useToast();
  const qc = useQueryClient();
  useEffect(() => {
    void backend.pollIncoming().catch(() => undefined);
    return backend.subscribe((e) => {
      if (e.type !== "funds") return;
      const it = e.item;
      toast.push({
        title: `Received ${formatTokenAmount(it.amountRaw, it.decimals)} ${it.symbol}`,
        body: isPrimaryChain(it.chainId) ? `On ${chainName(it.chainId)} — it is in your portfolio.` : `On ${chainName(it.chainId)}. Move it to Robinhood Chain from the Bridge tab.`,
        tone: "success",
      });
      void qc.invalidateQueries({ queryKey: ["balances"] });
      void qc.invalidateQueries({ queryKey: ["activity"] });
    });
  }, [backend, toast, qc]);
  return null;
}

function Root() {
  const snap = useSnapshot();
  const ready = useAppStore((s) => s.ready);
  const error = useAppStore((s) => s.error);
  const { surface, backend } = useApp();

  // Any interaction counts as activity for the auto-lock timer.
  useEffect(() => {
    let last = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - last < 15_000) return;
      last = now;
      void backend.touch();
    };
    window.addEventListener("pointerdown", onActivity);
    window.addEventListener("keydown", onActivity);
    return () => {
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, [backend]);

  if (!ready) {
    return (
      <Centered>
        <Spinner size={20} className="text-ink-2" />
      </Centered>
    );
  }
  if (!snap) {
    return (
      <Centered>
        <Logo size={28} className="text-accent" />
        <div className="mt-3 text-[14px] font-medium text-ink">{BRAND.name} is not responding</div>
        <div className="mt-1 max-w-[260px] text-center text-[12px] text-ink-2">{error ?? "The wallet service could not be reached."}</div>
        <Button size="sm" className="mt-4" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </Centered>
    );
  }

  if (!snap.initialized || (!snap.settings.onboardingComplete && snap.accounts.length === 0)) return <Onboarding />;
  if (!snap.settings.onboardingComplete && snap.accounts.length > 0 && !snap.locked && surface !== "approval") return <Onboarding />;
  if (snap.locked && surface !== "approval") return <LockScreen />;

  if (surface === "approval") {
    if (snap.locked) return <LockScreen />;
    return <ApprovalQueue />;
  }
  if (surface === "popup" && snap.pendingRequests.length > 0) return <ApprovalQueue />;

  const Shell = surface === "dashboard" ? DashboardShell : PopupShell;
  return (
    <Shell>
      <Router dashboard={surface === "dashboard"} />
    </Shell>
  );
}

function Router({ dashboard }: { dashboard: boolean }) {
  const { path } = useRoute();
  const first = `/${path.split("/")[1] ?? ""}`;
  switch (first) {
    case "/":
      return dashboard ? <DashboardHome /> : <HomeScreen />;
    case "/asset":
      return <AssetScreen />;
    case "/send":
      return <SendScreen />;
    case "/receive":
      return <ReceiveScreen />;
    case "/swap":
      return <SwapScreen />;
    case "/bridge":
      return <BridgeScreen />;
    case "/markets":
      return <MarketsScreen />;
    case "/activity":
      return <ActivityScreen />;
    case "/security":
      return <SecurityScreen />;
    case "/settings":
      return <SettingsScreen />;
    case "/hidden":
      return <HiddenTokensScreen />;
    case "/approve":
      return <ApprovalQueue />;
    default:
      return dashboard ? <DashboardHome /> : <HomeScreen />;
  }
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center bg-base px-6">{children}</div>;
}
