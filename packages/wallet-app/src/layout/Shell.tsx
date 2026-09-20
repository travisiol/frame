import type { ReactNode } from "react";
import { BRAND } from "@frame/config";
import { formatUsd } from "@frame/chain";
import { Icon, IconButton, Logo, PctChange, Skeleton, cx } from "@frame/ui";
import { useApp, useBackend } from "../context";
import { useSnapshot } from "../state/store";
import { usePortfolio } from "../data/hooks";
import { sectionOf, useNavigate, useRoute } from "../nav";
import { AccountSwitcher, ModeBanners, NetworkBadge } from "../components/common";

const POPUP_TABS = [
  { path: "/", label: "Portfolio", icon: Icon.Home },
  { path: "/markets", label: "Markets", icon: Icon.Markets },
  { path: "/activity", label: "Activity", icon: Icon.Activity },
  { path: "/security", label: "Security", icon: Icon.Shield },
  { path: "/settings", label: "Settings", icon: Icon.Settings },
] as const;

const SIDEBAR = [
  { path: "/", label: "Portfolio", icon: Icon.Home },
  { path: "/markets", label: "Markets", icon: Icon.Markets },
  { path: "/swap", label: "Swap", icon: Icon.Swap },
  { path: "/bridge", label: "Bridge", icon: Icon.Bridge },
  { path: "/activity", label: "Activity", icon: Icon.Activity },
  { path: "/security", label: "Security", icon: Icon.Shield },
  { path: "/settings", label: "Settings", icon: Icon.Settings },
] as const;

/** Popup: 380×600 with a bottom tab bar; the tab bar hides inside flows (send/swap/…) to keep the CTA reachable. */
export function PopupShell({ children }: { children: ReactNode }) {
  const { path } = useRoute();
  const navigate = useNavigate();
  const section = sectionOf(path);
  const inFlow = /^\/(send|receive|swap|bridge|asset|hidden)/.test(path) || path.split("/").length > 2;
  return (
    <div className="flex h-full flex-col bg-base">
      <div className="min-h-0 flex-1">{children}</div>
      {!inFlow && (
        <nav className="flex shrink-0 items-stretch border-t border-line bg-surface">
          {POPUP_TABS.map((t) => {
            const active = section === t.path;
            const I = t.icon;
            return (
              <button key={t.path} className={cx("flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors", active ? "text-accent" : "text-ink-3 hover:text-ink-2")} onClick={() => navigate(t.path)}>
                <I size={18} />
                {t.label}
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

/** Full-page dashboard: sidebar + top bar; the same screens render in a wider column. */
export function DashboardShell({ children }: { children: ReactNode }) {
  const { path } = useRoute();
  const navigate = useNavigate();
  const backend = useBackend();
  const snap = useSnapshot();
  const { portfolio, loading } = usePortfolio();
  const { homeUrl } = useApp();
  const section = sectionOf(path);
  return (
    <div className="flex h-full min-h-0 bg-base text-ink">
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-line bg-surface md:flex">
        {homeUrl ? (
          <a href={homeUrl} className="flex items-center gap-2.5 px-5 py-5 transition-opacity hover:opacity-80" title="Back to the website">
            <Logo size={22} className="text-accent" />
            <span className="display text-[15px] tracking-[0.18em]">{BRAND.name}</span>
          </a>
        ) : (
          <div className="flex items-center gap-2.5 px-5 py-5">
            <Logo size={22} className="text-accent" />
            <span className="display text-[15px] tracking-[0.18em]">{BRAND.name}</span>
          </div>
        )}
        <nav className="flex-1 space-y-0.5 px-3">
          {SIDEBAR.map((t) => {
            const active = section === t.path;
            const I = t.icon;
            return (
              <button key={t.path} className={cx("flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13px] font-medium transition-colors", active ? "bg-card-2 text-ink" : "text-ink-2 hover:bg-card hover:text-ink")} onClick={() => navigate(t.path)}>
                <I size={17} className={cx(active && "text-accent")} />
                {t.label}
              </button>
            );
          })}
        </nav>
        <div className="space-y-2 px-5 pb-5 text-[11px] text-ink-3">
          <div>{BRAND.positioning}</div>
          <div className="text-[10px] leading-relaxed">{BRAND.disclaimer}</div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <ModeBanners />
        <header className="flex items-center gap-4 border-b border-line px-4 py-3 md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <Logo size={20} className="text-accent" />
          </div>
          <div className="min-w-0">
            <div className="label">Portfolio value</div>
            <div className="num flex items-baseline gap-2">
              {loading && !portfolio ? <Skeleton w={110} h={20} /> : <span className="display text-[20px] leading-none">{portfolio?.pricesUnavailable ? "———" : formatUsd(portfolio?.totalUsd ?? 0)}</span>}
              {portfolio && <PctChange value={portfolio.change24hPct} />}
            </div>
          </div>
          <div className="flex-1" />
          <AccountSwitcher />
          <NetworkBadge />
          <IconButton label="Lock" onClick={() => void backend.lock()}>
            <Icon.Lock size={16} />
          </IconButton>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden">
          <div className="mx-auto h-full w-full max-w-[840px] px-2 md:px-4">{children}</div>
        </main>
        <nav className="flex items-stretch border-t border-line bg-surface md:hidden">
          {POPUP_TABS.map((t) => {
            const active = section === t.path;
            const I = t.icon;
            return (
              <button key={t.path} className={cx("flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-semibold uppercase tracking-[0.08em]", active ? "text-accent" : "text-ink-3")} onClick={() => navigate(t.path)}>
                <I size={18} />
                {t.label}
              </button>
            );
          })}
        </nav>
        {snap?.settings.developerMode && <div className="border-t border-line px-4 py-1 text-[10px] text-ink-3">Developer mode · chain {snap.chainId} · {snap.mode}</div>}
      </div>
    </div>
  );
}
