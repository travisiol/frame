import { useState, type ReactNode } from "react";
import type { Account, RiskLevel, TokenInfo } from "@frame/types";
import { BRAND, ROBINHOOD_TESTNET_ID, chainName } from "@frame/config";
import { formatUsd, shortAddress } from "@frame/chain";
import { categoryLabel, displayName, exposureLabel } from "@frame/token-registry";
import { Banner, Button, CopyButton, Icon, Identicon, ListRow, PctChange, Pill, Sheet, TokenAvatar, cx, useToast } from "@frame/ui";
import { useApp, useBackend } from "../context";
import { useSnapshot } from "../state/store";
import { useSelectedAccount } from "../data/hooks";
import { useNavigate } from "../nav";

export function NetworkBadge({ className }: { className?: string }) {
  const snap = useSnapshot();
  if (!snap) return null;
  const testnet = snap.chainId === ROBINHOOD_TESTNET_ID;
  return (
    <Pill tone={testnet ? "warn" : "muted"} className={className} dot>
      {testnet ? "Testnet" : chainName(snap.chainId)}
    </Pill>
  );
}

export function ModeBanners() {
  const snap = useSnapshot();
  if (!snap) return null;
  const testnet = snap.chainId === ROBINHOOD_TESTNET_ID;
  return (
    <>
      {snap.mode === "demo" && (
        <div className="flex items-center justify-center gap-2 bg-accent-dim px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
          <span className="status-dot bg-accent" />
          Demo portfolio — nothing is sent onchain
        </div>
      )}
      {testnet && (
        <div className="flex items-center justify-center gap-2 bg-warn px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-base">
          <Icon.Warning size={13} />
          Testnet — test assets have no value
        </div>
      )}
    </>
  );
}

export function AccountSwitcher({ compact }: { compact?: boolean }) {
  const snap = useSnapshot();
  const account = useSelectedAccount();
  const backend = useBackend();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (!snap || !account) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} className="flex min-w-0 items-center gap-2 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-card-2" title={account.address}>
        <Identicon address={account.address} size={compact ? 20 : 24} />
        <span className="min-w-0 truncate text-[13px] font-medium text-ink">{account.name}</span>
        {account.kind === "watch" && (
          <Pill tone="muted" className="h-[18px] px-1.5 text-[9px]">
            Watch
          </Pill>
        )}
        <Icon.ChevronDown size={14} className="shrink-0 text-ink-3" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Accounts">
        <div className="space-y-1">
          {snap.accounts.map((a) => (
            <ListRow
              key={a.id}
              leading={<Identicon address={a.address} size={32} />}
              title={
                <span className="flex items-center gap-2">
                  {a.name}
                  {a.kind === "watch" && <Pill tone="muted">Watch only</Pill>}
                  {a.kind === "imported" && <Pill tone="muted">Imported</Pill>}
                </span>
              }
              subtitle={<span className="mono">{shortAddress(a.address, 6)}</span>}
              trailing={a.id === account.id ? <Icon.Check size={16} className="text-accent" /> : undefined}
              onClick={() => {
                void backend.selectAccount({ id: a.id });
                setOpen(false);
              }}
            />
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            full
            leading={<Icon.Plus size={14} />}
            onClick={() => {
              setOpen(false);
              navigate("/settings/accounts", { action: "create" });
            }}
          >
            Create account
          </Button>
          <Button
            size="sm"
            full
            onClick={() => {
              setOpen(false);
              navigate("/settings/accounts");
            }}
          >
            Manage
          </Button>
        </div>
      </Sheet>
    </>
  );
}

export function AddressLine({ address, label, chars = 4, copy = true, className }: { address: string; label?: string; chars?: number; copy?: boolean; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1", className)}>
      {label && <span className="text-ink">{label}</span>}
      <span className="mono text-ink-2" title={address}>
        {label ? `(${shortAddress(address, chars)})` : shortAddress(address, chars)}
      </span>
      {copy && <CopyButton text={address} size={12} />}
    </span>
  );
}

export function VerifiedBadge({ token }: { token: TokenInfo }) {
  if (token.address === "native") return null;
  return token.verified ? (
    <Pill tone="accent">
      <Icon.Check size={11} /> Verified
    </Pill>
  ) : token.category === "unknown" ? (
    <Pill tone="warn">
      <Icon.Warning size={11} /> Unknown token
    </Pill>
  ) : (
    <Pill tone="warn">
      <Icon.Warning size={11} /> Unverified
    </Pill>
  );
}

export function AssetRow({
  token,
  balance,
  valueUsd,
  change,
  priceUsd,
  onClick,
  trailingOverride,
  subtitleOverride,
  demoPrice,
  pending,
}: {
  token: TokenInfo;
  balance?: string;
  valueUsd?: number | null;
  change?: number | null;
  priceUsd?: number | null;
  onClick?: () => void;
  trailingOverride?: ReactNode;
  subtitleOverride?: ReactNode;
  demoPrice?: boolean;
  /** Prices are still loading: show a placeholder instead of "unavailable". */
  pending?: boolean;
}) {
  return (
    <ListRow
      leading={<TokenAvatar symbol={token.symbol} category={token.category} logo={token.logo} />}
      title={
        <span className="flex items-center gap-2">
          <span>{displayName(token)}</span>
          {!token.verified && token.address !== "native" && <Icon.Warning size={13} className="text-warn" />}
        </span>
      }
      subtitle={
        subtitleOverride ?? (
          <span>
            {balance !== undefined ? `${balance} ${token.symbol}` : exposureLabel(token)}
            {balance !== undefined && priceUsd !== undefined && priceUsd !== null ? <span className="text-ink-3"> · {formatUsd(priceUsd)}</span> : null}
          </span>
        )
      }
      trailing={
        trailingOverride ?? (
          <div>
            <div className="num text-[14px] font-medium text-ink">{valueUsd === null || valueUsd === undefined ? <span className="text-[11px] font-normal text-ink-3">{pending ? "…" : "Price unavailable"}</span> : formatUsd(valueUsd)}</div>
            <div className="mt-0.5 flex items-center justify-end gap-1">
              <PctChange value={change} />
              {demoPrice && <span className="text-[9px] uppercase tracking-wider text-ink-3">demo</span>}
            </div>
          </div>
        )
      }
      onClick={onClick}
    />
  );
}

export function RiskBadge({ level, className }: { level: RiskLevel; className?: string }) {
  const map = { low: ["accent", "Low risk"], caution: ["warn", "Caution"], high: ["loss", "High risk"] } as const;
  const [tone, label] = map[level];
  return (
    <Pill tone={tone} className={className}>
      {label}
    </Pill>
  );
}

export function CategoryPill({ token }: { token: TokenInfo }) {
  return <Pill tone="muted">{categoryLabel(token.category)}</Pill>;
}

export function BackupReminder() {
  const snap = useSnapshot();
  const navigate = useNavigate();
  // Nothing to back up while the wallet only watches addresses (no vault, no phrase).
  if (!snap || snap.backupConfirmed || snap.mode === "demo" || !snap.accounts.some((a) => a.kind !== "watch")) return null;
  return (
    <Banner tone="warn" title="Back up your recovery phrase" className="mx-3">
      Without it, this wallet cannot be restored if the browser is reset.{" "}
      <button className="font-semibold underline" onClick={() => navigate("/security/export")}>
        Back up now
      </button>
    </Banner>
  );
}

export function LowGasBanner({ gasWei, threshold }: { gasWei: bigint; threshold: string }) {
  const navigate = useNavigate();
  let low = false;
  try {
    low = gasWei < BigInt(Math.round(Number(threshold) * 1e18));
  } catch {
    low = false;
  }
  if (!low) return null;
  return (
    <Banner tone="warn" title="Low gas" className="mx-3">
      You may not have enough ETH to make another transaction on Robinhood Chain.{" "}
      <button className="font-semibold underline" onClick={() => navigate("/bridge")}>
        Move ETH
      </button>
    </Banner>
  );
}

export function ExplorerLink({ url, children }: { url?: string; children?: ReactNode }) {
  const { openExternal } = useApp();
  if (!url) return null;
  return (
    <button className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-2 hover:text-ink" onClick={() => openExternal(url)}>
      {children ?? "View in explorer"} <Icon.External size={13} />
    </button>
  );
}

export function useErrorToast() {
  const toast = useToast();
  return (title: string, body?: string) => toast.push({ title, body, tone: "error" });
}

export function Disclaimer({ className }: { className?: string }) {
  return <p className={cx("text-[11px] leading-relaxed text-ink-3", className)}>{BRAND.disclaimer}</p>;
}

export function accountLabel(accounts: Account[], address: string): string | undefined {
  return accounts.find((a) => a.address.toLowerCase() === address.toLowerCase())?.name;
}
