import { useMemo, useState } from "react";
import type { PriceRange } from "@frame/types";
import { formatUsd } from "@frame/chain";
import { displayName } from "@frame/token-registry";
import { ActionTile, AllocationBar, Banner, Button, Donut, Icon, PctChange, PriceChart, Skeleton, Tabs, TokenAvatar, cx } from "@frame/ui";
import { useApp } from "../context";
import { useAppStore, useSnapshot } from "../state/store";
import { usePortfolio, useSelectedAccount, useTokens } from "../data/hooks";
import { useNavigate } from "../nav";
import { BackupReminder, LowGasBanner } from "../components/common";
import { useQuery } from "@tanstack/react-query";
import { priceKey } from "@frame/markets";

const BUCKETS = [
  { key: "stocks", label: "Stock Tokens", color: "#A8FF60" },
  { key: "crypto", label: "Crypto", color: "#F4F6F4" },
  { key: "stables", label: "Stables", color: "#5F6760" },
] as const;

const RANGES: PriceRange[] = ["1D", "1W", "1M", "1Y"];

/** Expanded (full-page) portfolio: table layout + allocation + portfolio chart when history is genuinely available. */
export function DashboardHome() {
  const snap = useSnapshot();
  const account = useSelectedAccount();
  const navigate = useNavigate();
  const { market } = useApp();
  const { portfolio, loading, pricesPending, balancesError, refresh } = usePortfolio();
  const tab = useAppStore((s) => s.assetTab);
  const setTab = useAppStore((s) => s.setAssetTab);
  const { hidden } = useTokens();
  const [range, setRange] = useState<PriceRange>("1D");
  const watchOnly = account?.kind === "watch";

  // Portfolio history = Σ balance × price history — only when every priced holding has a history for the range.
  const holdingsKey = portfolio?.holdings.map((h) => `${h.token.address}:${h.raw}`).join("|") ?? "";
  const history = useQuery({
    queryKey: ["portfolio-history", market.id, holdingsKey, range],
    enabled: !!portfolio && portfolio.holdings.length > 0 && !portfolio.pricesUnavailable,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const priced = portfolio!.holdings.filter((h) => h.priceUsd !== null);
      const series = await Promise.all(priced.map((h) => market.getPriceHistory(h.token, range)));
      if (series.some((s) => !s || s.points.length < 2)) return { available: false as const, demo: false };
      const demo = series.some((s) => s!.demo);
      const base = series[0]!.points;
      const points = base.map((p, i) => {
        let total = 0;
        priced.forEach((h, k) => {
          const s = series[k]!.points;
          const pt = s[Math.min(s.length - 1, Math.round((i / (base.length - 1)) * (s.length - 1)))]!;
          total += h.units * pt.p;
        });
        return { t: p.t, p: total };
      });
      return { available: true as const, points, demo };
    },
  });

  const filtered = useMemo(() => (portfolio ? (tab === "all" ? portfolio.holdings : portfolio.holdings.filter((h) => h.bucket === tab)) : []), [portfolio, tab]);
  const slices = portfolio ? BUCKETS.map((b) => ({ value: portfolio.allocation[b.key], color: b.color, label: b.label })) : [];

  return (
    <div className="h-full overflow-y-auto py-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="card px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="label">{snap?.mode === "demo" ? "Demo portfolio" : "Portfolio value"}</div>
              {loading && !portfolio ? (
                <Skeleton w={200} h={36} className="mt-2" />
              ) : balancesError && !portfolio ? (
                <div className="display mt-1 text-[36px] text-ink-3">———</div>
              ) : (
                <>
                  <div className="display num mt-1 text-[36px] leading-none">{portfolio?.pricesUnavailable ? pricesPending ? <Skeleton w={180} h={32} /> : <span className="text-ink-3">———</span> : formatUsd(portfolio?.totalUsd ?? 0)}</div>
                  <div className="mt-2 flex items-center gap-2 text-[13px]">
                    {portfolio?.pricesUnavailable ? (
                      <span className={pricesPending ? "text-ink-3" : "text-warn"}>{pricesPending ? "Loading prices…" : "Price unavailable"}</span>
                    ) : (
                      <>
                        <span className={cx("num", (portfolio?.change24hUsd ?? 0) >= 0 ? "text-accent" : "text-loss")}>{portfolio?.change24hUsd === null || portfolio?.change24hUsd === undefined ? "—" : formatUsd(portfolio.change24hUsd, { signed: true })} today</span>
                        <PctChange value={portfolio?.change24hPct} size="md" />
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
            <Tabs value={range} onChange={setRange} items={RANGES.map((r) => ({ value: r, label: r }))} />
          </div>
          <div className="mt-4">
            {history.isPending && portfolio && portfolio.holdings.length > 0 ? (
              <Skeleton h={160} />
            ) : history.data?.available ? (
              <>
                <PriceChart points={history.data.points} height={160} formatValue={(v) => formatUsd(v)} formatTime={(t) => new Date(t).toLocaleString("en-US", range === "1D" ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" })} />
                <div className="mt-1 text-right text-[10px] uppercase tracking-wider text-ink-3">{history.data.demo ? "Demo history · balances × demo prices" : "Reconstructed from current balances × price history"}</div>
              </>
            ) : (
              <div className="flex h-[120px] items-center justify-center rounded-[10px] border border-dashed border-line text-center text-[12px] text-ink-3">
                Portfolio history is not available yet.
                <br />
                Current balances are shown below — nothing is estimated.
              </div>
            )}
          </div>
          {balancesError && !portfolio && (
            <Banner tone="warn" className="mt-3" title="Network connection issue">
              <button className="font-semibold underline" onClick={refresh}>
                Retry
              </button>{" "}
              or{" "}
              <button className="font-semibold underline" onClick={() => navigate("/settings/advanced")}>
                change RPC
              </button>
              .
            </Banner>
          )}
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2 md:grid-cols-2">
            <ActionTile label="Send" icon={<Icon.Send size={17} />} onClick={() => navigate("/send")} disabled={watchOnly} />
            <ActionTile label="Swap" icon={<Icon.Swap size={17} />} onClick={() => navigate("/swap")} disabled={watchOnly} />
            <ActionTile label="Receive" icon={<Icon.Receive size={17} />} onClick={() => navigate("/receive")} />
            <ActionTile label="Bridge" icon={<Icon.Bridge size={17} />} onClick={() => navigate("/bridge")} disabled={watchOnly} />
          </div>
          {portfolio && !portfolio.pricesUnavailable && portfolio.holdings.length > 0 && (
            <div className="card px-4 py-3">
              <div className="label">Allocation</div>
              <div className="mt-3 flex items-center gap-4">
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
                        <span className="num text-ink">{pct.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <AllocationBar slices={slices} className="mt-3" />
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <BackupReminder />
        {portfolio && !watchOnly && snap && <LowGasBanner gasWei={portfolio.gasBalanceWei} threshold={snap.settings.lowGasThresholdEth} />}
      </div>

      <div className="mt-5 flex items-center justify-between px-1">
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
      <div className="card mt-2 overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="label border-b border-line text-left">
              <th className="px-4 py-2.5 font-semibold">Asset</th>
              <th className="px-3 py-2.5 text-right font-semibold">Price</th>
              <th className="px-3 py-2.5 text-right font-semibold">24H</th>
              <th className="px-3 py-2.5 text-right font-semibold">Balance</th>
              <th className="px-4 py-2.5 text-right font-semibold">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && !portfolio ? (
              Array.from({ length: 4 }, (_, i) => (
                <tr key={i}>
                  <td className="px-4 py-3" colSpan={5}>
                    <Skeleton />
                  </td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-center text-ink-2" colSpan={5}>
                  {portfolio && portfolio.holdings.length === 0 ? (
                    <div>
                      No assets yet.{" "}
                      <Button size="xs" className="ml-2" onClick={() => navigate("/bridge")}>
                        Move funds to Robinhood Chain
                      </Button>
                    </div>
                  ) : (
                    "Nothing in this category."
                  )}
                </td>
              </tr>
            ) : (
              filtered.map((h) => (
                <tr key={h.token.address} className="cursor-pointer transition-colors hover:bg-card-2" onClick={() => navigate(`/asset/${h.token.address}`)}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <TokenAvatar symbol={h.token.symbol} category={h.token.category} size={30} />
                      <div>
                        <div className="font-medium text-ink">{h.token.symbol}</div>
                        <div className="text-[11px] text-ink-2">{displayName(h.token)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num px-3 py-2.5 text-right text-ink">{h.priceUsd === null ? <span className="text-[11px] text-ink-3">{pricesPending ? "…" : "unavailable"}</span> : formatUsd(h.priceUsd)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <PctChange value={h.change24hPct} />
                  </td>
                  <td className="num px-3 py-2.5 text-right text-ink">{h.formatted}</td>
                  <td className="num px-4 py-2.5 text-right font-medium text-ink">{h.valueUsd === null ? "—" : formatUsd(h.valueUsd)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {hidden.length > 0 && (
        <button className="mt-2 flex items-center gap-1.5 px-2 py-2 text-[12px] text-ink-3 hover:text-ink-2" onClick={() => navigate("/hidden")}>
          <Icon.Hidden size={14} /> {hidden.length} hidden token{hidden.length === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}

export { priceKey };
