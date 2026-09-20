import { useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";
import type { Address, SwapQuote, SwapQuoteRequest, SwapStep, TokenInfo, TxResult, TxReview } from "@frame/types";
import { chainName } from "@frame/config";
import { formatTokenAmount, formatUsd } from "@frame/chain";
import { displayName, isStockLike } from "@frame/token-registry";
import { bestSwapQuote, priceKey } from "@frame/markets";
import { humanizeError } from "@frame/transaction-engine";
import { Banner, Button, Icon, IconButton, ListRow, ScreenHeader, Segmented, Sheet, Spinner, TokenAvatar, cx } from "@frame/ui";
import { useApp, useBackend } from "../context";
import { useSnapshot } from "../state/store";
import { usePortfolio, usePrices, useSelectedAccount, useTokens } from "../data/hooks";
import { goBack, useNavigate, useRoute } from "../nav";
import { AssetRow, ExplorerLink } from "../components/common";
import { TxReviewCard } from "../components/TxReviewCard";
import { ErrorBanner } from "./Send";

type Phase = "form" | "review" | "success";

export function SwapScreen() {
  const { params } = useRoute();
  const { swapProviders, market } = useApp();
  const backend = useBackend();
  const snap = useSnapshot();
  const account = useSelectedAccount();
  const navigate = useNavigate();
  const { visible, lookup } = useTokens();
  const { portfolio } = usePortfolio();
  const prices = usePrices(visible);

  const defaultFrom = useMemo(() => portfolio?.holdings.find((h) => h.token.category === "stable")?.token ?? portfolio?.holdings[0]?.token ?? lookup("native"), [portfolio, lookup]);
  const [fromToken, setFromToken] = useState<TokenInfo | undefined>(() => (params.from ? lookup(params.from as Address) : undefined));
  const [toToken, setToToken] = useState<TokenInfo | undefined>(() => (params.to ? lookup(params.to as Address) : visible.find((t) => t.symbol === "NVDA")));
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippage] = useState(50);
  const [picker, setPicker] = useState<"from" | "to" | null>(null);
  const [quotes, setQuotes] = useState<{ best: SwapQuote | null; all: SwapQuote[]; errors: { providerId: string; error: string }[] } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [selected, setSelected] = useState<SwapQuote | null>(null);
  const [routes, setRoutes] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [steps, setSteps] = useState<SwapStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [review, setReview] = useState<TxReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; message: string; technical: string } | null>(null);
  const [showTech, setShowTech] = useState(false);
  const [results, setResults] = useState<TxResult[]>([]);

  const from = fromToken ?? defaultFrom;
  const fromHolding = portfolio?.holdings.find((h) => h.token.address === from?.address);
  const parsed = useMemo(() => {
    if (!from || !amount) return null;
    try {
      const v = parseUnits(amount.replace(/,/g, ""), from.decimals);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }, [amount, from]);
  const exceeds = !!fromHolding && parsed !== null && parsed > fromHolding.raw;
  const fromPrice = from ? prices.data?.[priceKey(from)]?.priceUsd ?? null : null;
  const toPrice = toToken ? prices.data?.[priceKey(toToken)]?.priceUsd ?? null : null;
  const watchOnly = account?.kind === "watch";
  const noProviders = swapProviders.length === 0;

  // Quote whenever the inputs settle.
  useEffect(() => {
    setQuotes(null);
    setSelected(null);
    if (!from || !toToken || parsed === null || !account || from.address === toToken.address || noProviders) return;
    let cancelled = false;
    setQuoting(true);
    const req: SwapQuoteRequest = { chainId: snap!.chainId, fromToken: from, toToken, amountIn: parsed.toString(), slippageBps, account: account.address };
    const t = window.setTimeout(() => {
      bestSwapQuote(swapProviders, req, toPrice)
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
  }, [from, toToken, parsed, slippageBps, account, snap, swapProviders, toPrice, noProviders]);

  const outFormatted = selected && toToken ? formatTokenAmount(BigInt(selected.amountOut), toToken.decimals) : null;
  const minFormatted = selected && toToken ? formatTokenAmount(BigInt(selected.amountOutMin), toToken.decimals) : null;

  const start = async () => {
    if (!selected || !from || !toToken || parsed === null || !account) return;
    const provider = swapProviders.find((p) => p.id === selected.providerId);
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      const req: SwapQuoteRequest = { chainId: snap!.chainId, fromToken: from, toToken, amountIn: parsed.toString(), slippageBps, account: account.address };
      const built = await provider.buildTransaction(selected, req);
      setSteps(built);
      setStepIndex(0);
      await prepareStep(built, 0);
      setPhase("review");
    } catch (e) {
      const h = humanizeError(e);
      setError({ title: h.title, message: h.message, technical: h.technical });
    } finally {
      setBusy(false);
    }
  };

  const prepareStep = async (list: SwapStep[], i: number) => {
    const step = list[i];
    if (!step) return;
    const r = await backend.prepareTransaction({ request: step.tx, meta: { kind: step.kind === "approve" ? "approve" : "swap", label: step.label } });
    setReview(r);
  };

  const confirm = async () => {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      const res = await backend.confirmTransaction({ reviewId: review.reviewId });
      setResults((r) => [...r, res]);
      const next = stepIndex + 1;
      if (next < steps.length) {
        setStepIndex(next);
        // The approval must be mined before the swap can be simulated against it.
        await waitForConfirmation(res);
        await prepareStep(steps, next);
      } else {
        setPhase("success");
      }
    } catch (e) {
      const h = humanizeError(e);
      setError({ title: h.title, message: h.message, technical: h.technical });
    } finally {
      setBusy(false);
    }
  };

  const waitForConfirmation = async (res: TxResult) => {
    for (let i = 0; i < 60; i++) {
      const receipt = (await backend.rpcRequest({ chainId: res.chainId, method: "eth_getTransactionReceipt", params: [res.hash] }).catch(() => null)) as { status?: string } | null;
      if (receipt) {
        if (receipt.status === "0x0") throw new Error("The approval transaction failed.");
        return;
      }
      await new Promise((r) => setTimeout(r, res.demo ? 300 : 2000));
    }
    throw new Error("The approval is still pending. Try again once it is confirmed.");
  };

  const back = () => {
    if (phase === "review") {
      if (review) void backend.discardReview({ reviewId: review.reviewId });
      setReview(null);
      setPhase("form");
      return;
    }
    goBack("/");
  };

  const swapSides = () => {
    setFromToken(toToken);
    setToToken(from);
    setAmount("");
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={phase === "review" ? (steps[stepIndex]?.kind === "approve" ? `Step ${stepIndex + 1} of ${steps.length} · Permission` : `Step ${stepIndex + 1} of ${steps.length} · Swap`) : "Swap"} onBack={phase === "success" ? undefined : back} subtitle={snap ? chainName(snap.chainId) : undefined} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {phase === "form" && (
          <div className="space-y-2">
            {watchOnly && (
              <Banner tone="info" title="Watch only">
                This account cannot sign. Switch to an account with a key to swap.
              </Banner>
            )}
            {noProviders && (
              <Banner tone="warn" title="No liquidity source configured">
                Swaps are disabled until a live route provider is enabled. Nothing here pretends a route exists.
              </Banner>
            )}
            <div className="card px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="label">You pay</span>
                {fromHolding && (
                  <button className="text-[12px] text-ink-2 hover:text-ink" onClick={() => setAmount(formatTokenAmount(fromHolding.raw, from!.decimals, from!.decimals).replace(/,/g, ""))}>
                    Balance {fromHolding.formatted} · <span className="font-semibold text-accent">Max</span>
                  </button>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input className={cx("num min-w-0 flex-1 bg-transparent text-[26px] font-semibold text-ink outline-none placeholder:text-ink-3", exceeds && "text-loss")} placeholder="0" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ""))} />
                <TokenButton token={from} onClick={() => setPicker("from")} />
              </div>
              <div className="mt-1 text-[12px] text-ink-3">{fromPrice && parsed ? `≈ ${formatUsd((Number(parsed) / 10 ** from!.decimals) * fromPrice)}` : from && !fromPrice ? "Price unavailable" : ""}</div>
            </div>
            <div className="flex justify-center">
              <IconButton label="Switch" onClick={swapSides} className="-my-4 z-10 h-8 w-8 rounded-full border border-line bg-surface">
                <Icon.Receive size={15} />
              </IconButton>
            </div>
            <div className="card px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="label">You receive</span>
                {quoting && <Spinner size={12} className="text-ink-3" />}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="num min-w-0 flex-1 truncate text-[26px] font-semibold text-ink">{outFormatted ? `~${outFormatted}` : <span className="text-ink-3">0</span>}</div>
                <TokenButton token={toToken} onClick={() => setPicker("to")} />
              </div>
              <div className="mt-1 text-[12px] text-ink-3">{toPrice && selected && toToken ? `≈ ${formatUsd((Number(selected.amountOut) / 10 ** toToken.decimals) * toPrice)}` : ""}</div>
            </div>

            {toToken && isStockLike(toToken) && (
              <div className="px-1 text-[11px] text-ink-3">
                {toToken.symbol} Stock Token — tokenized {toToken.underlying?.ticker ?? toToken.symbol} exposure, not the underlying share.
              </div>
            )}
            {exceeds && (
              <Banner tone="danger" title="Not enough balance">
                You hold {fromHolding?.formatted} {from?.symbol}.
              </Banner>
            )}
            {quotes && !selected && parsed !== null && !quoting && (
              <Banner tone="warn" title="No route found">
                {quotes.errors.length ? quotes.errors.map((e) => `${e.providerId}: ${e.error}`).join(" · ") : "No liquidity source returned a quote for this pair and amount."}
              </Banner>
            )}

            {selected && toToken && from && (
              <div className="card-flat divide-y divide-line px-4 text-[12px]">
                <Row label="Rate" value={`1 ${from.symbol} = ${selected.rate.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${toToken.symbol}`} />
                <Row label="Price impact" value={selected.priceImpactPct === null ? "—" : `${selected.priceImpactPct.toFixed(2)}%`} tone={selected.priceImpactPct !== null && selected.priceImpactPct > 3 ? "warn" : undefined} />
                <Row label="Network fee" value={selected.gasUsd === null ? "—" : formatUsd(selected.gasUsd)} />
                <Row label="Protocol fee" value={selected.feeUsd === null ? "—" : formatUsd(selected.feeUsd)} />
                <Row label="Minimum received" value={`${minFormatted} ${toToken.symbol}`} />
                <Row
                  label="Slippage"
                  value={
                    <Segmented
                      value={String(slippageBps)}
                      onChange={(v) => setSlippage(Number(v))}
                      items={[
                        { value: "10", label: "0.1%" },
                        { value: "50", label: "0.5%" },
                        { value: "100", label: "1%" },
                      ]}
                    />
                  }
                />
                <Row
                  label="Route"
                  value={
                    <button className="inline-flex items-center gap-1 font-semibold text-ink" onClick={() => setRoutes(true)}>
                      {selected.providerName} {quotes && quotes.all.length > 1 && <span className="text-accent">· Best price</span>} <Icon.ChevronRight size={13} />
                    </button>
                  }
                />
                {selected.demo && <Row label="Mode" value={<span className="text-accent">Demo quote</span>} />}
              </div>
            )}
            {error && <ErrorBanner error={error} showTech={showTech} onToggle={() => setShowTech((v) => !v)} />}
            <Button variant="primary" full disabled={!selected || exceeds || watchOnly} loading={busy} onClick={start}>
              {selected?.approval ? "REVIEW · 2 STEPS" : "REVIEW SWAP"}
            </Button>
            {selected?.approval && (
              <p className="px-1 text-center text-[11px] text-ink-3">
                Step 1 grants {selected.providerName} a temporary permission for exactly {amount} {from?.symbol}. Step 2 performs the swap.
              </p>
            )}
          </div>
        )}

        {phase === "review" && review && (
          <div className="space-y-3 px-1 pt-1">
            {steps.length > 1 && (
              <div className="flex gap-1.5">
                {steps.map((s, i) => (
                  <div key={i} className={cx("h-1 flex-1 rounded-full", i <= stepIndex ? "bg-accent" : "bg-line")} title={s.label} />
                ))}
              </div>
            )}
            <TxReviewCard review={review} />
            {error && <ErrorBanner error={error} showTech={showTech} onToggle={() => setShowTech((v) => !v)} />}
            <Button variant={review.riskLevel === "high" ? "danger" : "primary"} full loading={busy} onClick={confirm}>
              {steps[stepIndex]?.kind === "approve" ? "APPROVE PERMISSION" : "CONFIRM SWAP"}
            </Button>
          </div>
        )}

        {phase === "success" && (
          <div className="flex flex-col items-center px-4 pt-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-base">
              <Icon.Check size={26} />
            </span>
            <div className="display mt-5 text-[22px] text-ink">SWAP SUBMITTED</div>
            <div className="num mt-1 text-[14px] text-ink-2">
              {amount} {from?.symbol} → ~{outFormatted} {toToken?.symbol}
            </div>
            {results[results.length - 1]?.demo && <div className="mt-2 text-[11px] uppercase tracking-[0.12em] text-accent">Demo — nothing was broadcast</div>}
            <div className="mt-4 space-y-1">
              {results.map((r) => (
                <ExplorerLink key={r.hash} url={r.explorerUrl} />
              ))}
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

      <Sheet open={picker !== null} onClose={() => setPicker(null)} title={picker === "from" ? "You pay" : "You receive"}>
        <div className="space-y-0.5">
          {(picker === "from" ? (portfolio?.holdings.map((h) => h.token) ?? []) : visible).map((t) => {
            const h = portfolio?.holdings.find((x) => x.token.address === t.address);
            return (
              <AssetRow
                key={t.address}
                token={t}
                balance={h?.formatted}
                valueUsd={h?.valueUsd ?? null}
                change={prices.data?.[priceKey(t)]?.change24hPct ?? null}
                onClick={() => {
                  if (picker === "from") setFromToken(t);
                  else setToToken(t);
                  setPicker(null);
                }}
              />
            );
          })}
        </div>
      </Sheet>

      <Sheet open={routes} onClose={() => setRoutes(false)} title="Routes">
        {quotes && toToken && (
          <div className="space-y-2">
            {quotes.all.map((q, i) => (
              <ListRow
                key={q.providerId}
                className={cx("card", q.providerId === selected?.providerId && "border-accent")}
                title={
                  <span className="flex items-center gap-2">
                    {q.providerName}
                    {i === 0 && <span className="pill pill-accent">Best price</span>}
                  </span>
                }
                subtitle={`Fee ${q.feeUsd === null ? "—" : formatUsd(q.feeUsd)} · Gas ${q.gasUsd === null ? "—" : formatUsd(q.gasUsd)} · ${q.route.join(" → ")}`}
                trailing={
                  <div className="num text-[13px] text-ink">
                    {formatTokenAmount(BigInt(q.amountOut), toToken.decimals)} {toToken.symbol}
                  </div>
                }
                onClick={() => {
                  setSelected(q);
                  setRoutes(false);
                }}
              />
            ))}
            {quotes.errors.map((e) => (
              <div key={e.providerId} className="px-2 text-[11px] text-ink-3">
                {e.providerId}: {e.error}
              </div>
            ))}
            <p className="px-1 text-[11px] text-ink-3">Routes are ranked by expected output after fees. Prices come from each provider's quote and are not guaranteed until execution.</p>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function TokenButton({ token, onClick }: { token?: TokenInfo; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-2.5 transition-colors hover:border-line-2">
      {token ? (
        <>
          <TokenAvatar symbol={token.symbol} category={token.category} size={24} />
          <span className="text-[13px] font-semibold text-ink">{token.symbol}</span>
        </>
      ) : (
        <span className="px-2 text-[13px] font-semibold text-ink">Select</span>
      )}
      <Icon.ChevronDown size={14} className="text-ink-3" />
    </button>
  );
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "warn" }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-ink-2">{label}</span>
      <span className={cx("num text-right text-ink", tone === "warn" && "text-warn")}>{value}</span>
    </div>
  );
}

export { displayName };
