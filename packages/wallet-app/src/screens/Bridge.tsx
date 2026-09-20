import { useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";
import type { Address, BridgeQuote, BridgeQuoteRequest, TxResult, TxReview } from "@frame/types";
import { BRIDGE_SOURCE_CHAIN_IDS, OFFICIAL_BRIDGE_URL, chainName } from "@frame/config";
import { formatTokenAmount, formatUsd } from "@frame/chain";
import { nativeToken } from "@frame/token-registry";
import { bestBridgeQuote } from "@frame/markets";
import { humanizeError } from "@frame/transaction-engine";
import { Banner, Button, Icon, ListRow, ScreenHeader, Sheet, Spinner, TokenAvatar, cx } from "@frame/ui";
import { useApp, useBackend } from "../context";
import { useSnapshot } from "../state/store";
import { useSelectedAccount, useSourceChainBalance, useTokenPrice } from "../data/hooks";
import { goBack, useNavigate } from "../nav";
import { ExplorerLink } from "../components/common";
import { TxReviewCard } from "../components/TxReviewCard";
import { ErrorBanner } from "./Send";

type Phase = "form" | "review" | "success";

const DEFAULT_SOURCE = BRIDGE_SOURCE_CHAIN_IDS[0]!;

export function BridgeScreen() {
  const { bridgeProviders, openExternal } = useApp();
  const backend = useBackend();
  const snap = useSnapshot();
  const account = useSelectedAccount();
  const navigate = useNavigate();
  const [fromChain, setFromChain] = useState<number>(DEFAULT_SOURCE);
  const eth = useMemo(() => nativeToken(fromChain), [fromChain]);
  const price = useTokenPrice(eth);
  const sourceBalance = useSourceChainBalance(account?.address, fromChain);
  const [amount, setAmount] = useState("");
  const [quotes, setQuotes] = useState<{ best: BridgeQuote | null; all: BridgeQuote[]; errors: { providerId: string; error: string }[] } | null>(null);
  const [selected, setSelected] = useState<BridgeQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [routes, setRoutes] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [review, setReview] = useState<TxReview | null>(null);
  const [result, setResult] = useState<TxResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; message: string; technical: string } | null>(null);
  const [showTech, setShowTech] = useState(false);

  const parsed = useMemo(() => {
    if (!amount) return null;
    try {
      const v = parseUnits(amount.replace(/,/g, ""), 18);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }, [amount]);
  const balance = sourceBalance.data ? BigInt(sourceBalance.data) : null;
  const exceeds = balance !== null && parsed !== null && parsed > balance;
  const watchOnly = account?.kind === "watch";
  const toChain = snap?.chainId ?? 4663;
  const noProviders = bridgeProviders.length === 0;

  useEffect(() => {
    setQuotes(null);
    setSelected(null);
    if (parsed === null || !account || noProviders) return;
    let cancelled = false;
    setQuoting(true);
    const req: BridgeQuoteRequest = { fromChainId: fromChain, toChainId: toChain, token: eth, amountIn: parsed.toString(), account: account.address };
    const t = window.setTimeout(() => {
      bestBridgeQuote(bridgeProviders, req)
        .then((r) => {
          if (cancelled) return;
          setQuotes(r);
          setSelected(r.best);
        })
        .finally(() => {
          if (!cancelled) setQuoting(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [parsed, account, bridgeProviders, eth, fromChain, toChain, noProviders]);

  const start = async () => {
    if (!selected?.tx) return;
    setBusy(true);
    setError(null);
    try {
      const r = await backend.prepareTransaction({ request: selected.tx, meta: { kind: "bridge", provider: selected.providerName, fromChain: String(fromChain), toChain: String(toChain) } });
      setReview(r);
      setPhase("review");
    } catch (e) {
      const h = humanizeError(e);
      setError({ title: h.title, message: h.message, technical: h.technical });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      const res = await backend.confirmTransaction({ reviewId: review.reviewId });
      setResult(res);
      setPhase("success");
    } catch (e) {
      const h = humanizeError(e);
      setError({ title: h.title, message: h.message, technical: h.technical });
    } finally {
      setBusy(false);
    }
  };

  const outFormatted = selected ? formatTokenAmount(BigInt(selected.amountOut), 18) : null;
  const eta = selected?.estimatedSeconds === null || selected?.estimatedSeconds === undefined ? "—" : selected.estimatedSeconds < 90 ? `~${selected.estimatedSeconds} sec` : `~${Math.round(selected.estimatedSeconds / 60)} min`;

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title={phase === "review" ? "Review" : "Move to Robinhood Chain"}
        onBack={phase === "success" ? undefined : phase === "review" ? () => { if (review) void backend.discardReview({ reviewId: review.reviewId }); setPhase("form"); } : () => goBack("/")}
        subtitle={`${chainName(fromChain)} → ${chainName(toChain)}`}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {phase === "form" && (
          <div className="space-y-2">
            {watchOnly && (
              <Banner tone="info" title="Watch only">
                This account cannot sign.
              </Banner>
            )}
            {noProviders && (
              <Banner tone="warn" title="Bridging unavailable">
                No route provider is configured for this build. You can still use the official bridge below.
              </Banner>
            )}
            <div className="flex gap-1.5">
              {BRIDGE_SOURCE_CHAIN_IDS.map((id) => (
                <SourceChip key={id} chainId={id} address={account?.address} active={id === fromChain} onClick={() => setFromChain(id)} />
              ))}
            </div>
            <div className="card px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="label">From · {chainName(fromChain)}</span>
                <button className="text-[12px] text-ink-2 hover:text-ink" onClick={() => balance !== null && setAmount(formatTokenAmount(balance, 18, 18).replace(/,/g, ""))}>
                  {balance === null ? (sourceBalance.isError ? "Balance unavailable" : "Loading balance…") : `Balance ${formatTokenAmount(balance, 18)} ETH`} {balance !== null && <span className="font-semibold text-accent">· Max</span>}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input className={cx("num min-w-0 flex-1 bg-transparent text-[26px] font-semibold text-ink outline-none placeholder:text-ink-3", exceeds && "text-loss")} placeholder="0" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ""))} />
                <span className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-3">
                  <TokenAvatar symbol="ETH" category="native" size={24} />
                  <span className="text-[13px] font-semibold text-ink">ETH</span>
                </span>
              </div>
              <div className="mt-1 text-[12px] text-ink-3">{price.data?.priceUsd && parsed ? `≈ ${formatUsd((Number(parsed) / 1e18) * price.data.priceUsd)}` : ""}</div>
            </div>
            <div className="flex justify-center text-ink-3">
              <Icon.Receive size={18} />
            </div>
            <div className="card px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="label">To · {chainName(toChain)}</span>
                {quoting && <Spinner size={12} className="text-ink-3" />}
              </div>
              <div className="num mt-2 text-[26px] font-semibold text-ink">{outFormatted ? `${outFormatted} ETH` : <span className="text-ink-3">0 ETH</span>}</div>
              <div className="mt-1 text-[12px] text-ink-3">{selected ? `Estimated · ${eta}` : "Arrives in your Robinhood Chain account"}</div>
            </div>
            {exceeds && (
              <Banner tone="danger" title={`Not enough ETH on ${chainName(fromChain)}`}>
                You hold {balance !== null ? formatTokenAmount(balance, 18) : "0"} ETH there.
              </Banner>
            )}
            {quotes && !selected && parsed !== null && !quoting && (
              <Banner tone="warn" title="No route found">
                {quotes.errors.length ? quotes.errors.map((e) => `${e.providerId}: ${e.error}`).join(" · ") : "No bridge returned a quote for this amount."}
              </Banner>
            )}
            {selected && (
              <div className="card-flat divide-y divide-line px-4 text-[12px]">
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-ink-2">Best route</span>
                  <button className="inline-flex items-center gap-1 font-semibold text-ink" onClick={() => setRoutes(true)}>
                    {selected.providerName} <Icon.ChevronRight size={13} />
                  </button>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-ink-2">Estimated receive</span>
                  <span className="num text-ink">{outFormatted} ETH</span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-ink-2">Estimated time</span>
                  <span className="num text-ink">{eta}</span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-ink-2">Fees</span>
                  <span className="num text-ink">{selected.feeUsd === null ? "—" : formatUsd(selected.feeUsd)}</span>
                </div>
                {selected.demo && (
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-ink-2">Mode</span>
                    <span className="text-accent">Simulated route</span>
                  </div>
                )}
              </div>
            )}
            {error && <ErrorBanner error={error} showTech={showTech} onToggle={() => setShowTech((v) => !v)} />}
            <Button variant="primary" full disabled={!selected?.tx || exceeds || watchOnly} loading={busy} onClick={start}>
              MOVE FUNDS
            </Button>
            <p className="px-1 text-center text-[11px] text-ink-3">
              Routes come from existing bridge protocols through their adapters. The transaction is signed on {chainName(fromChain)} and settles on {chainName(toChain)}.
            </p>
            <button className="mx-auto flex items-center gap-1 text-[11px] font-medium text-ink-2 hover:text-ink" onClick={() => openExternal(OFFICIAL_BRIDGE_URL)}>
              Prefer the canonical bridge? Open the official Arbitrum portal <Icon.External size={11} />
            </button>
          </div>
        )}

        {phase === "review" && review && (
          <div className="space-y-3 px-1 pt-1">
            <div className="card px-4 py-4 text-center">
              <div className="label">Move to Robinhood Chain</div>
              <div className="mt-2 text-[13px] text-ink-2">{chainName(fromChain)}</div>
              <div className="display num text-[22px] text-ink">{amount} ETH</div>
              <div className="my-1 text-ink-3">↓</div>
              <div className="text-[13px] text-ink-2">{chainName(toChain)}</div>
              <div className="display num text-[22px] text-ink">{outFormatted} ETH</div>
              <div className="mt-2 text-[12px] text-ink-3">
                Estimated {eta} · Fee {selected?.feeUsd === null || selected?.feeUsd === undefined ? "—" : formatUsd(selected.feeUsd)}
              </div>
            </div>
            <TxReviewCard review={review} compact />
            {error && <ErrorBanner error={error} showTech={showTech} onToggle={() => setShowTech((v) => !v)} />}
            <Button variant={review.riskLevel === "high" ? "danger" : "primary"} full loading={busy} onClick={confirm}>
              MOVE FUNDS
            </Button>
          </div>
        )}

        {phase === "success" && result && (
          <div className="flex flex-col items-center px-4 pt-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-base">
              <Icon.Check size={26} />
            </span>
            <div className="display mt-5 text-[22px] text-ink">FUNDS ON THE WAY</div>
            <div className="num mt-1 text-[14px] text-ink-2">
              {amount} ETH → {chainName(toChain)} · {eta}
            </div>
            {result.demo && <div className="mt-2 text-[11px] uppercase tracking-[0.12em] text-accent">Simulated — arrives in a few seconds, nothing was broadcast</div>}
            <div className="mt-4">
              <ExplorerLink url={result.explorerUrl} />
            </div>
            <Button variant="primary" className="mt-8" full onClick={() => navigate("/activity", undefined, { replace: true })}>
              VIEW ACTIVITY
            </Button>
            <Button variant="ghost" className="mt-2" full onClick={() => navigate("/", undefined, { replace: true })}>
              DONE
            </Button>
          </div>
        )}
      </div>

      <Sheet open={routes} onClose={() => setRoutes(false)} title="Bridge routes">
        {quotes && (
          <div className="space-y-2">
            {quotes.all.map((q, i) => (
              <ListRow
                key={q.providerId}
                className={cx("card", q.providerId === selected?.providerId && "border-accent")}
                title={
                  <span className="flex items-center gap-2">
                    {q.providerName}
                    {i === 0 && <span className="pill pill-accent">Best</span>}
                  </span>
                }
                subtitle={`${q.estimatedSeconds === null ? "—" : `~${q.estimatedSeconds}s`} · fee ${q.feeUsd === null ? "—" : formatUsd(q.feeUsd)} · ${q.route.join(" → ")}`}
                trailing={<span className="num text-[13px] text-ink">{formatTokenAmount(BigInt(q.amountOut), 18)} ETH</span>}
                onClick={() => {
                  setSelected(q);
                  setRoutes(false);
                }}
              />
            ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}

/** One source chain with the account's ETH balance there — so people bridge from where they actually hold funds. */
function SourceChip({ chainId, address, active, onClick }: { chainId: number; address?: Address; active: boolean; onClick: () => void }) {
  const balance = useSourceChainBalance(address, chainId);
  const value = balance.data ? BigInt(balance.data) : null;
  return (
    <button onClick={onClick} className={cx("flex min-w-0 flex-1 flex-col items-start rounded-[12px] border px-3 py-2 text-left transition-colors", active ? "border-accent bg-accent-dim" : "border-line bg-card hover:bg-card-2")}>
      <span className={cx("text-[12px] font-semibold", active ? "text-ink" : "text-ink-2")}>{chainName(chainId)}</span>
      <span className="num mt-0.5 text-[11px] text-ink-3">{value === null ? (balance.isError ? "—" : "…") : `${formatTokenAmount(value, 18, 4)} ETH`}</span>
    </button>
  );
}
