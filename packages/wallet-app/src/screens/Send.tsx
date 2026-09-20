import { useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";
import type { Address, TokenInfo, TxResult, TxReview } from "@frame/types";
import { chainName } from "@frame/config";
import { classifyAddressInput, formatTokenAmount, formatUsd, shortAddress } from "@frame/chain";
import { displayName } from "@frame/token-registry";
import { buildErc20Transfer, humanizeError } from "@frame/transaction-engine";
import { Banner, Button, Field, Icon, Identicon, ListRow, ScreenHeader, Spinner, TokenAvatar, cx } from "@frame/ui";
import { useBackend } from "../context";
import { useSnapshot } from "../state/store";
import { usePortfolio, useSelectedAccount, useTokens, useChainClient } from "../data/hooks";
import type { Holding } from "../data/portfolio";
import { goBack, useNavigate, useRoute } from "../nav";
import { AssetRow, ExplorerLink } from "../components/common";
import { TxReviewCard } from "../components/TxReviewCard";

type Step = "asset" | "recipient" | "amount" | "review" | "success";

export function SendScreen() {
  const { params } = useRoute();
  const snap = useSnapshot();
  const account = useSelectedAccount();
  const backend = useBackend();
  const navigate = useNavigate();
  const { portfolio } = usePortfolio();
  const { lookup } = useTokens();
  const client = useChainClient();

  const [step, setStep] = useState<Step>(params.asset ? "recipient" : "asset");
  const [token, setToken] = useState<TokenInfo | undefined>(() => (params.asset ? lookup(params.asset as Address | "native") : undefined));
  const [recipient, setRecipient] = useState(params.to ?? "");
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<TxReview | null>(null);
  const [result, setResult] = useState<TxResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; message: string; technical: string } | null>(null);
  const [isContract, setIsContract] = useState<boolean | null>(null);
  const [showTech, setShowTech] = useState(false);

  const holding: Holding | undefined = useMemo(() => portfolio?.holdings.find((h) => h.token.address === token?.address), [portfolio, token]);
  const classified = useMemo(() => classifyAddressInput(recipient), [recipient]);
  const bookEntry = useMemo(() => (classified.kind === "address" ? snap?.addressBook.find((e) => e.address.toLowerCase() === classified.address.toLowerCase()) : undefined), [classified, snap]);
  const ownAccount = useMemo(() => (classified.kind === "address" ? snap?.accounts.find((a) => a.address.toLowerCase() === classified.address.toLowerCase()) : undefined), [classified, snap]);

  useEffect(() => {
    setIsContract(null);
    if (classified.kind !== "address") return;
    let cancelled = false;
    client
      .getCode({ address: classified.address })
      .then((code) => {
        if (!cancelled) setIsContract(!!code && code !== "0x");
      })
      .catch(() => {
        if (!cancelled) setIsContract(null);
      });
    return () => {
      cancelled = true;
    };
  }, [classified, client]);

  const parsedAmount = useMemo(() => {
    if (!token || !amount) return null;
    try {
      const v = parseUnits(amount.replace(/,/g, ""), token.decimals);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }, [amount, token]);
  const exceeds = !!holding && parsedAmount !== null && parsedAmount > holding.raw;
  const amountUsd = holding?.priceUsd && parsedAmount ? (Number(parsedAmount) / 10 ** (token?.decimals ?? 18)) * holding.priceUsd : null;

  const prepare = async () => {
    if (!token || !account || classified.kind !== "address" || parsedAmount === null) return;
    setBusy(true);
    setError(null);
    try {
      const request = buildErc20Transfer({ chainId: snap!.chainId, from: account.address, token, to: classified.address, amount: parsedAmount });
      const r = await backend.prepareTransaction({ request, meta: { kind: "send", symbol: token.symbol } });
      setReview(r);
      setStep("review");
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
      setStep("success");
    } catch (e) {
      const h = humanizeError(e);
      setError({ title: h.title, message: h.message, technical: h.technical });
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    if (step === "asset" || step === "success") return goBack("/");
    if (step === "recipient") return params.asset ? goBack("/") : setStep("asset");
    if (step === "amount") return setStep("recipient");
    if (step === "review") {
      if (review) void backend.discardReview({ reviewId: review.reviewId });
      setReview(null);
      return setStep("amount");
    }
  };

  const titles: Record<Step, string> = { asset: "Send · choose asset", recipient: "Send · recipient", amount: "Send · amount", review: "Review", success: "Sent" };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={titles[step]} onBack={step === "success" ? undefined : back} subtitle={token && step !== "asset" ? `${displayName(token)} · ${chainName(snap?.chainId ?? 4663)}` : undefined} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {step === "asset" && (
          <div className="space-y-0.5">
            {(portfolio?.holdings ?? []).map((h) => (
              <AssetRow key={h.token.address} token={h.token} balance={h.formatted} valueUsd={h.valueUsd} change={h.change24hPct} onClick={() => { setToken(h.token); setStep("recipient"); }} />
            ))}
            {portfolio && portfolio.holdings.length === 0 && <div className="px-2 py-8 text-center text-[13px] text-ink-2">Nothing to send yet.</div>}
          </div>
        )}

        {step === "recipient" && token && (
          <div className="space-y-4 px-1 pt-1">
            <Field
              label="Recipient"
              placeholder="0x address"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              error={classified.kind === "invalid" ? classified.reason : undefined}
              hint={
                classified.kind === "address" ? (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <Icon.Check size={12} className="text-accent" />
                    {bookEntry ? `${bookEntry.name} · ` : ownAccount ? `${ownAccount.name} (your account) · ` : ""}
                    <span className="mono">{classified.address}</span>
                  </span>
                ) : (
                  "Paste a Robinhood Chain address. Names are not resolved."
                )
              }
            />
            {classified.kind === "address" && classified.isZero && (
              <Banner tone="danger" title="Zero address">
                Funds sent to 0x000…000 are burned forever.
              </Banner>
            )}
            {classified.kind === "address" && classified.checksumMismatch && (
              <Banner tone="danger" title="Checksum mismatch">
                The capitalisation of this address does not match its checksum — it may contain a typo. Verify it with the recipient.
              </Banner>
            )}
            {classified.kind === "address" && isContract && !bookEntry && (
              <Banner tone="warn" title="Recipient is a contract">
                Most contracts cannot return funds sent by mistake. Make sure this destination expects {token.symbol}.
              </Banner>
            )}
            {(snap?.addressBook.length ?? 0) > 0 && !recipient && (
              <div>
                <div className="label px-1">Address book</div>
                <div className="mt-2 space-y-0.5">
                  {snap!.addressBook.map((e) => (
                    <ListRow key={e.id} leading={<Identicon address={e.address} size={30} />} title={e.name} subtitle={<span className="mono">{shortAddress(e.address, 6)}</span>} onClick={() => setRecipient(e.address)} />
                  ))}
                </div>
              </div>
            )}
            {(snap?.accounts.length ?? 0) > 1 && !recipient && (
              <div>
                <div className="label px-1">Your accounts</div>
                <div className="mt-2 space-y-0.5">
                  {snap!.accounts
                    .filter((a) => a.id !== account?.id)
                    .map((a) => (
                      <ListRow key={a.id} leading={<Identicon address={a.address} size={30} />} title={a.name} subtitle={<span className="mono">{shortAddress(a.address, 6)}</span>} onClick={() => setRecipient(a.address)} />
                    ))}
                </div>
              </div>
            )}
            <Button variant="primary" full disabled={classified.kind !== "address" || classified.isZero || classified.checksumMismatch} onClick={() => setStep("amount")}>
              CONTINUE
            </Button>
          </div>
        )}

        {step === "amount" && token && (
          <div className="space-y-4 px-1 pt-1">
            <div className="card px-4 py-4">
              <div className="flex items-center justify-between">
                <span className="label">Amount</span>
                <button className="text-[12px] text-ink-2 hover:text-ink" onClick={() => holding && setAmount(formatTokenAmount(holding.raw, token.decimals, token.decimals).replace(/,/g, ""))}>
                  Balance: {holding?.formatted ?? "0"} {token.symbol} · <span className="font-semibold text-accent">Max</span>
                </button>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <TokenAvatar symbol={token.symbol} category={token.category} size={34} />
                <input
                  className={cx("num min-w-0 flex-1 bg-transparent text-[30px] font-semibold text-ink outline-none placeholder:text-ink-3", exceeds && "text-loss")}
                  placeholder="0"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ""))}
                  autoFocus
                />
                <span className="text-[14px] font-semibold text-ink-2">{token.symbol}</span>
              </div>
              <div className="mt-1 text-[12px] text-ink-3">{amountUsd !== null ? `≈ ${formatUsd(amountUsd)}` : holding?.priceUsd ? "" : "Price unavailable"}</div>
              {token.address === "native" && <div className="mt-2 text-[11px] text-ink-3">Keep a little ETH for network fees.</div>}
            </div>
            {exceeds && (
              <Banner tone="danger" title="Not enough balance">
                You hold {holding?.formatted} {token.symbol}.
              </Banner>
            )}
            {error && <ErrorBanner error={error} showTech={showTech} onToggle={() => setShowTech((v) => !v)} />}
            <div className="text-[12px] text-ink-2">
              To <span className="mono text-ink">{classified.kind === "address" ? classified.address : recipient}</span>
              {bookEntry && <span> · {bookEntry.name}</span>}
            </div>
            <Button variant="primary" full disabled={parsedAmount === null || exceeds} loading={busy} onClick={prepare}>
              REVIEW
            </Button>
          </div>
        )}

        {step === "review" && review && token && (
          <div className="space-y-3 px-1 pt-1">
            <div className="card px-4 py-4 text-center">
              <div className="label">Send</div>
              <div className="display num mt-1 text-[26px] text-ink">
                {amount} {token.symbol}
              </div>
              {amountUsd !== null && <div className="text-[12px] text-ink-3">≈ {formatUsd(amountUsd)}</div>}
              <div className="mt-3 text-[11px] uppercase tracking-[0.12em] text-ink-2">To</div>
              <div className="mt-1 flex items-center justify-center gap-2">
                <Identicon address={review.recipient ?? review.to ?? ""} size={20} />
                <span className="text-[13px] font-medium text-ink">{bookEntry?.name ?? ownAccount?.name ?? shortAddress(review.recipient ?? review.to ?? "", 6)}</span>
              </div>
              <div className="mono mt-1 break-all text-[11px] text-ink-3">{review.recipient ?? review.to}</div>
            </div>
            <TxReviewCard review={review} />
            <div className="card-flat px-4 py-3 text-[13px]">
              <div className="flex justify-between">
                <span className="text-ink-2">Total</span>
                <span className="num text-ink">
                  {amount} {token.symbol} + gas
                </span>
              </div>
            </div>
            {error && <ErrorBanner error={error} showTech={showTech} onToggle={() => setShowTech((v) => !v)} />}
            <Button variant={review.riskLevel === "high" ? "danger" : "primary"} full loading={busy} onClick={confirm} disabled={review.risks.some((r) => r.code === "LOW_GAS" && r.level === "high") || review.risks.some((r) => r.code === "ZERO_ADDRESS")}>
              {review.riskLevel === "high" ? "CONFIRM ANYWAY" : "CONFIRM SEND"}
            </Button>
          </div>
        )}

        {step === "success" && result && token && (
          <div className="flex flex-col items-center px-4 pt-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-base">
              <Icon.Check size={26} />
            </span>
            <div className="display mt-5 text-[22px] text-ink">SENT</div>
            <div className="num mt-1 text-[15px] text-ink">
              {amount} {token.symbol}
            </div>
            <div className="mt-1 text-[12px] text-ink-2">to {bookEntry?.name ?? ownAccount?.name ?? shortAddress(review?.recipient ?? review?.to ?? "", 6)}</div>
            <div className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-2">
              <Spinner size={12} /> Waiting for confirmation on {chainName(result.chainId)}
            </div>
            {result.demo && <div className="mt-2 text-[11px] uppercase tracking-[0.12em] text-accent">Demo — nothing was broadcast</div>}
            <div className="mt-5 flex gap-2">
              {result.explorerUrl && <ExplorerLink url={result.explorerUrl} />}
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
    </div>
  );
}

export function ErrorBanner({ error, showTech, onToggle }: { error: { title: string; message: string; technical: string }; showTech: boolean; onToggle: () => void }) {
  return (
    <Banner tone="danger" title={error.title}>
      {error.message}
      <button className="ml-2 font-semibold underline" onClick={onToggle}>
        {showTech ? "Hide" : "View"} technical details
      </button>
      {showTech && <div className="mono mt-2 break-all text-[11px] opacity-80">{error.technical}</div>}
    </Banner>
  );
}
