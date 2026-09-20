import { BRAND, chainName } from "@frame/config";
import { formatTokenAmount, formatUsd } from "@frame/chain";
import { Button, Icon, TokenAvatar, cx } from "@frame/ui";
import { useOtherChainFunds, useSelectedAccount } from "../data/hooks";
import { useNavigate } from "../nav";

/**
 * "Funds on other networks": ETH the account holds on Ethereum, Arbitrum One
 * or Base — the same address, a different chain. Shown wherever the user
 * would otherwise wonder where a deposit went, with the one action that
 * matters: move it to Robinhood Chain.
 */
export function OtherNetworksCard({ compact, className }: { compact?: boolean; className?: string }) {
  const account = useSelectedAccount();
  const navigate = useNavigate();
  const { funds, totalUsd } = useOtherChainFunds(account?.address);
  if (!account || funds.length === 0) return null;
  const watchOnly = account.kind === "watch";
  return (
    <div className={cx("card", compact ? "px-4 py-3" : "px-5 py-4", className ?? (compact ? "mx-3 mt-3" : ""))}>
      <div className="flex items-center justify-between">
        <div className="label">Funds on other networks</div>
        {totalUsd !== null && <span className="num text-[12px] text-ink-2">{formatUsd(totalUsd)}</span>}
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-2">Same address, different network. They cannot be used on Robinhood Chain until you move them.</p>
      <div className="mt-3 space-y-2">
        {funds.map((f) => (
          <div key={f.chainId} className="flex items-center justify-between gap-3 rounded-[12px] border border-line bg-surface px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <TokenAvatar symbol="ETH" category="native" size={26} />
              <div className="min-w-0">
                <div className="num truncate text-[13px] font-semibold text-ink">{formatTokenAmount(f.wei, 18)} ETH</div>
                <div className="truncate text-[11px] text-ink-3">
                  on {chainName(f.chainId)}
                  {f.usd !== null ? ` · ${formatUsd(f.usd)}` : ""}
                </div>
              </div>
            </div>
            <Button size="xs" variant="primary" disabled={watchOnly} onClick={() => navigate("/bridge", { from: String(f.chainId) })} leading={<Icon.Bridge size={13} />}>
              {compact ? "Move" : "Move to Robinhood Chain"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Empty-portfolio state that knows about funds waiting on other networks. */
export function EmptyPortfolio({ compact }: { compact?: boolean }) {
  const account = useSelectedAccount();
  const navigate = useNavigate();
  const { funds, loading } = useOtherChainFunds(account?.address);
  const first = funds[0];
  if (first) {
    return (
      <div className={cx("text-center", compact && "text-[13px]")}>
        <div className="text-ink">Nothing on Robinhood Chain yet.</div>
        <div className="mt-1 text-[12px] text-ink-2">
          You have {formatTokenAmount(first.wei, 18)} ETH waiting on {chainName(first.chainId)}
          {funds.length > 1 ? ` (and more on ${funds.length - 1 === 1 ? "another network" : "other networks"})` : ""}.
        </div>
        <Button size="sm" variant="primary" className="mt-3" leading={<Icon.Bridge size={14} />} onClick={() => navigate("/bridge", { from: String(first.chainId) })} disabled={account?.kind === "watch"}>
          Move it to Robinhood Chain
        </Button>
      </div>
    );
  }
  return (
    <div className={cx("text-center", compact && "text-[13px]")}>
      <div className="text-ink">No assets yet</div>
      <div className="mt-1 text-[12px] text-ink-2">
        {loading ? "Checking Ethereum, Arbitrum One and Base for funds…" : `Receive ETH or Stock Tokens on Robinhood Chain, or move ETH from Ethereum, Arbitrum One or Base — ${BRAND.name} watches all of them.`}
      </div>
      <div className="mt-3 flex justify-center gap-2">
        <Button size="sm" onClick={() => navigate("/receive")}>
          Receive
        </Button>
        <Button size="sm" onClick={() => navigate("/bridge")}>
          Bridge
        </Button>
      </div>
    </div>
  );
}
