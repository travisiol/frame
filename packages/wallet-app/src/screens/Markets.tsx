import { useEffect, useMemo, useState } from "react";
import type { Address, TokenInfo } from "@frame/types";
import { explorerTokenUrl } from "@frame/config";
import { formatUsd, isValidAddress, readTokenMetadata } from "@frame/chain";
import { STOCK_LIKE_CATEGORIES, displayName, exposureLabel, findBySymbol, isAddressLike, makeUnknownToken, searchRegistry } from "@frame/token-registry";
import { priceKey } from "@frame/markets";
import { Banner, Button, Icon, IconButton, PctChange, Pill, ScreenHeader, Skeleton, Sparkline, TokenAvatar, cx } from "@frame/ui";
import { useApp, useBackend } from "../context";
import { useSnapshot } from "../state/store";
import { useChainClient, useChainId, usePriceHistory, usePrices, useTokens } from "../data/hooks";
import { useNavigate } from "../nav";
import { AssetRow, ExplorerLink, VerifiedBadge } from "../components/common";

type Lookup = { state: "idle" } | { state: "loading" } | { state: "found"; token: TokenInfo } | { state: "not-contract" } | { state: "error"; message: string };

export function MarketsScreen() {
  const snap = useSnapshot();
  const chainId = useChainId();
  const backend = useBackend();
  const { openExternal } = useApp();
  const navigate = useNavigate();
  const client = useChainClient();
  const { visible, all, lookup: lookupToken } = useTokens();
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  const prices = usePrices(visible);

  const results = useMemo(() => (query.trim() ? searchRegistry(chainId, query, 100) : []), [query, chainId]);
  const watch = snap?.watchlist ?? [];

  useEffect(() => {
    const q = query.trim();
    if (!isAddressLike(q)) {
      setLookup({ state: "idle" });
      return;
    }
    const known = lookupToken(q as Address);
    if (known) {
      setLookup({ state: "found", token: known });
      return;
    }
    let cancelled = false;
    setLookup({ state: "loading" });
    readTokenMetadata(client, q as Address)
      .then((meta) => {
        if (cancelled) return;
        if (!meta) setLookup({ state: "not-contract" });
        else setLookup({ state: "found", token: makeUnknownToken(chainId, q as Address, meta) });
      })
      .catch((e: unknown) => {
        if (!cancelled) setLookup({ state: "error", message: e instanceof Error ? e.message : "Lookup failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [query, client, chainId, lookupToken]);

  const priced = useMemo(() => {
    const px = prices.data ?? {};
    return visible
      .filter((t) => t.address !== "native" || true)
      .map((t) => ({ token: t, quote: px[priceKey(t)] }))
      .filter((x) => x.quote?.priceUsd !== null && x.quote?.priceUsd !== undefined);
  }, [visible, prices.data]);

  const stockTokens = useMemo(() => visible.filter((t) => STOCK_LIKE_CATEGORIES.has(t.category)), [visible]);
  const rwa = useMemo(() => visible.filter((t) => t.category === "rwa" || (t.category === "etf" && t.underlying?.type === "commodity")), [visible]);
  const movers = useMemo(() => [...priced].filter((x) => x.quote?.change24hPct !== null).sort((a, b) => Math.abs(b.quote!.change24hPct!) - Math.abs(a.quote!.change24hPct!)).slice(0, 6), [priced]);
  const trending = useMemo(() => [...priced].filter((x) => (x.quote?.change24hPct ?? 0) > 0).sort((a, b) => (b.quote!.change24hPct ?? 0) - (a.quote!.change24hPct ?? 0)).slice(0, 6), [priced]);
  const newest = useMemo(() => [...all].filter((t) => t.addedAt).sort((a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? "")).slice(0, 6), [all]);
  const newTokens = useMemo(() => all.filter((t) => !t.verified && t.address !== "native"), [all]);
  const watchTokens = useMemo(() => watch.map((s) => findBySymbol(chainId, s)[0] ?? all.find((t) => t.symbol === s)).filter((t): t is TokenInfo => !!t), [watch, chainId, all]);

  const open = (t: TokenInfo) => navigate(`/asset/${t.address}`);
  const q = query.trim();

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Markets" subtitle="Stock Tokens, crypto and RWA on Robinhood Chain" />
      <div className="px-3 pb-2">
        <div className="relative">
          <Icon.Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input className="input pl-9" placeholder="Search NVDA, AAPL, SPY… or paste a contract address" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" spellCheck={false} />
          {query && (
            <IconButton label="Clear" className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2" onClick={() => setQuery("")}>
              <Icon.Close size={14} />
            </IconButton>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {q ? (
          <div className="space-y-2">
            {isAddressLike(q) ? (
              <ContractLookup lookup={lookup} chainId={chainId} onOpen={open} onImport={(t) => void backend.addCustomToken({ token: t }).then(() => open(t))} openExternal={openExternal} />
            ) : results.length === 0 ? (
              <div className="px-2 py-8 text-center text-[13px] text-ink-2">
                No verified token matches “{q}”.
                <div className="mt-1 text-[12px] text-ink-3">Paste a contract address to look up any ERC-20.</div>
              </div>
            ) : (
              results.map((t) => <MarketRow key={t.address} token={t} quote={prices.data?.[priceKey(t)]} onClick={() => open(t)} />)
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <Section title="Watchlist" empty={watchTokens.length === 0 ? "Star an asset to track it here — no need to own it." : undefined}>
              {watchTokens.map((t) => (
                <MarketRow key={t.address} token={t} quote={prices.data?.[priceKey(t)]} onClick={() => open(t)} spark />
              ))}
            </Section>
            <Section title="Stock Tokens" trailing={<span className="text-[11px] text-ink-3">{stockTokens.length} verified</span>}>
              {stockTokens.slice(0, 8).map((t) => (
                <MarketRow key={t.address} token={t} quote={prices.data?.[priceKey(t)]} onClick={() => open(t)} />
              ))}
              {stockTokens.length > 8 && (
                <Button variant="ghost" size="sm" full onClick={() => setQuery("• Robinhood")}>
                  Show all {stockTokens.length}
                </Button>
              )}
            </Section>
            <Section title="Trending" empty={prices.isPending ? undefined : trending.length === 0 ? "Nothing is moving up right now." : undefined}>
              {prices.isPending && <RowSkeletons n={3} />}
              {trending.map((x) => (
                <MarketRow key={x.token.address} token={x.token} quote={x.quote} onClick={() => open(x.token)} spark />
              ))}
            </Section>
            <Section title="Top movers">
              {prices.isPending && <RowSkeletons n={3} />}
              {movers.map((x) => (
                <MarketRow key={x.token.address} token={x.token} quote={x.quote} onClick={() => open(x.token)} />
              ))}
            </Section>
            <Section title="RWA">
              {rwa.map((t) => (
                <MarketRow key={t.address} token={t} quote={prices.data?.[priceKey(t)]} onClick={() => open(t)} />
              ))}
            </Section>
            <Section title="Newly verified" trailing={<span className="text-[11px] text-ink-3">registry updated {newest[0]?.addedAt}</span>}>
              {newest.map((t) => (
                <MarketRow key={t.address} token={t} quote={prices.data?.[priceKey(t)]} onClick={() => open(t)} />
              ))}
            </Section>
            <Section title="New tokens" empty={newTokens.length === 0 ? "Unknown tokens you receive or import will appear here, never as verified." : undefined}>
              {newTokens.map((t) => (
                <MarketRow key={t.address} token={t} quote={prices.data?.[priceKey(t)]} onClick={() => open(t)} />
              ))}
            </Section>
            <p className="px-2 text-[11px] leading-relaxed text-ink-3">Verified means the contract address is in {snap?.mode === "demo" ? "the" : "FRAME's"} token registry. Unverified tokens are never promoted as safe, regardless of their name.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children, trailing, empty }: { title: string; children: React.ReactNode; trailing?: React.ReactNode; empty?: string }) {
  const hasChildren = Array.isArray(children) ? children.some((c) => c && (!Array.isArray(c) || c.length > 0)) : !!children;
  return (
    <div>
      <div className="flex items-center justify-between px-1">
        <span className="label">{title}</span>
        {trailing}
      </div>
      <div className="mt-1.5 space-y-0.5">{hasChildren ? children : empty ? <div className="px-2 py-3 text-[12px] text-ink-3">{empty}</div> : null}</div>
    </div>
  );
}

function RowSkeletons({ n }: { n: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="row">
          <Skeleton w={36} h={36} className="rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton w={90} />
            <Skeleton w={140} h={10} />
          </div>
          <Skeleton w={60} />
        </div>
      ))}
    </>
  );
}

export function MarketRow({ token, quote, onClick, spark }: { token: TokenInfo; quote?: { priceUsd: number | null; change24hPct: number | null; demo?: boolean }; onClick: () => void; spark?: boolean }) {
  return (
    <AssetRow
      token={token}
      onClick={onClick}
      subtitleOverride={
        <span className="flex items-center gap-1.5">
          {token.underlying && token.category !== "native" ? `${token.underlying.name} · ${exposureLabel(token)}` : exposureLabel(token)}
          {quote?.demo && <span className="text-[9px] uppercase tracking-wider text-ink-3">demo</span>}
        </span>
      }
      trailingOverride={
        <div className="flex items-center gap-3">
          {spark && <SparkFor token={token} />}
          <div>
            <div className="num text-[14px] font-medium text-ink">{quote?.priceUsd === null || quote?.priceUsd === undefined ? <span className="text-[11px] font-normal text-ink-3">Price unavailable</span> : formatUsd(quote.priceUsd)}</div>
            <div className="mt-0.5 text-right">
              <PctChange value={quote?.change24hPct} />
            </div>
          </div>
        </div>
      }
    />
  );
}

function SparkFor({ token }: { token: TokenInfo }) {
  const h = usePriceHistory(token, "1D");
  if (!h.data) return <span className="inline-block" style={{ width: 64, height: 24 }} />;
  return <Sparkline points={h.data.points} width={64} height={24} />;
}

function ContractLookup({ lookup, chainId, onOpen, onImport, openExternal }: { lookup: Lookup; chainId: number; onOpen: (t: TokenInfo) => void; onImport: (t: TokenInfo) => void; openExternal: (url: string) => void }) {
  if (lookup.state === "loading") return <RowSkeletons n={1} />;
  if (lookup.state === "not-contract")
    return (
      <Banner tone="warn" title="No contract at this address">
        The address is valid but holds no code on this network.
      </Banner>
    );
  if (lookup.state === "error")
    return (
      <Banner tone="warn" title="Lookup failed">
        {lookup.message}
      </Banner>
    );
  if (lookup.state !== "found") return null;
  const t = lookup.token;
  const impostor = !t.verified && findBySymbol(chainId, t.symbol).length > 0;
  return (
    <div className="card px-4 py-4">
      <div className="flex items-start gap-3">
        <TokenAvatar symbol={t.symbol} category={t.category} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-ink">{t.symbol}</span>
            <VerifiedBadge token={t} />
          </div>
          <div className="truncate text-[12px] text-ink-2">{t.name}</div>
          <div className="mono mt-1 break-all text-[11px] text-ink-3">{t.address}</div>
        </div>
      </div>
      {!t.verified && (
        <Banner tone="warn" className="mt-3" title={impostor ? `⚠ Unverified token using the “${t.symbol}” ticker` : "⚠ Unverified token"}>
          This token is not present in the verified token registry.{impostor ? ` A verified ${t.symbol} exists at a different address — this one is not it.` : " Its name and ticker prove nothing about what it is."}
        </Banner>
      )}
      <div className="mt-3 flex gap-2">
        {t.verified || (t.custom ?? false) ? (
          <Button variant="primary" size="sm" full onClick={() => onOpen(t)}>
            View asset
          </Button>
        ) : (
          <Button size="sm" full onClick={() => onImport(t)} disabled={!isValidAddress(t.address)}>
            Import as custom token
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => openExternal(explorerTokenUrl(chainId, t.address))} leading={<Icon.External size={14} />}>
          Explorer
        </Button>
      </div>
      <div className={cx("mt-2 text-[11px] text-ink-3")}>Decimals {t.decimals} · {t.verified ? "Verified contract" : "Unknown contract"}</div>
      {!t.verified && (
        <div className="mt-1">
          <Pill tone="muted">Not promoted as safe</Pill>
        </div>
      )}
      <ExplorerLink url={explorerTokenUrl(chainId, t.address)} />
    </div>
  );
}
