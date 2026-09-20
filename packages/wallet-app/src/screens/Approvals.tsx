import { useMemo, useState } from "react";
import type { Address, DappRequest } from "@frame/types";
import { chainName } from "@frame/config";
import { shortAddress } from "@frame/chain";
import { humanizeError } from "@frame/transaction-engine";
import { Banner, Button, Field, Icon, Identicon, KeyValue, ListRow, Logo, Pill, cx } from "@frame/ui";
import { useApp, useBackend } from "../context";
import { useSnapshot } from "../state/store";
import { useSelectedAccount } from "../data/hooks";
import { TxReviewCard } from "../components/TxReviewCard";
import { ErrorBanner } from "./Send";

/** Screen shown for a queued dApp request (popup or dedicated approval window). */
export function ApprovalScreen({ request, onDone }: { request: DappRequest; onDone?: () => void }) {
  const backend = useBackend();
  const snap = useSnapshot();
  const account = useSelectedAccount();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<{ title: string; message: string; technical: string } | null>(null);
  const [showTech, setShowTech] = useState(false);
  const [selected, setSelected] = useState<Address[]>(() => (account ? [account.address] : []));
  const [editAmount, setEditAmount] = useState<string | null>(null);
  const host = request.origin.replace(/^https?:\/\//, "");
  const insecure = request.origin.startsWith("http://");

  const resolve = async (approved: boolean) => {
    setBusy(approved ? "approve" : "reject");
    setError(null);
    try {
      await backend.resolveRequest({ id: request.id, approved, accounts: request.kind === "connect" ? selected : undefined, approvalAmount: editAmount ?? undefined });
      onDone?.();
    } catch (e) {
      const h = humanizeError(e);
      setError({ title: h.title, message: h.message, technical: h.technical });
    } finally {
      setBusy(null);
    }
  };

  const title = useMemo(() => {
    switch (request.kind) {
      case "connect":
        return "Connect to";
      case "sign_message":
        return "Sign message";
      case "sign_typed_data":
        return "Sign structured data";
      case "send_transaction":
        return "Transaction request";
      case "switch_chain":
      case "add_chain":
        return "Switch network";
    }
  }, [request.kind]);

  const locked = snap?.locked;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pt-4">
        <div className="flex items-center gap-2">
          <Logo size={18} className="text-accent" />
          <span className="label">{title}</span>
        </div>
        <Pill tone="muted">{chainName(request.chainId)}</Pill>
      </div>
      <div className="px-4 pt-3">
        <div className="card-flat flex items-center gap-3 px-3 py-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-card-2 text-ink-2">
            <Icon.Globe size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold text-ink">{host}</div>
            <div className="text-[11px] text-ink-3">{insecure ? "Not secure (http)" : "Secure connection"}</div>
          </div>
        </div>
        {insecure && (
          <Banner tone="warn" className="mt-2" title="Unencrypted site">
            This site is not served over HTTPS.
          </Banner>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        {request.kind === "connect" && (
          <div className="space-y-3">
            <div className="card px-4 py-3 text-[13px]">
              <div className="label">This site wants to</div>
              <ul className="mt-2 space-y-1.5 text-ink">
                <li className="flex items-center gap-2">
                  <Icon.Check size={14} className="text-accent" /> View your wallet address
                </li>
                <li className="flex items-center gap-2">
                  <Icon.Check size={14} className="text-accent" /> Request transaction approvals
                </li>
              </ul>
              <div className="mt-2 text-[12px] text-ink-2">It cannot move funds without your approval.</div>
            </div>
            <div>
              <div className="label px-1">Account</div>
              <div className="card mt-2 divide-y divide-line">
                {(snap?.accounts ?? []).map((a) => {
                  const on = selected.some((s) => s.toLowerCase() === a.address.toLowerCase());
                  return (
                    <ListRow
                      key={a.id}
                      leading={<Identicon address={a.address} size={28} />}
                      title={
                        <span className="flex items-center gap-2">
                          {a.name}
                          {a.kind === "watch" && <Pill tone="muted">Watch only</Pill>}
                        </span>
                      }
                      subtitle={<span className="mono">{shortAddress(a.address, 6)}</span>}
                      trailing={<span className={cx("flex h-5 w-5 items-center justify-center rounded-full border", on ? "border-accent bg-accent text-base" : "border-line-2")}>{on && <Icon.Check size={12} />}</span>}
                      onClick={() => setSelected((list) => (on ? list.filter((s) => s.toLowerCase() !== a.address.toLowerCase()) : [...list, a.address]))}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {request.kind === "sign_message" && request.message && (
          <div className="space-y-3">
            <KeyValue rows={[{ label: "Requested by", value: host }, { label: "Account", value: request.account ? shortAddress(request.account, 6) : "—", mono: true }]} />
            <div className="card px-4 py-3">
              <div className="label">Message</div>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink">{request.message.text}</pre>
            </div>
            {request.message.warnings.map((w) => (
              <Banner key={w.code} tone={w.code === "AUTH_CHALLENGE" ? "info" : "warn"} title={w.title}>
                {w.detail}
              </Banner>
            ))}
            <p className="text-[11px] text-ink-3">Signing a message costs nothing and cannot move funds by itself. Only sign messages from sites you trust.</p>
          </div>
        )}

        {request.kind === "sign_typed_data" && request.typedData && (
          <div className="space-y-3">
            <KeyValue rows={[{ label: "Requested by", value: host }, { label: "Account", value: request.account ? shortAddress(request.account, 6) : "—", mono: true }, { label: "Type", value: request.typedData.primaryType }]} />
            {request.typedData.warnings.map((w, i) => (
              <Banner key={`${w.code}-${i}`} tone={w.code === "PERMIT" ? "danger" : w.code === "TYPED_DATA" ? "info" : "warn"} title={w.title}>
                {w.detail}
              </Banner>
            ))}
            <div className="card px-4 py-3">
              <div className="label">Data</div>
              <pre className="mono mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink">{request.typedData.json}</pre>
            </div>
          </div>
        )}

        {request.kind === "send_transaction" && request.transaction && (
          <div className="space-y-3">
            <TxReviewCard review={request.transaction} onEditPermission={request.transaction.approvals[0] ? () => setEditAmount(editAmount ?? (request.transaction!.approvals[0]!.unlimited ? "" : request.transaction!.approvals[0]!.amount)) : undefined} />
            {editAmount !== null && request.transaction.approvals[0] && (
              <div className="card px-4 py-3">
                <div className="label">Edit permission</div>
                <p className="mt-1 text-[12px] text-ink-2">Set the maximum amount of {request.transaction.approvals[0].symbol} this contract may spend. The site's request will be replaced by your amount.</p>
                <Field className="mt-2" placeholder={`Amount in ${request.transaction.approvals[0].symbol}`} value={editAmount} onChange={(e) => setEditAmount(e.target.value.replace(/[^0-9.,]/g, ""))} inputMode="decimal" autoFocus />
                <div className="mt-2 flex gap-2">
                  <Button size="xs" variant="ghost" onClick={() => setEditAmount(null)}>
                    Keep as requested
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {(request.kind === "switch_chain" || request.kind === "add_chain") && (
          <div className="space-y-3">
            <div className="card px-4 py-4 text-center">
              <div className="text-[13px] text-ink-2">{chainName(request.chainId)}</div>
              <div className="my-1 text-ink-3">↓</div>
              <div className="display text-[18px] text-ink">{chainName(request.targetChainId ?? 0)}</div>
            </div>
            <p className="text-[12px] text-ink-2">The site asks to switch the wallet's active network. Balances and activity will reflect the new network until you switch back.</p>
          </div>
        )}

        {locked && (
          <Banner tone="warn" className="mt-3" title="Wallet locked">
            Unlock the wallet to approve this request.
          </Banner>
        )}
        {error && (
          <div className="mt-3">
            <ErrorBanner error={error} showTech={showTech} onToggle={() => setShowTech((v) => !v)} />
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-line px-4 py-3">
        <Button full onClick={() => void resolve(false)} loading={busy === "reject"} disabled={busy === "approve"}>
          CANCEL
        </Button>
        <Button
          full
          variant={request.transaction?.riskLevel === "high" ? "danger" : "primary"}
          onClick={() => void resolve(true)}
          loading={busy === "approve"}
          disabled={locked || busy === "reject" || (request.kind === "connect" && selected.length === 0) || (editAmount !== null && editAmount.trim() === "")}
        >
          {request.kind === "connect" ? "CONNECT" : request.kind === "send_transaction" ? (editAmount !== null ? "APPROVE EDITED" : request.transaction?.riskLevel === "high" ? "CONFIRM ANYWAY" : "CONFIRM") : request.kind === "switch_chain" || request.kind === "add_chain" ? "SWITCH" : "SIGN"}
        </Button>
      </div>
    </div>
  );
}

export function ApprovalQueue() {
  const snap = useSnapshot();
  const { requestId, closeWindow } = useApp();
  const list = snap?.pendingRequests ?? [];
  const current = (requestId ? list.find((r) => r.id === requestId) : undefined) ?? list[0];
  if (!current) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <Icon.Check size={22} className="text-accent" />
        <div className="mt-3 text-[14px] font-medium text-ink">Nothing to approve</div>
        <div className="mt-1 text-[12px] text-ink-2">The request was handled or has expired.</div>
        {closeWindow && (
          <Button size="sm" className="mt-4" onClick={closeWindow}>
            Close
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      {list.length > 1 && <div className="bg-card-2 px-4 py-1 text-center text-[11px] text-ink-2">{list.length} pending requests</div>}
      <div className="min-h-0 flex-1">
        <ApprovalScreen key={current.id} request={current} onDone={list.length <= 1 ? closeWindow : undefined} />
      </div>
    </div>
  );
}
