import { useEffect, useState, type FormEvent } from "react";
import type { Address, TokenInfo } from "@frame/types";
import { BRAND, ROBINHOOD_MAINNET_ID, ROBINHOOD_TESTNET_ID, chainName, getChainConfig } from "@frame/config";
import { isValidAddress, probeRpc, readTokenMetadata, shortAddress } from "@frame/chain";
import { findToken, makeUnknownToken } from "@frame/token-registry";
import { humanizeError } from "@frame/transaction-engine";
import { Banner, Button, Dialog, Field, Icon, Identicon, ListRow, Logo, PasswordField, Pill, ScreenHeader, Sheet, Toggle, cx, useToast } from "@frame/ui";
import { useApp, useBackend } from "../context";
import { useSnapshot } from "../state/store";
import { useChainClient, useChainId, useSelectedAccount } from "../data/hooks";
import { goBack, useNavigate, useRoute } from "../nav";
import { Disclaimer } from "../components/common";

export function SettingsScreen() {
  const { path } = useRoute();
  const sub = path.split("/")[2];
  switch (sub) {
    case "accounts":
      return <Accounts />;
    case "networks":
      return <Networks />;
    case "address-book":
      return <AddressBook />;
    case "advanced":
      return <Advanced />;
    case "about":
      return <About />;
    case "privacy":
      return <Privacy />;
    case "currency":
      return <SingleOption title="Currency" option="USD · US Dollar" note="More display currencies will be added. Prices are always quoted in USD by the data providers." />;
    case "language":
      return <SingleOption title="Language" option="English" note="Every screen, message and document ships in English for now." />;
    default:
      return <SettingsIndex />;
  }
}

function SettingsIndex() {
  const navigate = useNavigate();
  const backend = useBackend();
  const snap = useSnapshot();
  const { openDashboard } = useApp();
  const items: { label: string; sub?: string; path: string; icon: React.ReactNode }[] = [
    { label: "Accounts", sub: `${snap?.accounts.length ?? 0} account${snap?.accounts.length === 1 ? "" : "s"}`, path: "/settings/accounts", icon: <Icon.Wallet size={16} /> },
    { label: "Networks", sub: snap ? chainName(snap.chainId) : undefined, path: "/settings/networks", icon: <Icon.Globe size={16} /> },
    { label: "Address book", sub: `${snap?.addressBook.length ?? 0} saved`, path: "/settings/address-book", icon: <Icon.Book size={16} /> },
    { label: "Connected apps", sub: `${snap?.permissions.length ?? 0} connected`, path: "/security/apps", icon: <Icon.Link size={16} /> },
    { label: "Security", path: "/security", icon: <Icon.Shield size={16} /> },
    { label: "Privacy", path: "/settings/privacy", icon: <Icon.EyeOff size={16} /> },
    { label: "Currency", sub: "USD", path: "/settings/currency", icon: <Icon.Markets size={16} /> },
    { label: "Language", sub: "English", path: "/settings/language", icon: <Icon.Globe size={16} /> },
    { label: "Advanced", path: "/settings/advanced", icon: <Icon.Settings size={16} /> },
    { label: `About ${BRAND.name}`, sub: `Version ${BRAND.version}`, path: "/settings/about", icon: <Icon.Info size={16} /> },
  ];
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Settings" />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        <div className="card divide-y divide-line">
          {items.map((it) => (
            <ListRow key={it.path} leading={<span className="text-ink-2">{it.icon}</span>} title={it.label} subtitle={it.sub} onClick={() => navigate(it.path)} chevron />
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          {openDashboard && (
            <Button full leading={<Icon.Expand size={15} />} onClick={() => openDashboard("/")}>
              Open full page
            </Button>
          )}
          <Button full leading={<Icon.Lock size={15} />} onClick={() => void backend.lock()}>
            Lock wallet
          </Button>
        </div>
        {snap?.mode === "demo" && (
          <Button variant="ghost" full className="mt-2" onClick={() => void backend.resetDemo()}>
            Reset demo portfolio
          </Button>
        )}
      </div>
    </div>
  );
}

function Accounts() {
  const { params } = useRoute();
  const snap = useSnapshot();
  const backend = useBackend();
  const navigate = useNavigate();
  const toast = useToast();
  const [sheet, setSheet] = useState<"create" | "import" | "watch" | null>(params.action === "create" ? "create" : null);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  const [remove, setRemove] = useState<string | null>(null);

  const close = () => {
    setSheet(null);
    setName("");
    setSecret("");
    setAddress("");
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (sheet === "create") await backend.createAccount({ name });
      else if (sheet === "import") await backend.importAccount({ privateKey: secret, name });
      else if (sheet === "watch") await backend.addWatchAccount({ address: address.trim() as Address, name });
      toast.push({ title: sheet === "watch" ? "Watching address" : "Account added", tone: "success" });
      close();
    } catch (err) {
      setError(humanizeError(err).technical);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Accounts" onBack={() => goBack("/settings")} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        <div className="card divide-y divide-line">
          {(snap?.accounts ?? []).map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-3 py-3">
              <Identicon address={a.address} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[14px] font-medium text-ink">
                  <span className="truncate">{a.name}</span>
                  {a.kind === "watch" && <Pill tone="muted">Watch only</Pill>}
                  {a.kind === "imported" && <Pill tone="muted">Imported</Pill>}
                  {a.id === snap?.selectedAccountId && <Pill tone="accent">Active</Pill>}
                </div>
                <div className="mono mt-0.5 text-[11px] text-ink-2">{shortAddress(a.address, 8)}</div>
              </div>
              <button className="text-ink-3 hover:text-ink" title="Rename" onClick={() => setRename({ id: a.id, name: a.name })}>
                <Icon.Edit size={15} />
              </button>
              {a.kind !== "hd" && (
                <button className="text-ink-3 hover:text-loss" title="Remove" onClick={() => setRemove(a.id)}>
                  <Icon.Trash size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Button size="sm" onClick={() => setSheet("create")} leading={<Icon.Plus size={14} />}>
            Create
          </Button>
          <Button size="sm" onClick={() => setSheet("import")} leading={<Icon.Key size={14} />}>
            Import
          </Button>
          <Button size="sm" onClick={() => setSheet("watch")} leading={<Icon.Eye size={14} />}>
            Watch
          </Button>
        </div>
        <Button variant="ghost" size="sm" full className="mt-2" onClick={() => navigate("/security/export")}>
          Export a private key
        </Button>
      </div>

      <Sheet open={sheet !== null} onClose={close} title={sheet === "create" ? "Create account" : sheet === "import" ? "Import account" : "Watch address"}>
        <form onSubmit={submit} className="space-y-4 pt-1">
          {sheet === "create" && <p className="text-[12px] text-ink-2">A new account derived from your recovery phrase. It is restored automatically with the phrase.</p>}
          {sheet === "import" && <PasswordField label="Private key" placeholder="0x…" value={secret} onChange={(e) => setSecret(e.target.value)} autoFocus />}
          {sheet === "watch" && <Field label="Address" placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value)} autoFocus autoComplete="off" spellCheck={false} />}
          <Field label="Name (optional)" placeholder={sheet === "watch" ? "Treasury" : "Trading"} value={name} onChange={(e) => setName(e.target.value)} />
          {error && <div className="text-[12px] text-loss">{error}</div>}
          <Button type="submit" variant="primary" full loading={busy} disabled={(sheet === "import" && !secret) || (sheet === "watch" && !isValidAddress(address.trim()))}>
            {sheet === "create" ? "CREATE ACCOUNT" : sheet === "import" ? "IMPORT ACCOUNT" : "WATCH ADDRESS"}
          </Button>
        </form>
      </Sheet>

      <Dialog open={!!rename} onClose={() => setRename(null)} title="Rename account" footer={<><Button size="sm" onClick={() => setRename(null)}>Cancel</Button><Button size="sm" variant="primary" onClick={() => { if (rename) void backend.renameAccount(rename); setRename(null); }}>Save</Button></>}>
        <Field value={rename?.name ?? ""} onChange={(e) => setRename((r) => (r ? { ...r, name: e.target.value } : r))} autoFocus />
      </Dialog>
      <Dialog open={!!remove} onClose={() => setRemove(null)} title="Remove account?" footer={<><Button size="sm" onClick={() => setRemove(null)}>Cancel</Button><Button size="sm" variant="danger" onClick={() => { if (remove) void backend.removeAccount({ id: remove }).catch((e: unknown) => toast.push({ title: "Could not remove", body: humanizeError(e).technical, tone: "error" })); setRemove(null); }}>Remove</Button></>}>
        {snap?.accounts.find((a) => a.id === remove)?.kind === "imported" ? "The private key will be deleted from this device. Make sure you have it backed up elsewhere." : "The address will no longer be watched."}
      </Dialog>
    </div>
  );
}

function Networks() {
  const snap = useSnapshot();
  const backend = useBackend();
  const toast = useToast();
  const [status, setStatus] = useState<Record<number, { ok: boolean; latencyMs: number; error?: string } | null>>({});
  const chains = [ROBINHOOD_MAINNET_ID, ROBINHOOD_TESTNET_ID];

  useEffect(() => {
    let cancelled = false;
    for (const id of chains) {
      const cfg = getChainConfig(id, { custom: snap?.settings.customRpc });
      probeRpc(cfg.rpcUrls[0]!, id).then((r) => {
        if (!cancelled) setStatus((s) => ({ ...s, [id]: r }));
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap?.settings.customRpc]);

  const select = async (id: number) => {
    try {
      await backend.setNetworkMode({ mode: id === ROBINHOOD_MAINNET_ID ? "mainnet" : "testnet" });
    } catch (e) {
      toast.push({ title: "Cannot switch", body: humanizeError(e).technical, tone: "error" });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Networks" onBack={() => goBack("/settings")} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {snap?.mode === "demo" && (
          <Banner tone="accent" className="mb-3">
            Demo mode simulates Robinhood Chain locally. Live builds start on the testnet and switch to mainnet only when you choose to.
          </Banner>
        )}
        <div className="space-y-2">
          {chains.map((id) => {
            const cfg = getChainConfig(id, { custom: snap?.settings.customRpc });
            const active = snap?.chainId === id;
            const st = status[id];
            const testnet = id === ROBINHOOD_TESTNET_ID;
            return (
              <button key={id} className={cx("card w-full px-4 py-3 text-left transition-colors hover:bg-card-2", active && "border-accent", testnet && "border-dashed")} onClick={() => void select(id)} disabled={snap?.mode === "demo"}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cx("text-[14px] font-semibold", testnet ? "text-warn" : "text-ink")}>{cfg.chain.name}</span>
                    {testnet && <Pill tone="warn">TESTNET</Pill>}
                    {active && <Pill tone="accent">Active</Pill>}
                  </div>
                  {st === undefined ? <span className="text-[11px] text-ink-3">checking…</span> : st?.ok ? <span className="text-[11px] text-accent">{st.latencyMs} ms</span> : <span className="text-[11px] text-loss">unreachable</span>}
                </div>
                <div className="mt-1 text-[12px] text-ink-2">
                  Chain ID {id} · ETH for gas · {cfg.explorerUrl.replace(/^https?:\/\//, "")}
                </div>
                <div className="mono mt-1 truncate text-[11px] text-ink-3">{cfg.rpcUrls[0]}</div>
                {st && !st.ok && st.error && <div className="mt-1 text-[11px] text-loss">{st.error}</div>}
              </button>
            );
          })}
        </div>
        <p className="mt-3 px-1 text-[11px] leading-relaxed text-ink-3">Ethereum, Arbitrum One and Base are available only as sources for bridging into Robinhood Chain. Custom RPC endpoints are configured under Advanced.</p>
      </div>
    </div>
  );
}

function AddressBook() {
  const snap = useSnapshot();
  const backend = useBackend();
  const [editing, setEditing] = useState<{ id?: string; name: string; address: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await backend.saveAddressBookEntry({ id: editing.id, name: editing.name, address: editing.address.trim() as Address });
      setEditing(null);
    } catch (err) {
      setError(humanizeError(err).technical);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Address book" onBack={() => goBack("/settings")} trailing={<Button size="xs" onClick={() => setEditing({ name: "", address: "" })} leading={<Icon.Plus size={13} />}>Add</Button>} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {(snap?.addressBook.length ?? 0) === 0 ? (
          <div className="px-2 py-10 text-center text-[13px] text-ink-2">Save addresses you send to often. Names are shown next to the shortened address everywhere.</div>
        ) : (
          <div className="card divide-y divide-line">
            {snap!.addressBook.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-3 py-3">
                <Identicon address={e.address} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium text-ink">{e.name}</div>
                  <div className="mono text-[11px] text-ink-2">{shortAddress(e.address, 8)}</div>
                </div>
                <button className="text-ink-3 hover:text-ink" onClick={() => setEditing({ id: e.id, name: e.name, address: e.address })}>
                  <Icon.Edit size={15} />
                </button>
                <button className="text-ink-3 hover:text-loss" onClick={() => void backend.removeAddressBookEntry({ id: e.id })}>
                  <Icon.Trash size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit contact" : "New contact"}>
        <form onSubmit={save} className="space-y-4 pt-1">
          <Field label="Name" placeholder="Treasury" value={editing?.name ?? ""} onChange={(e) => setEditing((x) => (x ? { ...x, name: e.target.value } : x))} autoFocus />
          <Field label="Address" placeholder="0x…" value={editing?.address ?? ""} onChange={(e) => setEditing((x) => (x ? { ...x, address: e.target.value } : x))} autoComplete="off" spellCheck={false} error={error ?? (editing?.address && !isValidAddress(editing.address.trim()) ? "Enter a valid 0x address." : undefined)} />
          <Button type="submit" variant="primary" full loading={busy} disabled={!editing?.name.trim() || !isValidAddress((editing?.address ?? "").trim())}>
            SAVE
          </Button>
        </form>
      </Sheet>
    </div>
  );
}

function Privacy() {
  const snap = useSnapshot();
  const backend = useBackend();
  if (!snap) return null;
  const s = snap.settings;
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Privacy" onBack={() => goBack("/settings")} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        <div className="card divide-y divide-line">
          <Toggle checked={s.telemetryOptIn} onChange={(v) => void backend.updateSettings({ telemetryOptIn: v })} label="Anonymous usage statistics" description="Off by default. If enabled, only screen names and error codes are counted — never addresses, balances, secrets or signed data." />
          <Toggle checked={s.notifications} onChange={(v) => void backend.updateSettings({ notifications: v })} label="Notifications" description="Received funds, completed swaps and bridges, failed transactions. Never promotional." />
        </div>
        <p className="mt-3 px-1 text-[11px] leading-relaxed text-ink-3">Prices are fetched from public market-data endpoints and balances from the configured RPC. Your keys never leave this device.</p>
      </div>
    </div>
  );
}

function Advanced() {
  const snap = useSnapshot();
  const backend = useBackend();
  const chainId = useChainId();
  const client = useChainClient();
  const toast = useToast();
  const [rpc, setRpc] = useState(snap?.settings.customRpc[chainId] ?? "");
  const [rpcBusy, setRpcBusy] = useState(false);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [tokenAddr, setTokenAddr] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TokenInfo | null>(null);
  const [dev, setDev] = useState<{ block?: number; latency?: number; chainId?: number } | null>(null);
  const s = snap?.settings;

  useEffect(() => {
    if (!s?.developerMode) return;
    let cancelled = false;
    const t0 = Date.now();
    Promise.all([client.getBlockNumber(), client.getChainId()]).then(([b, c]) => {
      if (!cancelled) setDev({ block: Number(b), latency: Date.now() - t0, chainId: c });
    }).catch(() => setDev(null));
    return () => {
      cancelled = true;
    };
  }, [s?.developerMode, client]);

  const saveRpc = async () => {
    setRpcBusy(true);
    setRpcError(null);
    const r = await backend.setCustomRpc({ chainId, url: rpc.trim() || null });
    setRpcBusy(false);
    if (!r.ok) setRpcError(r.error ?? "Could not verify this endpoint.");
    else toast.push({ title: rpc.trim() ? "Custom RPC saved" : "Using default RPC", tone: "success" });
  };

  const lookupToken = async () => {
    const a = tokenAddr.trim();
    if (!isValidAddress(a)) return;
    setTokenBusy(true);
    setTokenError(null);
    setPreview(null);
    try {
      const known = findToken(chainId, a);
      if (known) {
        setTokenError(`${known.symbol} is already a verified token.`);
        return;
      }
      const meta = await readTokenMetadata(client, a as Address);
      if (!meta) {
        setTokenError("No ERC-20 contract found at this address on the current network.");
        return;
      }
      setPreview(makeUnknownToken(chainId, a as Address, meta, { custom: true, category: "ecosystem" }));
    } catch (e) {
      setTokenError(humanizeError(e).technical);
    } finally {
      setTokenBusy(false);
    }
  };

  if (!s) return null;
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Advanced" onBack={() => goBack("/settings")} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        <Banner tone="info" className="mb-3">
          These settings are for advanced users. The defaults are safe.
        </Banner>
        <div className="label px-1">Custom RPC · {chainName(chainId)}</div>
        <div className="card mt-2 px-4 py-3">
          <Field placeholder="https://…" value={rpc} onChange={(e) => setRpc(e.target.value)} error={rpcError} hint="The endpoint must report the correct chain ID or it will be refused." autoComplete="off" spellCheck={false} />
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" loading={rpcBusy} onClick={saveRpc} disabled={snap?.mode === "demo"}>
              Verify & save
            </Button>
            {s.customRpc[chainId] && (
              <Button size="sm" variant="ghost" onClick={() => { setRpc(""); void backend.setCustomRpc({ chainId, url: null }); }}>
                Reset to default
              </Button>
            )}
          </div>
        </div>

        <div className="label mt-5 px-1">Custom token import</div>
        <div className="card mt-2 px-4 py-3">
          <Field placeholder="Token contract address (0x…)" value={tokenAddr} onChange={(e) => setTokenAddr(e.target.value)} error={tokenError} autoComplete="off" spellCheck={false} />
          <Button size="sm" className="mt-2" loading={tokenBusy} onClick={lookupToken} disabled={!isValidAddress(tokenAddr.trim())}>
            Look up
          </Button>
          {preview && (
            <div className="mt-3 rounded-[10px] border border-warn/30 bg-warn-dim p-3 text-[12px]">
              <div className="font-semibold text-warn">Unverified token</div>
              <div className="mt-1 text-ink">
                {preview.symbol} · {preview.name} · {preview.decimals} decimals
              </div>
              <div className="mt-1 text-ink-2">Importing shows its balance in your wallet. It does not make it safe.</div>
              <Button size="sm" variant="primary" className="mt-2" onClick={() => void backend.addCustomToken({ token: preview }).then(() => { setPreview(null); setTokenAddr(""); toast.push({ title: `${preview.symbol} imported`, tone: "success" }); })}>
                Import
              </Button>
            </div>
          )}
        </div>

        <div className="label mt-5 px-1">Transactions</div>
        <div className="card mt-2 divide-y divide-line">
          <Toggle checked={s.showRawTransactionData} onChange={(v) => void backend.updateSettings({ showRawTransactionData: v })} label="Show raw transaction data" description="Adds a technical details section (calldata, nonce, gas limit) to every review." />
          <Toggle checked={s.developerMode} onChange={(v) => void backend.updateSettings({ developerMode: v })} label="Developer mode" description="Shows chain ID, RPC latency, block height, contract addresses and simulation details." />
        </div>
        <p className="mt-2 px-1 text-[11px] text-ink-3">Nonce and gas-limit overrides are honoured when a dApp or a script provides them; manual overrides in the send flow arrive with developer mode.</p>

        {s.developerMode && (
          <>
            <div className="label mt-5 px-1">Developer</div>
            <div className="card mt-2 px-4 py-1 text-[12px]">
              {[
                ["Chain ID", String(chainId)],
                ["Reported by RPC", dev?.chainId !== undefined ? String(dev.chainId) : "…"],
                ["Block height", dev?.block !== undefined ? dev.block.toLocaleString("en-US") : "…"],
                ["RPC latency", dev?.latency !== undefined ? `${dev.latency} ms` : "…"],
                ["App mode", snap?.mode ?? ""],
                ["Registry", `${chainName(chainId)} · ${findToken(chainId, "native") ? "loaded" : "—"}`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-2">
                  <span className="text-ink-2">{k}</span>
                  <span className="mono text-ink">{v}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function About() {
  const { openExternal } = useApp();
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={`About ${BRAND.name}`} onBack={() => goBack("/settings")} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <div className="flex items-center gap-3">
          <Logo size={36} className="text-accent" />
          <div>
            <div className="display text-[18px] tracking-[0.16em] text-ink">{BRAND.name}</div>
            <div className="text-[12px] text-ink-2">Version {BRAND.version}</div>
          </div>
        </div>
        <p className="mt-4 text-[13px] leading-relaxed text-ink">{BRAND.tagline}</p>
        <p className="mt-1 text-[13px] text-ink-2">{BRAND.subline}</p>
        <p className="mt-3 text-[12px] text-ink-2">{BRAND.positioningAlt} Self-custodial: your keys are encrypted on this device and never leave it.</p>
        <div className="card mt-4 divide-y divide-line">
          <ListRow title="Website" subtitle={BRAND.links.website} onClick={() => openExternal(BRAND.links.website)} chevron />
          <ListRow title="Source code" subtitle={BRAND.links.github} onClick={() => openExternal(BRAND.links.github)} chevron />
          <ListRow title="Support" subtitle={BRAND.links.support.replace("mailto:", "")} onClick={() => openExternal(BRAND.links.support)} chevron />
        </div>
        <Disclaimer className="mt-4" />
      </div>
    </div>
  );
}

function SingleOption({ title, option, note }: { title: string; option: string; note: string }) {
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={title} onBack={() => goBack("/settings")} />
      <div className="px-3">
        <div className="card">
          <ListRow title={option} trailing={<Icon.Check size={16} className="text-accent" />} />
        </div>
        <p className="mt-3 px-1 text-[11px] leading-relaxed text-ink-3">{note}</p>
      </div>
    </div>
  );
}

export { useSelectedAccount };
