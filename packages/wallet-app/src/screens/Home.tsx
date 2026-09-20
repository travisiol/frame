import { EmptyPortfolio, OtherNetworksCard } from "../components/OtherNetworks";
import { useMemo } from "react";
import { formatUsd } from "@frame/chain";
import { BRAND } from "@frame/config";
import { ActionTile, AllocationBar, Banner, Button, Donut, Icon, IconButton, PctChange, Skeleton, SkeletonRow, Tabs, cx } from "@frame/ui";
import { useApp, useBackend } from "../context";
import { useAppStore, useSnapshot } from "../state/store";
import { usePortfolio, useSelectedAccount, useTokens } from "../data/hooks";
import type { Holding } from "../data/portfolio";
import { useNavigate } from "../nav";
import { AccountSwitcher, AssetRow, BackupReminder, LowGasBanner, ModeBanners, NetworkBadge } from "../components/common";

const BUCKETS = [
  { key: "stocks", label: "Stock Tokens", color: "#A8FF60" },
  { key: "crypto", label: "Crypto", color: "#F4F6F4" },
  { key: "stables", label: "Stables", color: "#5F6760" },
] as const;

export function HomeScreen() {
  const { surface, openDashboard } = useApp();
  const backend = useBackend();
  const snap = useSnapshot();
  const account = useSelectedAccount();
  const navigate = useNavigate();
  const { portfolio, loading, pricesPending, balancesError, refresh } = usePortfolio();
  const tab = useAppStore((s) => s.assetTab);
  const setTab = useAppStore((s) => s.setAssetTab);
  const { hidden } = useTokens();
  const watchOnly = account?.kind === "watch";
  const dashboard = surface === "dashboard";

  const filtered = useMemo(() => {
    if (!portfolio) return [];
    if (tab === "all") return portfolio.holdings;
    return portfolio.holdings.filter((h) => h.bucket === tab);
  }, [portfolio, tab]);

  const slices = portfolio ? BUCKETS.map((b) => ({ value: portfolio.allocation[b.key], color: b.color, label: b.label })) : [];

  return (
    <div className="flex h-full flex-col">
      {!dashboard && (
        <>
          <ModeBanners />
          <div className="flex items-center justify-between px-3 pt-3">
            <div className="flex items-center gap-1">
              <span className="display pl-1 text-[13px] tracking-[0.18em] text-ink">{BRAND.name}</span>
            </div>
            <div className="flex items-center gap-1">
              <NetworkBadge />
              <IconButton label="Refresh" onClick={refresh}>
                <Icon.Refresh size={16} />
              </IconButton>
              {openDashboard && (
                <IconButton label="Expand" onClick={() => openDashboard("/")}>
                  <Icon.Expand size={16} />
                </IconButton>
              )}
              <IconButton label="Lock" onClick={() => void backend.lock()}>
                <Icon.Lock size={16} />
              </IconButton>
            </div>
          </div>
          <div className="px-3 pt-1">
            <AccountSwitcher compact />
          </div>
        </>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <div className={cx("px-4 pt-3", dashboard && "pt-0")}>
          <div className="label">{snap?.mode === "demo" ? "Demo portfolio" : "Portfolio value"}</div>
          {loading && !portfolio ? (
            <div className="mt-2 space-y-2">
              <Skeleton w={180} h={34} />
              <Skeleton w={120} h={14} />
            </div>
          ) : balancesError && !portfolio ? (
            <div className="mt-2">
              <div className="display text-[34px] leading-none text-ink-3">———</div>
              <Banner tone="warn" title="Network connection issue" className="mt-3">
                Robinhood Chain did not respond.{" "}
                <button className="font-semibold underline" onClick={refresh}>
                  Retry
                </button>{" "}
                or{" "}
                <button className="font-semibold underline" onClick={() => navigate("/settings/advanced")}>
                  change RPC
                </button>
                .
              </Banner>
            </div>
          ) : portfolio ? (
            <>
              <div className="display num mt-1.5 text-[34px] leading-none text-ink">
                {portfolio.pricesUnavailable ? <span className="text-ink-3">{pricesPending ? "…" : "———"}</span> : formatUsd(portfolio.totalUsd)}
              </div>
              <div className="mt-2 flex items-center gap-2 text-[13px]">
                {portfolio.pricesUnavailable ? (
                  <span className={pricesPending ? "text-ink-3" : "text-warn"}>{pricesPending ? "Loading prices…" : "Price unavailable — balances shown below"}</span>
                ) : (
                  <>
                    <span className={cx("num", (portfolio.change24hUsd ?? 0) >= 0 ? "text-accent" : "text-loss")}>
                      {portfolio.change24hUsd === null ? "—" : formatUsd(portfolio.change24hUsd, { signed: true })} today
                    </span>
                    <PctChange value={portfolio.change24hPct} size="md" />
                    {portfolio.partial && <span className="text-[11px] text-ink-3">(some prices unavailable)</span>}
                  </>
                )}
              </div>
            </>
          ) : null}
        </div>

        <div className="mt-4 flex gap-2 px-3">
          <ActionTile label="Send" icon={<Icon.Send size={17} />} onClick={() => navigate("/send")} disabled={watchOnly} />
          <ActionTile label="Swap" icon={<Icon.Swap size={17} />} onClick={() => navigate("/swap")} disabled={watchOnly} />
          <ActionTile label="Receive" icon={<Icon.Receive size={17} />} onClick={() => navigate("/receive")} />
          <ActionTile label="Bridge" icon={<Icon.Bridge size={17} />} onClick={() => navigate("/bridge")} disabled={watchOnly} />
        </div>

        <OtherNetworksCard compact />

        {watchOnly && (
          <Banner tone="info" className="mx-3 mt-3" title="Watch only">
            This account has no key on this device. You can view its portfolio and activity but cannot sign.
          </Banner>
        )}
        <div className="mt-3 space-y-2">
          <BackupReminder />
          {portfolio && !watchOnly && snap && <LowGasBanner gasWei={portfolio.gasBalanceWei} threshold={snap.settings.lowGasThresholdEth} />}
        </div>

        {portfolio && portfolio.holdings.length > 0 && !portfolio.pricesUnavailable && (
          <div className="mx-3 mt-4 card px-4 py-3">
            <div className="flex items-center gap-4">
              <Donut slices={slices} size={72} thickness={9} />
              <div className="flex-1 space-y-1.5">
                {BUCKETS.map((b) => {
                  const v = portfolio.allocation[b.key];
                  const pct = portfolio.totalUsd > 0 ? (v / portfolio.totalUsd) * 100 : 0;
                  return (
                    <div key={b.key} className="flex items-center justify-between text-[12px]">
                      <span className="flex items-center gap-2 text-ink-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: b.color }} />
                        {b.label}
                      </span>
                      <span className="num text-ink">
                        {formatUsd(v)} <span className="ml-1 text-ink-3">{pct.toFixed(1)}%</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <AllocationBar slices={slices} className="mt-3" />
          </div>
        )}

        <div className="mt-5 px-3">
          <div className="flex items-center justify-between px-1">
            <span className="label">Assets</span>
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { value: "all", label: "All" },
                { value: "stocks", label: "Stocks" },
                { value: "crypto", label: "Crypto" },
                { value: "stables", label: "Stables" },
              ]}
            />
          </div>
          <div className="mt-2 space-y-0.5">
            {loading && !portfolio ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : filtered.length === 0 ? (
              <div className="px-2 py-8 text-center text-[13px] text-ink-2">
                {portfolio && portfolio.holdings.length === 0 ? (
                  <>
                    <EmptyPortfolio compact />
                  </>
                ) : (
                  "Nothing in this category."
                )}
              </div>
            ) : (
              filtered.map((h) => <HoldingRow key={h.token.address} holding={h} pending={pricesPending} onClick={() => navigate(`/asset/${h.token.address}`)} />)
            )}
          </div>
          {hidden.length > 0 && (
            <button className="mt-2 flex w-full items-center justify-between px-3 py-2 text-[12px] text-ink-3 hover:text-ink-2" onClick={() => navigate("/hidden")}>
              <span className="inline-flex items-center gap-1.5">
                <Icon.Hidden size={14} /> Hidden tokens
              </span>
              <span>{hidden.length}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function HoldingRow({ holding, onClick, pending }: { holding: Holding; onClick: () => void; pending?: boolean }) {
  return <AssetRow token={holding.token} balance={holding.formatted} valueUsd={holding.valueUsd} change={holding.change24hPct} priceUsd={holding.priceUsd} onClick={onClick} demoPrice={holding.demoPrice} pending={pending} />;
}
