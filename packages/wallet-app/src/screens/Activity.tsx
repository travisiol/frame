import { useMemo, useState } from "react";
import type { ActivityItem } from "@frame/types";
import { formatDateTime, formatRelativeTime, shortAddress } from "@frame/chain";
import { isStockLike } from "@frame/token-registry";
import { filterActivity, type ActivityFilter } from "@frame/transaction-engine";
import { EmptyState, Icon, ListRow, Pill, ScreenHeader, Sheet, SkeletonRow, Tabs, cx } from "@frame/ui";
import { useApp } from "../context";
import { useSnapshot } from "../state/store";
import { useActivity, useSelectedAccount, useTokens } from "../data/hooks";
import { ExplorerLink } from "../components/common";

const FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "swaps", label: "Swaps" },
  { value: "send", label: "Send" },
  { value: "receive", label: "Receive" },
  { value: "bridge", label: "Bridge" },
  { value: "approvals", label: "Approvals" },
  { value: "stock-tokens", label: "Stock Tokens" },
];

const KIND_ICON: Record<ActivityItem["kind"], React.ReactNode> = {
  send: <Icon.Send size={15} />,
  receive: <Icon.Receive size={15} />,
  swap: <Icon.Swap size={15} />,
  approve: <Icon.Key size={15} />,
  bridge: <Icon.Bridge size={15} />,
  contract: <Icon.Layers size={15} />,
  connect: <Icon.Link size={15} />,
  buy: <Icon.Swap size={15} />,
  sell: <Icon.Swap size={15} />,
};

export function ActivityScreen() {
  const snap = useSnapshot();
  const account = useSelectedAccount();
  const { lookup } = useTokens();
  const activity = useActivity();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [selected, setSelected] = useState<ActivityItem | null>(null);
  const { openExternal } = useApp();

  const items = useMemo(() => {
    const list = activity.data ?? [];
    return filterActivity(list, filter, (a) => {
      const t = lookup(a as `0x${string}` | "native");
      return !!t && isStockLike(t);
    });
  }, [activity.data, filter, lookup]);

  const groups = useMemo(() => {
    const out: { label: string; items: ActivityItem[] }[] = [];
    for (const it of items) {
      const label = dayLabel(it.timestamp);
      const g = out[out.length - 1];
      if (g && g.label === label) g.items.push(it);
      else out.push({ label, items: [it] });
    }
    return out;
  }, [items]);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Activity" subtitle={account ? `${account.name} · ${shortAddress(account.address)}` : undefined} />
      <div className="px-3 pb-2">
        <Tabs value={filter} onChange={setFilter} items={FILTERS} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {activity.isPending ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : activity.isError ? (
          <EmptyState icon={<Icon.Warning size={18} />} title="Activity unavailable" body="The explorer and the RPC did not respond. Your transactions are still on chain — retry in a moment." />
        ) : items.length === 0 ? (
          <EmptyState icon={<Icon.Activity size={18} />} title="No activity yet" body={filter === "all" ? "Sends, swaps, bridges and connections will appear here in plain language." : "Nothing matches this filter."} />
        ) : (
          groups.map((g) => (
            <div key={g.label} className="mb-3">
              <div className="label px-2 py-2">{g.label}</div>
              <div className="space-y-0.5">
                {g.items.map((it) => (
                  <ActivityRow key={it.id} item={it} onClick={() => setSelected(it)} />
                ))}
              </div>
            </div>
          ))
        )}
        {snap?.mode === "demo" && items.length > 0 && <p className="px-2 pt-2 text-[11px] text-ink-3">Demo activity is simulated and was never broadcast to Robinhood Chain.</p>}
      </div>
      <Sheet open={!!selected} onClose={() => setSelected(null)} title={selected?.title}>
        {selected && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <StatusPill status={selected.status} />
              {selected.demo && <Pill tone="accent">Demo</Pill>}
              <span className="text-[12px] text-ink-2">{formatDateTime(selected.timestamp)}</span>
            </div>
            {selected.amounts.length > 0 && (
              <div className="card divide-y divide-line px-4">
                {selected.amounts.map((a, i) => (
                  <div key={i} className="flex items-center justify-between py-2.5 text-[14px]">
                    <span className="text-ink-2">{a.sign === "+" ? "Received" : "Sent"}</span>
                    <span className={cx("num font-medium", a.sign === "+" ? "text-accent" : "text-ink")}>
                      {a.sign}
                      {a.amount} {a.symbol}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="card-flat px-4 py-1 text-[12px]">
              {selected.counterparty && (
                <div className="flex items-start justify-between gap-3 py-2">
                  <span className="text-ink-2">{selected.kind === "receive" ? "From" : "To"}</span>
                  <span className="mono break-all text-right text-ink">
                    {selected.counterpartyLabel ? `${selected.counterpartyLabel} · ` : ""}
                    {selected.counterparty}
                  </span>
                </div>
              )}
              {selected.subtitle && (
                <div className="flex items-start justify-between gap-3 py-2">
                  <span className="text-ink-2">Details</span>
                  <span className="text-right text-ink">{selected.subtitle}</span>
                </div>
              )}
              {selected.hash && (
                <div className="flex items-start justify-between gap-3 py-2">
                  <span className="text-ink-2">Transaction</span>
                  <span className="mono break-all text-right text-ink">{selected.hash}</span>
                </div>
              )}
              <div className="flex items-start justify-between gap-3 py-2">
                <span className="text-ink-2">Source</span>
                <span className="text-right text-ink">{selected.source === "local" ? "Sent from this wallet" : selected.source === "explorer" ? "Block explorer" : selected.source === "logs" ? "Onchain logs" : "Demo"}</span>
              </div>
            </div>
            {selected.explorerUrl && (
              <div className="flex justify-end">
                <button className="btn btn-secondary btn-sm" onClick={() => openExternal(selected.explorerUrl!)}>
                  Open in explorer <Icon.External size={13} />
                </button>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}

export function ActivityRow({ item, onClick }: { item: ActivityItem; onClick?: () => void }) {
  const primary = item.amounts[0];
  const secondary = item.amounts[1];
  return (
    <ListRow
      onClick={onClick}
      leading={
        <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", item.status === "failed" ? "bg-loss-dim text-loss" : item.kind === "receive" || item.kind === "buy" ? "bg-accent-dim text-accent" : "bg-card-2 text-ink-2")}>
          {item.status === "failed" ? <Icon.Close size={15} /> : KIND_ICON[item.kind]}
        </span>
      }
      title={
        <span className="flex items-center gap-2">
          {item.title}
          {item.status === "pending" && <Pill tone="warn" dot>Pending</Pill>}
          {item.status === "failed" && <Pill tone="loss">Failed</Pill>}
        </span>
      }
      subtitle={item.subtitle ?? formatRelativeTime(item.timestamp)}
      trailing={
        primary ? (
          <div>
            <div className={cx("num text-[13px] font-medium", primary.sign === "+" ? "text-accent" : "text-ink")}>
              {primary.sign}
              {primary.amount} {primary.symbol}
            </div>
            {secondary && (
              <div className={cx("num text-[11px]", secondary.sign === "+" ? "text-accent" : "text-ink-2")}>
                {secondary.sign}
                {secondary.amount} {secondary.symbol}
              </div>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-ink-3">{formatRelativeTime(item.timestamp)}</span>
        )
      }
    />
  );
}

function StatusPill({ status }: { status: ActivityItem["status"] }) {
  if (status === "confirmed") return <Pill tone="accent">Confirmed</Pill>;
  if (status === "pending")
    return (
      <Pill tone="warn" dot>
        Pending
      </Pill>
    );
  return <Pill tone="loss">Failed</Pill>;
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

export { ExplorerLink };
