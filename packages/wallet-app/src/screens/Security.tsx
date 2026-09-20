import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Allowance, AutoLockMinutes, TxReview } from "@frame/types";
import { formatRelativeTime, shortAddress } from "@frame/chain";
import { displayName } from "@frame/token-registry";
import { buildApprove, humanizeError } from "@frame/transaction-engine";
import { Banner, Button, Dialog, Icon, ListRow, PasswordField, Pill, ScreenHeader, Sheet, SkeletonRow, TokenAvatar, Toggle, cx, useCopy, useToast } from "@frame/ui";
import { useBackend } from "../context";
import { useAppStore, useSnapshot } from "../state/store";
import { useAllowances, useSelectedAccount } from "../data/hooks";
import { goBack, useNavigate, useRoute } from "../nav";
import { RiskBadge } from "../components/common";
import { TxReviewCard } from "../components/TxReviewCard";
import { ErrorBanner } from "./Send";

export function SecurityScreen() {
  const { path } = useRoute();
  const sub = path.split("/")[2];
  if (sub === "apps") return <ConnectedApps />;
  if (sub === "approvals") return <ApprovalManager />;
  if (sub === "export") return <ExportRecovery />;
  if (sub === "password") return <ChangePassword />;
  return <SecurityOverview />;
}

function SecurityOverview() {
  const snap = useSnapshot();
  const backend = useBackend();
  const navigate = useNavigate();
  const allowances = useAllowances();
  const [confirmNever, setConfirmNever] = useState(false);
  if (!snap) return null;
  const s = snap.settings;
  const high = (allowances.data ?? []).filter((a) => a.risk === "high").length;
  const options: { value: AutoLockMinutes; label: string }[] = [
    { value: 1, label: "1 min" },
    { value: 5, label: "5 min" },
    { value: 15, label: "15 min" },
    { value: 30, label: "30 min" },
    { value: 60, label: "1 hour" },
    { value: 0, label: "Never" },
  ];
  const setAutoLock = (v: AutoLockMinutes) => {
    if (v === 0) {
      setConfirmNever(true);
      return;
    }
    void backend.updateSettings({ autoLockMinutes: v });
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Security" subtitle="Wallet security" />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        <div className="grid grid-cols-2 gap-2">
          <Tile label="Backup" value={snap.backupConfirmed ? "Backed up" : "Not backed up"} tone={snap.backupConfirmed ? "ok" : "warn"} onClick={() => navigate("/security/export")} />
          <Tile label="Connected apps" value={String(snap.permissions.length)} onClick={() => navigate("/security/apps")} />
          <Tile label="Token approvals" value={allowances.isPending ? "…" : `${allowances.data?.length ?? 0} active`} onClick={() => navigate("/security/approvals")} />
          <Tile label="High-risk approvals" value={allowances.isPending ? "…" : String(high)} tone={high > 0 ? "warn" : "ok"} onClick={() => navigate("/security/approvals")} />
        </div>

        <div className="label mt-5 px-1">Auto lock</div>
        <div className="card mt-2 px-3 py-3">
          <div className="no-scrollbar flex gap-1 overflow-x-auto">
            {options.map((o) => (
              <button key={o.value} className={cx("tab shrink-0", s.autoLockMinutes === o.value && "tab-active")} onClick={() => setAutoLock(o.value)}>
                {o.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-ink-2">{s.autoLockMinutes === 0 ? "The wallet stays unlocked until you lock it or close the browser." : `The wallet locks after ${s.autoLockMinutes} minute${s.autoLockMinutes === 1 ? "" : "s"} without activity.`}</p>
        </div>

        <div className="label mt-5 px-1">Transaction protection</div>
        <div className="card mt-2 divide-y divide-line">
          <Toggle checked={s.simulateBeforeSign} onChange={(v) => void backend.updateSettings({ simulateBeforeSign: v })} label="Simulate before signing" description="Runs every transaction against the network before you approve it and shows the expected outcome." />
          <Toggle checked={!!s.lowGasThresholdEth && s.lowGasThresholdEth !== "0"} onChange={(v) => void backend.updateSettings({ lowGasThresholdEth: v ? "0.001" : "0" })} label="Low gas warning" description="Warn when ETH for network fees runs low." />
        </div>

        <div className="label mt-5 px-1">Wallet security</div>
        <div className="card mt-2">
          <ListRow leading={<Icon.Key size={16} className="text-ink-2" />} title="Export recovery phrase / private key" subtitle="Requires your password" onClick={() => navigate("/security/export")} chevron />
          <ListRow leading={<Icon.Lock size={16} className="text-ink-2" />} title="Change password" onClick={() => navigate("/security/password")} chevron />
          <ListRow leading={<Icon.Link size={16} className="text-ink-2" />} title="Connected apps" subtitle={`${snap.permissions.length} site${snap.permissions.length === 1 ? "" : "s"} can see your address`} onClick={() => navigate("/security/apps")} chevron />
          <ListRow leading={<Icon.Shield size={16} className="text-ink-2" />} title="Token approvals" subtitle="Review and revoke spending permissions" onClick={() => navigate("/security/approvals")} chevron />
        </div>

        <div className="label mt-5 px-1">Privacy</div>
        <div className="card mt-2 divide-y divide-line">
          <Toggle checked={s.telemetryOptIn} onChange={(v) => void backend.updateSettings({ telemetryOptIn: v })} label="Anonymous usage statistics" description="Off by default. Never includes addresses, balances, secrets or signed data." />
          <Toggle checked={s.previewWhenLocked} onChange={(v) => void backend.updateSettings({ previewWhenLocked: v })} label="Preview mode on lock screen" description="Allow non-sensitive information to show while locked." />
        </div>
      </div>
      <Dialog
        open={confirmNever}
        onClose={() => setConfirmNever(false)}
        title="Disable auto-lock?"
        footer={
          <>
            <Button size="sm" onClick={() => setConfirmNever(false)}>
              Keep auto-lock
            </Button>
            <Button size="sm" variant="danger" onClick={() => { void backend.updateSettings({ autoLockMinutes: 0 }); setConfirmNever(false); }}>
              Disable
            </Button>
          </>
        }
      >
        Anyone with access to this browser could send funds without your password until you lock the wallet manually.
      </Dialog>
    </div>
  );
}

function Tile({ label, value, tone, onClick }: { label: string; value: string; tone?: "ok" | "warn"; onClick: () => void }) {
  return (
    <button onClick={onClick} className="card px-3 py-3 text-left transition-colors hover:bg-card-2">
      <div className="label">{label}</div>
      <div className={cx("mt-1.5 text-[15px] font-semibold", tone === "warn" ? "text-warn" : tone === "ok" ? "text-accent" : "text-ink")}>{value}</div>
    </button>
  );
}

function ConnectedApps() {
  const snap = useSnapshot();
  const backend = useBackend();
  const [confirmAll, setConfirmAll] = useState(false);
  const perms = snap?.permissions ?? [];
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Connected apps" onBack={() => goBack("/security")} trailing={perms.length > 0 ? <Button size="xs" variant="ghost" onClick={() => setConfirmAll(true)}>Revoke all</Button> : undefined} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {perms.length === 0 ? (
          <div className="px-2 py-10 text-center text-[13px] text-ink-2">No site is connected. Sites only see your address after you approve a connection.</div>
        ) : (
          <div className="space-y-2">
            {perms.map((p) => (
              <div key={p.origin} className="card px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium text-ink">{p.origin.replace(/^https?:\/\//, "")}</div>
                    <div className="mt-0.5 text-[12px] text-ink-2">Connected {formatRelativeTime(p.connectedAt)}{p.lastUsedAt ? ` · used ${formatRelativeTime(p.lastUsedAt)}` : ""}</div>
                    <div className="mt-1 text-[12px] text-ink-2">Permissions: view address{p.accounts.length > 1 ? `es (${p.accounts.length})` : ""}, request approvals</div>
                    <div className="mono mt-1 text-[11px] text-ink-3">{p.accounts.map((a) => shortAddress(a, 6)).join(", ")}</div>
                  </div>
                  <Button size="xs" variant="danger" onClick={() => void backend.revokePermission({ origin: p.origin })}>
                    Disconnect
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-4 px-2 text-[11px] leading-relaxed text-ink-3">A connected site can see your address and ask you to approve transactions. It can never move funds without your explicit approval.</p>
      </div>
      <Dialog open={confirmAll} onClose={() => setConfirmAll(false)} title="Disconnect all sites?" footer={<><Button size="sm" onClick={() => setConfirmAll(false)}>Cancel</Button><Button size="sm" variant="danger" onClick={() => { void backend.revokeAllPermissions(); setConfirmAll(false); }}>Revoke all</Button></>}>
        Every site will have to ask for a new connection.
      </Dialog>
    </div>
  );
}

function ApprovalManager() {
  const backend = useBackend();
  const snap = useSnapshot();
  const account = useSelectedAccount();
  const allowances = useAllowances();
  const [target, setTarget] = useState<Allowance | null>(null);
  const [review, setReview] = useState<TxReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; message: string; technical: string } | null>(null);
  const [showTech, setShowTech] = useState(false);
  const toast = useToast();
  const watchOnly = account?.kind === "watch";

  const revoke = async (a: Allowance) => {
    if (!account || !snap) return;
    setTarget(a);
    setBusy(true);
    setError(null);
    try {
      const request = buildApprove({ chainId: snap.chainId, from: account.address, token: a.token.address as `0x${string}`, spender: a.spender, amount: 0n });
      const r = await backend.prepareTransaction({ request, meta: { kind: "revoke", symbol: a.token.symbol } });
      setReview(r);
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
    try {
      await backend.confirmTransaction({ reviewId: review.reviewId });
      toast.push({ title: "Revoke submitted", body: `${target?.token.symbol} permission for ${target?.spenderLabel ?? shortAddress(target?.spender ?? "")} is being removed.`, tone: "success" });
      setReview(null);
      setTarget(null);
      window.setTimeout(() => void allowances.refetch(), 1500);
    } catch (e) {
      const h = humanizeError(e);
      setError({ title: h.title, message: h.message, technical: h.technical });
    } finally {
      setBusy(false);
    }
  };

  const list = allowances.data ?? [];
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Token approvals" onBack={() => goBack("/security")} subtitle="Contracts allowed to spend your tokens" />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {allowances.isPending ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : list.length === 0 ? (
          <div className="px-2 py-10 text-center text-[13px] text-ink-2">No active token permissions found for this account.</div>
        ) : (
          <div className="space-y-2">
            {list.map((a) => (
              <div key={`${a.token.address}:${a.spender}`} className="card px-4 py-3">
                <div className="flex items-start gap-3">
                  <TokenAvatar symbol={a.token.symbol} category={a.token.category} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-ink">{displayName(a.token)}</span>
                      <RiskBadge level={a.risk} />
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-2">
                      Spender: {a.spenderLabel ?? "Unknown contract"} · <span className="mono">{shortAddress(a.spender, 6)}</span>
                    </div>
                    <div className="mt-1 text-[13px]">
                      Allowance: <span className={cx("num font-semibold", a.unlimited ? "text-loss" : "text-ink")}>{a.formatted}{a.unlimited ? "" : ` ${a.token.symbol}`}</span>
                    </div>
                  </div>
                  <Button size="xs" variant="danger" disabled={watchOnly} loading={busy && target?.spender === a.spender && target.token.address === a.token.address && !review} onClick={() => void revoke(a)}>
                    Revoke
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {error && !review && <div className="mt-3"><ErrorBanner error={error} showTech={showTech} onToggle={() => setShowTech((v) => !v)} /></div>}
        <p className="mt-4 px-2 text-[11px] leading-relaxed text-ink-3">Revoking sets the permission to zero with a small onchain transaction. Unlimited permissions to unknown contracts are flagged as high risk.</p>
      </div>
      <Sheet open={!!review} onClose={() => { if (review) void backend.discardReview({ reviewId: review.reviewId }); setReview(null); }} title="Revoke permission">
        {review && (
          <div className="space-y-3">
            <TxReviewCard review={review} compact />
            {error && <ErrorBanner error={error} showTech={showTech} onToggle={() => setShowTech((v) => !v)} />}
            <Button variant="primary" full loading={busy} onClick={confirm}>
              CONFIRM REVOKE
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function ExportRecovery() {
  const backend = useBackend();
  const snap = useSnapshot();
  const [password, setPassword] = useState("");
  const [accountId, setAccountId] = useState<string>("");
  const [secret, setSecret] = useState<{ mnemonic?: string; privateKey?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const { copied, copy } = useCopy(snap?.settings.clearClipboardSeconds ?? 60);
  const setRevealing = useAppStore((s) => s.setRevealingSecret);
  const toast = useToast();
  useEffect(() => {
    setRevealing(!!secret);
    return () => setRevealing(false);
  }, [secret, setRevealing]);
  const signingAccounts = useMemo(() => (snap?.accounts ?? []).filter((a) => a.kind !== "watch"), [snap]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const out = await backend.exportRecovery({ password, accountId: accountId || undefined });
      setSecret(out);
      setPassword("");
      if (!snap?.backupConfirmed && out.mnemonic) await backend.confirmBackup();
    } catch (err) {
      setError(humanizeError(err).code === "INVALID_PASSWORD" ? "Incorrect password." : humanizeError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Export recovery" onBack={() => { setSecret(null); goBack("/security"); }} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {!secret ? (
          <form onSubmit={submit} className="space-y-4">
            <Banner tone="danger" title="Anyone with this secret controls your funds">
              Never share it, never type it into a website, never store it in a screenshot or a cloud note. {snap ? "FRAME" : "The wallet"} support will never ask for it.
            </Banner>
            <div>
              <div className="label mb-2">What to export</div>
              <div className="card divide-y divide-line">
                <ListRow title="Recovery phrase" subtitle="Restores every derived account" trailing={accountId === "" ? <Icon.Check size={16} className="text-accent" /> : undefined} onClick={() => setAccountId("")} />
                {signingAccounts.map((a) => (
                  <ListRow key={a.id} title={`Private key · ${a.name}`} subtitle={<span className="mono">{shortAddress(a.address, 6)}</span>} trailing={accountId === a.id ? <Icon.Check size={16} className="text-accent" /> : undefined} onClick={() => setAccountId(a.id)} />
                ))}
              </div>
            </div>
            <PasswordField label="Re-enter your password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} autoFocus />
            <label className="flex cursor-pointer items-start gap-3 text-[12px] leading-relaxed text-ink-2">
              <input type="checkbox" className="mt-0.5 accent-[#A8FF60]" checked={ack} onChange={(e) => setAck(e.target.checked)} />I understand that anyone who sees this secret can take my funds and that nobody can undo it.
            </label>
            <Button type="submit" variant="danger" full disabled={!password || !ack} loading={busy}>
              REVEAL SECRET
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <Banner tone="danger" title="Do not share this screen" />
            {secret.mnemonic ? (
              <div className="grid grid-cols-3 gap-2">
                {secret.mnemonic.split(" ").map((w, i) => (
                  <div key={i} className="card-flat flex items-center gap-2 px-2.5 py-2 text-[13px]">
                    <span className="num w-4 text-[11px] text-ink-3">{i + 1}</span>
                    <span className="font-medium text-ink">{w}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="card-flat mono break-all px-3 py-3 text-[12px] text-ink">{secret.privateKey}</div>
            )}
            <div className="flex items-center justify-between">
              <button
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-2 hover:text-ink"
                onClick={() => {
                  void copy(secret.mnemonic ?? secret.privateKey ?? "").then((ok) => {
                    if (ok) toast.push({ title: "Copied to clipboard", body: `The clipboard will be cleared after ${snap?.settings.clearClipboardSeconds ?? 60}s if the browser allows it — this cannot be guaranteed.`, tone: "info" });
                  });
                }}
              >
                {copied ? <Icon.Check size={13} className="text-accent" /> : <Icon.Copy size={13} />} {copied ? "Copied" : "Copy"}
              </button>
              <Button size="sm" onClick={() => setSecret(null)}>
                Hide
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-ink-3">Copying a secret to the clipboard is risky: other apps and browser extensions may read it.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ChangePassword() {
  const backend = useBackend();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm || next.length < 8) return;
    setBusy(true);
    setError(null);
    try {
      await backend.changePassword({ current, next });
      toast.push({ title: "Password changed", tone: "success" });
      goBack("/security");
    } catch (err) {
      setError(humanizeError(err).code === "INVALID_PASSWORD" ? "Current password is incorrect." : humanizeError(err).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Change password" onBack={() => goBack("/security")} />
      <form onSubmit={submit} className="space-y-4 px-4">
        <PasswordField label="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} error={error} autoFocus />
        <PasswordField label="New password" value={next} onChange={(e) => setNext(e.target.value)} hint="At least 8 characters." />
        <PasswordField label="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={confirm && confirm !== next ? "Passwords do not match." : undefined} />
        <Button type="submit" variant="primary" full loading={busy} disabled={!current || next.length < 8 || next !== confirm}>
          UPDATE PASSWORD
        </Button>
        <p className="text-[11px] text-ink-3">The vault is re-encrypted on this device. Your recovery phrase does not change.</p>
      </form>
    </div>
  );
}

export { Pill };
