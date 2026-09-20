import { useState, type FormEvent } from "react";
import { BRAND } from "@frame/config";
import { humanizeError } from "@frame/transaction-engine";
import { Button, Icon, Logo, PasswordField } from "@frame/ui";
import { useBackend } from "../context";
import { useSnapshot } from "../state/store";
import { NetworkBadge } from "../components/common";

export function LockScreen() {
  const backend = useBackend();
  const snap = useSnapshot();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await backend.unlock({ password });
      setPassword("");
    } catch (err) {
      const h = humanizeError(err);
      setError(h.code === "INVALID_PASSWORD" ? "Incorrect password. Try again." : h.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-10">
      <div className="flex flex-col items-center gap-3">
        <Logo size={36} className="text-accent" />
        <div className="display text-[22px] tracking-[0.18em] text-ink">{BRAND.name}</div>
        <div className="flex items-center gap-2 text-[12px] text-ink-2">
          <Icon.Lock size={13} /> Wallet Locked
        </div>
      </div>
      <form onSubmit={submit} className="mt-8 w-full max-w-[300px] space-y-3">
        <PasswordField label="Password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} autoFocus />
        <Button type="submit" variant="primary" full loading={busy} disabled={!password}>
          UNLOCK
        </Button>
      </form>
      <div className="mt-6 flex items-center gap-2">
        <NetworkBadge />
        {snap?.mode === "demo" && <span className="text-[11px] uppercase tracking-[0.12em] text-ink-3">Demo</span>}
      </div>
      {snap?.settings.previewWhenLocked && <p className="mt-3 max-w-[280px] text-center text-[11px] text-ink-3">Balances are hidden while locked. Preview mode is enabled: unlock to see and use your portfolio.</p>}
    </div>
  );
}
