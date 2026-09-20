import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BRAND } from "@frame/config";
import { assessPassword, looksLikeMnemonic, looksLikePrivateKey } from "@frame/security";
import { isValidAddress } from "@frame/chain";
import { humanizeError } from "@frame/transaction-engine";
import { Button, Confetti, FRAME_FLOATING_ITEMS, Field, FloatingField, Icon, Logo, PasswordField, cx, useCopy } from "@frame/ui";
import { useApp, useBackend } from "../context";
import { useAppStore, useSnapshot } from "../state/store";
import { Disclaimer } from "../components/common";

type Step =
  | { kind: "welcome" }
  | { kind: "password"; next: "create" | "import" }
  | { kind: "import"; password: string }
  | { kind: "backup"; mnemonic: string }
  | { kind: "confirm"; mnemonic: string }
  | { kind: "watch" }
  | { kind: "done"; title: string };

const ease = [0.2, 0.7, 0.2, 1] as const;

/**
 * Onboarding. Compact (popup / demo phone) is a single column; the full-page
 * dashboard splits into a brand panel with the floating asset field and a
 * centred step card. Steps animate in and out; the last one throws confetti.
 */
export function Onboarding() {
  const { surface } = useApp();
  const wide = surface === "dashboard";
  const [step, setStep] = useState<Step>({ kind: "welcome" });
  const snap = useSnapshot();
  const demo = snap?.mode === "demo";

  const view = (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={step.kind} className="flex h-full flex-col" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.32, ease }}>
        {step.kind === "welcome" && <Welcome demo={demo} onCreate={() => setStep({ kind: "password", next: "create" })} onImport={() => setStep({ kind: "password", next: "import" })} onWatch={() => setStep({ kind: "watch" })} />}
        {step.kind === "password" && (
          <CreatePassword mode={step.next} onBack={() => setStep({ kind: "welcome" })} onCreated={(mnemonic) => setStep({ kind: "backup", mnemonic })} onPasswordForImport={(password) => setStep({ kind: "import", password })} />
        )}
        {step.kind === "import" && <ImportWallet password={step.password} onBack={() => setStep({ kind: "password", next: "import" })} onDone={() => setStep({ kind: "done", title: "Wallet imported" })} />}
        {step.kind === "backup" && <Backup mnemonic={step.mnemonic} onNext={() => setStep({ kind: "confirm", mnemonic: step.mnemonic })} />}
        {step.kind === "confirm" && <ConfirmBackup mnemonic={step.mnemonic} onBack={() => setStep({ kind: "backup", mnemonic: step.mnemonic })} onDone={() => setStep({ kind: "done", title: "Wallet created" })} />}
        {step.kind === "watch" && <WatchOnly onBack={() => setStep({ kind: "welcome" })} onDone={() => setStep({ kind: "done", title: "Watching address" })} />}
        {step.kind === "done" && <Done title={step.title} />}
      </motion.div>
    </AnimatePresence>
  );

  if (!wide) {
    // Compact surfaces (popup, demo phone) keep the card clean — no field behind the copy.
    return (
      <div className="relative flex h-full flex-col overflow-hidden bg-base">
        <div className="relative z-10 min-h-0 flex-1 overflow-y-auto">{view}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden bg-base">
      <aside className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-[#040504] p-10 lg:flex">
        <FloatingField items={FRAME_FLOATING_ITEMS} count={22} seed={9} minSize={30} maxSize={124} />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_50%_50%,rgba(4,5,4,0.05),rgba(4,5,4,0.86)_75%)]" />
        <div className="relative z-10 flex items-center gap-2.5">
          <Logo size={22} className="text-accent" />
          <span className="display text-[15px] tracking-[0.18em] text-ink">{BRAND.name}</span>
        </div>
        <div className="relative z-10 max-w-[440px]">
          <h1 className="display text-[48px] leading-[0.98] tracking-[-0.035em] text-ink">{BRAND.tagline}</h1>
          <p className="mt-4 text-[17px] text-ink-2">{BRAND.subline}</p>
          <ul className="mt-8 space-y-3 text-[14px] text-ink-2">
            {["Keys are generated and encrypted on this device — never uploaded.", "Every transaction is simulated and explained before you sign.", "Stock Tokens verified by contract address, never by ticker."].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <Icon.Check size={15} className="mt-0.5 shrink-0 text-accent" /> {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 max-w-[440px] text-[11px] leading-relaxed text-ink-3">{BRAND.disclaimer}</p>
      </aside>
      <div className="flex min-w-0 flex-1 items-center justify-center overflow-y-auto p-6">
        <div className="relative h-[680px] w-full max-w-[460px] overflow-hidden rounded-[28px] border border-line bg-surface shadow-[0_40px_120px_rgba(0,0,0,0.5)]">{view}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ChoiceCard({ icon, title, body, onClick, primary }: { icon: ReactNode; title: string; body: string; onClick: () => void; primary?: boolean }) {
  return (
    <button onClick={onClick} className={cx("flex w-full items-center gap-4 rounded-[18px] border p-4 text-left transition-all hover:-translate-y-0.5", primary ? "border-accent/40 bg-accent-dim hover:border-accent/70" : "border-line bg-card hover:border-line-2")}>
      <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", primary ? "bg-accent text-base" : "bg-card-2 text-ink")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-ink-2">{body}</span>
      </span>
      <Icon.ChevronRight size={16} className="shrink-0 text-ink-3" />
    </button>
  );
}

function Welcome({ demo, onCreate, onImport, onWatch }: { demo: boolean; onCreate: () => void; onImport: () => void; onWatch: () => void }) {
  return (
    <div className="flex h-full flex-col px-7 pb-6 pt-10">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <motion.span className="flex h-16 w-16 items-center justify-center rounded-[22%] bg-accent text-base shadow-[0_20px_60px_rgba(168,255,96,0.3)]" initial={{ scale: 0.7, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ duration: 0.6, ease }}>
          <Logo size={34} />
        </motion.span>
        <h1 className="display mt-6 text-[30px] leading-[1] tracking-[-0.03em] text-ink">Welcome to {BRAND.name}</h1>
        <p className="mt-3 text-[14px] text-ink-2">{BRAND.tagline}</p>
        {demo && <p className="mt-4 rounded-full bg-accent-dim px-3 py-1 text-[11px] font-medium text-accent">Demo — the vault is real, the balances are simulated</p>}
      </div>
      <div className="space-y-2.5">
        <ChoiceCard primary icon={<Icon.Plus size={20} />} title="Create a new wallet" body="A fresh 12-word recovery phrase, encrypted on this device." onClick={onCreate} />
        <ChoiceCard icon={<Icon.Key size={19} />} title="I already have a wallet" body="Import a recovery phrase or a private key." onClick={onImport} />
        <button className="w-full py-2 text-[12px] font-medium text-ink-2 transition-colors hover:text-ink" onClick={onWatch}>
          Just watch an address instead
        </button>
      </div>
      <div className="mt-2 text-center text-[11px] text-ink-3">{BRAND.positioning}</div>
    </div>
  );
}

function Steps({ labels, active, onBack }: { labels: string[]; active: number; onBack?: () => void }) {
  return (
    <div className="flex h-9 items-center justify-between">
      {onBack ? (
        <button onClick={onBack} className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-2 hover:text-ink">
          <Icon.Back size={16} /> Back
        </button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-1.5">
        {labels.map((l, i) => (
          <span key={l} className={cx("rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em]", i === active ? "bg-accent text-base" : i < active ? "bg-card-2 text-ink" : "bg-card text-ink-3")}>
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

function CreatePassword({ mode, onBack, onCreated, onPasswordForImport }: { mode: "create" | "import"; onBack: () => void; onCreated: (mnemonic: string) => void; onPasswordForImport: (password: string) => void }) {
  const backend = useBackend();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const assessment = useMemo(() => assessPassword(password), [password]);
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = assessment.ok && confirm === password && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (mode === "import") {
      onPasswordForImport(password);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { mnemonic } = await backend.createWallet({ password });
      setPassword("");
      setConfirm("");
      onCreated(mnemonic);
    } catch (err) {
      setError(humanizeError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex h-full flex-col px-7 pb-6 pt-5">
      <Steps labels={mode === "create" ? ["Password", "Backup", "Confirm"] : ["Password", "Import"]} active={0} onBack={onBack} />
      <h2 className="display mt-7 text-[26px] leading-[1] tracking-[-0.03em] text-ink">Create a password</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">It encrypts your wallet on this device. It never leaves your browser and {BRAND.name} cannot recover it for you.</p>
      <div className="mt-6 space-y-4">
        <PasswordField label="Password" placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        {password.length > 0 && (
          <div>
            <div className="flex gap-1">
              {[1, 2, 3, 4].map((i) => (
                <span key={i} className={cx("h-1 flex-1 rounded-full transition-colors", i <= assessment.score ? (assessment.score >= 3 ? "bg-accent" : assessment.score === 2 ? "bg-warn" : "bg-loss") : "bg-line")} />
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[11px]">
              <span className={assessment.ok ? "text-ink-2" : "text-loss"}>{assessment.label}</span>
              {assessment.hints[0] && <span className="text-ink-3">{assessment.hints[0]}</span>}
            </div>
          </div>
        )}
        <PasswordField label="Confirm password" placeholder="Repeat your password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch ? "Passwords do not match." : error} />
      </div>
      <div className="flex-1" />
      <Button type="submit" variant="primary" full disabled={!canSubmit} loading={busy}>
        {mode === "create" ? "CONTINUE" : "CONTINUE"}
      </Button>
    </form>
  );
}

function Backup({ mnemonic, onNext }: { mnemonic: string; onNext: () => void }) {
  const words = mnemonic.split(" ");
  const [revealed, setRevealed] = useState(false);
  const [ack, setAck] = useState(false);
  const { copied, copy } = useCopy(60);
  const setRevealing = useAppStore((s) => s.setRevealingSecret);
  useEffect(() => {
    setRevealing(true);
    return () => setRevealing(false);
  }, [setRevealing]);

  return (
    <div className="flex h-full flex-col px-7 pb-6 pt-5">
      <Steps labels={["Password", "Backup", "Confirm"]} active={1} />
      <h2 className="display mt-7 text-[26px] leading-[1] tracking-[-0.03em] text-ink">Your recovery phrase</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">These 12 words are the only way to restore your wallet. Write them down in order and keep them offline. Anyone with them controls your funds.</p>
      <div className="relative mt-5">
        <div className={cx("grid grid-cols-3 gap-2 transition-[filter] duration-500", !revealed && "select-none blur-[7px]")}>
          {words.map((w, i) => (
            <div key={i} className="card-flat flex items-center gap-2 px-2.5 py-2 text-[13px]">
              <span className="num w-4 text-[11px] text-ink-3">{i + 1}</span>
              <span className="font-medium text-ink">{revealed ? w : "••••••"}</span>
            </div>
          ))}
        </div>
        {!revealed && (
          <button className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-[12px]" onClick={() => setRevealed(true)}>
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-base shadow-[0_10px_30px_rgba(168,255,96,0.35)]">
              <Icon.Eye size={18} />
            </span>
            <span className="text-[12px] font-semibold text-ink">Click to reveal</span>
            <span className="text-[11px] text-ink-2">Make sure nobody is watching your screen.</span>
          </button>
        )}
      </div>
      {revealed && (
        <div className="mt-3 flex items-center justify-between">
          <button className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-2 hover:text-ink" onClick={() => void copy(mnemonic)}>
            {copied ? <Icon.Check size={13} className="text-accent" /> : <Icon.Copy size={13} />} {copied ? "Copied" : "Copy phrase"}
          </button>
          <span className="text-[11px] text-ink-3">The clipboard is risky on shared devices.</span>
        </div>
      )}
      <div className="flex-1" />
      <label className="mt-4 flex cursor-pointer items-start gap-3 text-[12px] leading-relaxed text-ink-2">
        <input type="checkbox" className="mt-0.5 accent-[#A8FF60]" checked={ack} onChange={(e) => setAck(e.target.checked)} />I saved my recovery phrase and understand {BRAND.name} cannot recover it for me.
      </label>
      <Button variant="primary" full className="mt-3" disabled={!revealed || !ack} onClick={onNext}>
        CONTINUE
      </Button>
    </div>
  );
}

function ConfirmBackup({ mnemonic, onBack, onDone }: { mnemonic: string; onBack: () => void; onDone: () => void }) {
  const backend = useBackend();
  const words = useMemo(() => mnemonic.split(" "), [mnemonic]);
  const challenge = useMemo(() => {
    const idx = new Set<number>();
    const rnd = new Uint32Array(3);
    globalThis.crypto.getRandomValues(rnd);
    let i = 0;
    while (idx.size < 3) idx.add((rnd[i++ % 3]! + i) % words.length);
    return [...idx].sort((a, b) => a - b);
  }, [words]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const complete = challenge.every((i) => (answers[i] ?? "").trim().length > 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = challenge.every((i) => (answers[i] ?? "").trim().toLowerCase() === words[i]);
    if (!ok) {
      setError("One or more words do not match. Check your backup and try again.");
      return;
    }
    setBusy(true);
    try {
      await backend.confirmBackup();
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex h-full flex-col px-7 pb-6 pt-5">
      <Steps labels={["Password", "Backup", "Confirm"]} active={2} onBack={onBack} />
      <h2 className="display mt-7 text-[26px] leading-[1] tracking-[-0.03em] text-ink">Confirm your backup</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">Enter the requested words from your recovery phrase.</p>
      <div className="mt-6 space-y-3">
        {challenge.map((i) => (
          <Field key={i} label={`Word #${i + 1}`} value={answers[i] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))} autoComplete="off" spellCheck={false} autoCapitalize="none" />
        ))}
      </div>
      {error && <div className="mt-3 text-[12px] text-loss">{error}</div>}
      <div className="flex-1" />
      <Button type="submit" variant="primary" full disabled={!complete} loading={busy}>
        CONFIRM
      </Button>
    </form>
  );
}

function ImportWallet({ password, onBack, onDone }: { password: string; onBack: () => void; onDone: () => void }) {
  const backend = useBackend();
  const [tab, setTab] = useState<"phrase" | "key">("phrase");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setRevealing = useAppStore((s) => s.setRevealingSecret);
  useEffect(() => {
    setRevealing(true);
    return () => setRevealing(false);
  }, [setRevealing]);

  const valid = tab === "phrase" ? looksLikeMnemonic(value.trim().toLowerCase().split(/\s+/).join(" ")) : looksLikePrivateKey(value);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      if (tab === "phrase") await backend.importWallet({ password, mnemonic: value });
      else await backend.importWallet({ password, privateKey: value });
      setValue("");
      onDone();
    } catch (err) {
      const h = humanizeError(err);
      setError(h.technical.includes("Invalid recovery phrase") ? "This is not a valid recovery phrase. Check the words and their order." : h.technical);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex h-full flex-col px-7 pb-6 pt-5">
      <Steps labels={["Password", "Import"]} active={1} onBack={onBack} />
      <h2 className="display mt-7 text-[26px] leading-[1] tracking-[-0.03em] text-ink">Import your wallet</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">Your secret is encrypted with your password and stored only on this device. It is never sent anywhere.</p>
      <div className="mt-5 inline-flex rounded-[12px] border border-line bg-surface p-0.5">
        {(["phrase", "key"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={cx("h-9 flex-1 rounded-[10px] text-[12px] font-semibold transition-colors", tab === t ? "bg-card-2 text-ink" : "text-ink-2")}
            onClick={() => {
              setTab(t);
              setValue("");
              setError(null);
            }}
          >
            {t === "phrase" ? "Recovery phrase" : "Private key"}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {tab === "phrase" ? (
          <Field multiline rows={4} label="12 or 24 words" placeholder="word1 word2 word3 …" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="none" error={error} />
        ) : (
          <PasswordField label="Private key" placeholder="0x…" value={value} onChange={(e) => setValue(e.target.value)} error={error} />
        )}
      </div>
      <div className="flex-1" />
      <Button type="submit" variant="primary" full disabled={!valid} loading={busy}>
        IMPORT WALLET
      </Button>
    </form>
  );
}

function WatchOnly({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const backend = useBackend();
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = isValidAddress(address.trim());
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await backend.addWatchAccount({ address: address.trim() as `0x${string}`, name });
      onDone();
    } catch (err) {
      setError(humanizeError(err).technical);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex h-full flex-col px-7 pb-6 pt-5">
      <Steps labels={["Address"]} active={0} onBack={onBack} />
      <h2 className="display mt-7 text-[26px] leading-[1] tracking-[-0.03em] text-ink">Watch an address</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">See the portfolio, Stock Tokens and activity of any address on Robinhood Chain. A watch-only wallet cannot sign or send.</p>
      <div className="mt-6 space-y-4">
        <Field label="Address" placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="off" spellCheck={false} error={address && !valid ? "Enter a valid 0x address." : error} autoFocus />
        <Field label="Name (optional)" placeholder="Treasury" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex-1" />
      <Button type="submit" variant="primary" full disabled={!valid} loading={busy}>
        WATCH ADDRESS
      </Button>
    </form>
  );
}

function Done({ title }: { title: string }) {
  const backend = useBackend();
  const { surface, allowExpandedToggle } = useApp();
  const [busy, setBusy] = useState(false);
  const extensionDashboard = surface === "dashboard" && !allowExpandedToggle;
  return (
    <div className="relative flex h-full flex-col items-center justify-center px-7 pb-8 text-center">
      <Confetti />
      <motion.span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-base shadow-[0_20px_60px_rgba(168,255,96,0.35)]" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.1 }}>
        <Icon.Check size={30} />
      </motion.span>
      <div className="mt-6 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-2">{title}</div>
      <h2 className="display mt-2 text-[30px] leading-[1] tracking-[-0.03em] text-ink">You're all set.</h2>
      <p className="mt-3 max-w-[300px] text-[14px] leading-relaxed text-ink-2">Welcome to Robinhood Chain. Stock Tokens, crypto and real-world assets — one portfolio.</p>
      {extensionDashboard && (
        <div className="mt-5 flex items-center gap-3 rounded-[14px] border border-line bg-card px-4 py-3 text-left text-[12px] text-ink-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-base">
            <Icon.Layers size={15} />
          </span>
          <span>
            <span className="font-semibold text-ink">Pin {BRAND.name}</span> — open your browser's extensions menu (puzzle icon) and pin it to the toolbar for one-click access.
          </span>
        </div>
      )}
      <Button
        variant="primary"
        full
        className="mt-8 max-w-[320px]"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          await backend.updateSettings({ onboardingComplete: true });
          setBusy(false);
        }}
      >
        OPEN PORTFOLIO
      </Button>
      <Disclaimer className="mt-6 max-w-[320px]" />
    </div>
  );
}
