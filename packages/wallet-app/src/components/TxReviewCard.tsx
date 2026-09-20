import { useState } from "react";
import type { TxReview } from "@frame/types";
import { chainName } from "@frame/config";
import { formatUsd } from "@frame/chain";
import { Banner, Icon, KeyValue, Pill, cx } from "@frame/ui";
import { useSnapshot } from "../state/store";
import { RiskBadge } from "./common";

/** What the user reads before signing: plain-English summary, expected changes, permissions, risks, fee. */
export function TxReviewCard({
  review,
  onEditPermission,
  compact,
}: {
  review: TxReview;
  onEditPermission?: () => void;
  compact?: boolean;
}) {
  const snap = useSnapshot();
  const [showRaw, setShowRaw] = useState(false);
  const dev = snap?.settings.developerMode || snap?.settings.showRawTransactionData;
  const { summary, changes, approvals, risks, simulation, fee } = review;
  const highRisks = risks.filter((r) => r.level === "high");
  const cautions = risks.filter((r) => r.level === "caution");

  return (
    <div className="space-y-3">
      <div className="card px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="label">{review.origin ? "This app wants to" : "You are about to"}</div>
            <div className="display mt-1.5 text-[19px] leading-tight text-ink">{summary.title}</div>
          </div>
          <RiskBadge level={review.riskLevel} />
        </div>
        <KeyValue className="mt-3" rows={summary.lines.map((l) => ({ label: l.label, value: l.value, mono: l.mono }))} />
      </div>

      {(changes.length > 0 || approvals.length > 0) && (
        <div className="card px-4 py-3">
          <div className="label">Expected changes</div>
          <div className="mt-2 space-y-1.5">
            {changes.map((c, i) => (
              <div key={i} className="flex items-center justify-between text-[14px]">
                <span className="text-ink-2">{c.direction === "in" ? "Receive" : "Send"}</span>
                <span className={cx("num font-medium", c.direction === "in" ? "text-accent" : "text-ink")}>
                  {c.direction === "in" ? "+" : "−"}
                  {c.approximate ? "~" : ""}
                  {c.amount} {c.symbol}
                  {c.usd !== undefined && c.usd !== null && <span className="ml-1.5 text-[12px] font-normal text-ink-3">{formatUsd(c.usd)}</span>}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-ink-2">Network fee</span>
              <span className="num text-ink-2">
                −{Number(fee.eth).toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} ETH{fee.usd !== null && <span className="ml-1.5 text-ink-3">{formatUsd(fee.usd)}</span>}
              </span>
            </div>
          </div>
          {approvals.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <div className="label">Permissions</div>
              {approvals.map((a, i) => (
                <div key={i} className="mt-2 text-[13px]">
                  <div className="flex items-center justify-between">
                    <span className="text-ink">
                      {a.unlimited ? "Unlimited" : a.amount} {a.symbol} {a.unlimited ? "approval" : "temporary approval"}
                    </span>
                    {a.unlimited ? <Pill tone="loss">Unlimited</Pill> : <Pill tone="muted">Exact</Pill>}
                  </div>
                  <div className="mt-1 text-[12px] text-ink-2">
                    Spender: {a.spenderLabel ? `${a.spenderLabel} · ` : ""}
                    <span className="mono">{a.spender}</span>
                  </div>
                  {a.current !== undefined && <div className="mt-0.5 text-[12px] text-ink-3">Current approval: {a.current}</div>}
                  {onEditPermission && (
                    <button className="mt-2 text-[12px] font-semibold text-accent" onClick={onEditPermission}>
                      Edit permission
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {highRisks.map((r) => (
        <Banner key={r.code} tone="danger" title={r.title}>
          {r.detail}
        </Banner>
      ))}
      {cautions.map((r) => (
        <Banner key={r.code} tone="warn" title={r.title}>
          {r.detail}
        </Banner>
      ))}

      {!compact && (
        <div className="flex items-center justify-between px-1 text-[12px] text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            {simulation.status === "success" ? (
              <>
                <Icon.Check size={13} className="text-accent" /> Simulated successfully
              </>
            ) : simulation.status === "reverted" ? (
              <>
                <Icon.Warning size={13} className="text-loss" /> Simulation failed
              </>
            ) : (
              <>
                <Icon.Info size={13} /> Not simulated
              </>
            )}
          </span>
          <span>{chainName(review.chainId)}</span>
        </div>
      )}

      {dev && (
        <div className="card-flat px-4 py-3">
          <button className="flex w-full items-center justify-between text-[12px] font-semibold text-ink-2" onClick={() => setShowRaw((v) => !v)}>
            Technical details
            <Icon.ChevronDown size={14} className={cx("transition-transform", showRaw && "rotate-180")} />
          </button>
          {showRaw && (
            <KeyValue
              className="mt-2"
              rows={[
                { label: "From", value: review.from, mono: true },
                { label: "To", value: review.to ?? "(contract creation)", mono: true },
                { label: "Value (wei)", value: review.raw.value, mono: true },
                { label: "Nonce", value: String(review.prepared.nonce), mono: true },
                { label: "Gas limit", value: review.prepared.gas, mono: true },
                { label: "Max fee / gas", value: `${review.prepared.maxFeePerGas} wei`, mono: true },
                { label: "Decoded", value: review.raw.decoded ?? "—", mono: true },
                { label: "Calldata", value: review.raw.data.length > 200 ? `${review.raw.data.slice(0, 200)}…` : review.raw.data, mono: true },
                { label: "Simulation", value: `${simulation.method} · ${simulation.status}${simulation.error ? ` · ${simulation.error}` : ""}` },
              ]}
            />
          )}
        </div>
      )}
    </div>
  );
}
