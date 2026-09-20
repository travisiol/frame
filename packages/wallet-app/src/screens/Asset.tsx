import { useMemo, useState } from "react";
import type { PriceRange } from "@frame/types";
import { explorerTokenUrl } from "@frame/config";
import { formatCompact, formatUsd, shortAddress } from "@frame/chain";
import { displayName, exposureLabel, isStockLike } from "@frame/token-registry";
import { marketStatusLabel } from "@frame/markets";
import { Banner, Button, Icon, IconButton, KeyValue, PctChange, PriceChart, ScreenHeader, Skeleton, Tabs, TokenAvatar, cx } from "@frame/ui";
import { useApp, useBackend } from "../context";
import { useSnapshot } from "../state/store";
import { useMarketMetadata, useMarketStatus, usePortfolio, usePriceHistory, useSelectedAccount, useTokenPrice, useTokens } from "../data/hooks";
import { goBack, useNavigate, useRoute } from "../nav";
import { AddressLine, CategoryPill, ExplorerLink, VerifiedBadge } from "../components/common";

const RANGES: PriceRange[] = ["1H", "1D", "1W", "1M", "1Y"];

export function AssetScreen() {
  const { params, path } = useRoute();
  const key = decodeURIComponent(path.split("/")[2] ?? params.address ?? "");
  const { lookup } = useTokens();
  const token = lookup(key as `0x${string}` | "native");
  const snap = useSnapshot();
  const account = useSelectedAccount();
  const backend = useBackend();
  const { openExternal } = useApp();
  const navigate = useNavigate();
  const { portfolio } = usePortfolio();
  const [range, setRange] = useState<PriceRange>("1D");
  const price = useTokenPrice(token);
  const history = usePriceHistory(token, range);
  const status = useMarketStatus(token);
  const meta = useMarketMetadata(token);
  const holding = useMemo(() => portfolio?.holdings.find((h) => h.token.address === token?.address), [portfolio, token]);
  const inWatchlist = !!token && (snap?.watchlist ?? []).includes(token.symbol);
  const watchOnly = account?.kind === "watch";

  if (!token) {
    return (
      <div className="flex h-full flex-col">
        <ScreenHeader title="Asset" onBack={() => goBack()} />
        <div className="px-4 text-[13px] text-ink-2">This token is not in your wallet.</div>
      </div>
    );
  }

  const stock = isStockLike(token);
  const priceUsd = price.data?.priceUsd ?? null;
  const change = price.data?.change24hPct ?? null;
  const rangeChange = (() => {
    const pts = history.data?.points;
    if (!pts || pts.length < 2) return null;
    const a = pts[0]!.p;
    const b = pts[pts.length - 1]!.p;
    return a > 0 ? ((b - a) / a) * 100 : null;
  })();
  const explorer = token.address !== "native" ? explorerTokenUrl(token.chainId, token.address) : undefined;

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title={token.symbol}
        subtitle={displayName(token)}
        onBack={() => goBack()}
        trailing={
          <IconButton label={inWatchlist ? "Remove from watchlist" : "Add to watchlist"} onClick={() => void backend.toggleWatchlist({ key: token.symbol })}>
            <Icon.Star size={17} filled={inWatchlist} className={cx(inWatchlist && "text-accent")} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <div className="flex items-start gap-3">
          <TokenAvatar symbol={token.symbol} category={token.category} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <CategoryPill token={token} />
              <VerifiedBadge token={token} />
            </div>
            <div className="mt-1 text-[12px] text-ink-2">{exposureLabel(token)}</div>
          </div>
        </div>

        <div className="mt-4">
          <div className="label">{price.data?.source === "lifi" ? "Onchain price" : stock ? "Reference price" : "Current price"}</div>
          <div className="display num mt-1 text-[28px] leading-none text-ink">
            {price.isPending ? <Skeleton w={120} h={28} /> : priceUsd === null ? <span className="text-[16px] text-warn">Price unavailable</span> : formatUsd(priceUsd)}
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[12px]">
            <span className="text-ink-2">24H</span>
            <PctChange value={change} />
            {price.data?.demo && <span className="text-[10px] uppercase tracking-wider text-ink-3">demo price</span>}
            {price.data?.source === "lifi" && <span className="text-[10px] uppercase tracking-wider text-ink-3">onchain · via LI.FI</span>}
            {rangeChange !== null && range !== "1D" && (
              <span className="text-ink-3">
                · {range} <PctChange value={rangeChange} />
              </span>
            )}
          </div>
          {stock && status.data && (
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <span className={cx("pill", status.data === "open" ? "pill-accent" : "pill-muted")}>{marketStatusLabel(status.data)}</span>
              <span className="text-ink-3">Underlying market · the token itself trades onchain 24/7</span>
            </div>
          )}
        </div>

        <div className="mt-4 card px-2 pb-2 pt-3">
          {history.isPending ? (
            <div className="h-[150px] px-2">
              <Skeleton h={150} />
            </div>
          ) : (
            <PriceChart
              points={history.data?.points ?? []}
              height={150}
              formatValue={(v) => formatUsd(v)}
              formatTime={(t) => new Date(t).toLocaleString("en-US", range === "1H" || range === "1D" ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" })}
            />
          )}
          <div className="mt-2 flex items-center justify-between px-2">
            <Tabs value={range} onChange={setRange} items={RANGES.map((r) => ({ value: r, label: r }))} />
            {history.data?.demo && <span className="text-[10px] uppercase tracking-wider text-ink-3">demo</span>}
            {history.data && !history.data.demo && <span className="text-[10px] uppercase tracking-wider text-ink-3">{history.data.source}</span>}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="primary" full leading={<Icon.Swap size={15} />} disabled={watchOnly} onClick={() => navigate("/swap", { to: token.address })}>
            BUY / SWAP
          </Button>
          <Button full leading={<Icon.Send size={15} />} disabled={watchOnly || !holding} onClick={() => navigate("/send", { asset: token.address })}>
            SEND
          </Button>
          <Button full leading={<Icon.Receive size={15} />} onClick={() => navigate("/receive")}>
            RECEIVE
          </Button>
        </div>

        <div className="mt-5">
          <div className="label">Your position</div>
          <div className="card mt-2 px-4">
            <KeyValue
              rows={[
                { label: "Your balance", value: holding ? `${holding.formatted} ${token.symbol}` : `0 ${token.symbol}` },
                { label: "Current value", value: holding ? (holding.valueUsd === null ? "Price unavailable" : formatUsd(holding.valueUsd)) : "—" },
                { label: "Average entry", value: <span className="text-ink-2">Cost basis unavailable</span> },
                { label: "Unrealized P&L", value: <span className="text-ink-2">Cost basis unavailable</span> },
                ...(holding?.change24hUsd !== null && holding?.change24hUsd !== undefined ? [{ label: "Today", value: <span className={holding.change24hUsd >= 0 ? "text-accent" : "text-loss"}>{formatUsd(holding.change24hUsd, { signed: true })}</span> }] : []),
              ]}
            />
          </div>
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-ink-3">Cost basis is only computed from transaction history when it can be established reliably. It is never estimated.</p>
        </div>

        {stock && (
          <Banner tone="info" className="mt-4" title={`${token.symbol} Stock Token`}>
            Tokenized exposure to {token.underlying?.name ?? token.symbol}. Holding this token is not the same as owning the underlying {token.underlying?.type === "etf" ? "fund" : "equity"} or its shareholder rights.
          </Banner>
        )}
        {!token.verified && token.address !== "native" && (
          <Banner tone="warn" className="mt-4" title="Unverified token">
            This contract is not in the verified token registry. Its name and ticker prove nothing about what it is.
          </Banner>
        )}

        <div className="mt-5">
          <div className="label">About</div>
          <div className="card mt-2 px-4">
            <KeyValue
              rows={[
                { label: "Name", value: token.name },
                ...(token.underlying ? [{ label: "Underlying", value: `${token.underlying.ticker} · ${token.underlying.name}` }] : []),
                { label: "Contract", value: token.address === "native" ? "Native asset (gas)" : <AddressLine address={token.address} chars={6} /> },
                { label: "Decimals", value: String(token.decimals) },
                ...(meta.data?.marketCap ? [{ label: "Market cap", value: `${formatUsd(meta.data.marketCap, { compact: true })}${meta.data.source === "demo" ? " (demo)" : ""}` }] : []),
                ...(meta.data?.volume24h ? [{ label: "24h volume", value: `${formatCompact(meta.data.volume24h)}${meta.data.source === "demo" ? " (demo)" : ""}` }] : []),
                ...(meta.data?.holders ? [{ label: "Holders", value: `${formatCompact(meta.data.holders)}${meta.data.source === "demo" ? " (demo)" : ""}` }] : []),
                ...(meta.data?.liquidityUsd ? [{ label: "Liquidity", value: `${formatUsd(meta.data.liquidityUsd, { compact: true })}${meta.data.source === "demo" ? " (demo)" : ""}` }] : []),
                ...(meta.data?.ageDays ? [{ label: "Age", value: `${meta.data.ageDays} days${meta.data.source === "demo" ? " (demo)" : ""}` }] : []),
                ...(token.addedAt ? [{ label: "Verified since", value: token.addedAt }] : []),
              ]}
            />
            {explorer && (
              <div className="pb-3 pt-1">
                <ExplorerLink url={explorer}>View contract in explorer</ExplorerLink>
              </div>
            )}
          </div>
          {token.custom && (
            <Button variant="ghost" size="sm" className="mt-2 text-loss" onClick={() => void backend.removeCustomToken({ address: token.address }).then(() => goBack())}>
              Remove imported token
            </Button>
          )}
          {!token.verified && token.address !== "native" && !token.custom && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => void backend.setTokenHidden({ address: token.address, hidden: true }).then(() => goBack())}>
              Hide this token
            </Button>
          )}
          {token.address !== "native" && (
            <button className="mt-3 block text-[11px] text-ink-3" onClick={() => openExternal(explorer ?? "")}>
              {shortAddress(token.address, 8)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
