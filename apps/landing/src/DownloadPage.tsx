import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { BRAND } from "@frame/config";
import { Icon, Logo, cx, useCopy } from "@frame/ui";
import { APP_URL, BROWSERS, Footer, Nav, ease } from "./Sections";

/** Written by scripts/build-web.mjs next to the packaged extension. */
interface Latest {
  name: string;
  version: string;
  file: string;
  bytes: number;
  sha256: string;
  builtAt: string;
  minChrome: number;
}

type BrowserKey = (typeof BROWSERS)[number]["key"];

const EXTENSIONS_PAGE: Record<BrowserKey, string> = { chrome: "chrome://extensions", brave: "brave://extensions", edge: "edge://extensions" };
const FALLBACK_FILE = `/downloads/${BRAND.name.toLowerCase()}-${BRAND.version}-extension.zip`;

function detectBrowser(): BrowserKey {
  if (typeof navigator === "undefined") return "chrome";
  if ((navigator as Navigator & { brave?: unknown }).brave) return "brave";
  if (/Edg\//.test(navigator.userAgent)) return "edge";
  return "chrome";
}

function initialBrowser(): BrowserKey {
  const q = new URLSearchParams(window.location.search).get("for");
  return q === "brave" || q === "edge" || q === "chrome" ? q : detectBrowser();
}

function formatBytes(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.round(n / 1000)} KB`;
}

export function DownloadPage() {
  const [latest, setLatest] = useState<Latest | null>(null);
  const [browser, setBrowser] = useState<BrowserKey>(initialBrowser);
  const [downloaded, setDownloaded] = useState(false);
  const { copied, copy } = useCopy();

  useEffect(() => {
    fetch("/downloads/latest.json", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Latest>) : Promise.reject(new Error(String(r.status)))))
      .then(setLatest)
      .catch(() => setLatest(null));
  }, []);

  const file = latest?.file ?? FALLBACK_FILE;
  const fileName = file.split("/").pop() ?? file;
  const folderName = fileName.replace(/\.zip$/, "");
  const version = latest?.version ?? BRAND.version;
  const current = BROWSERS.find((b) => b.key === browser)!;
  const extensionsPage = EXTENSIONS_PAGE[browser];

  const STEPS: { title: string; body: string; art: ReactNode }[] = [
    {
      title: "Unzip the file",
      body: `Double-click ${fileName} — it unpacks into a folder of the same name. Keep that folder somewhere permanent: the browser reads the extension from it.`,
      art: <ArtUnzip name={folderName} />,
    },
    {
      title: "Turn on Developer mode",
      body: `Open ${extensionsPage} in ${current.name} (paste it in the address bar) and switch on “Developer mode” in the top right corner.`,
      art: <ArtDeveloperMode page={extensionsPage} />,
    },
    {
      title: "Load unpacked",
      body: `Click “Load unpacked” and pick the folder you just unzipped. ${BRAND.name} appears in the list, enabled.`,
      art: <ArtLoadUnpacked page={extensionsPage} />,
    },
    {
      title: "Pin it and create your wallet",
      body: `Open the extensions menu (puzzle icon) and pin ${BRAND.name}. The first click opens onboarding: create a new wallet, or import one you already have.`,
      art: <ArtPin />,
    },
  ];

  return (
    <div className="min-h-screen bg-base text-ink">
      <Nav />
      <main className="px-4 pt-32">
        <section className="mx-auto max-w-[1200px] text-center">
          <motion.p className="eyebrow" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>
            Version {version} · Chrome, Brave, Edge
          </motion.p>
          <motion.h1 className="display-xl mt-5 inline-flex flex-wrap items-center justify-center gap-x-5 gap-y-2" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease, delay: 0.08 }}>
            <span>Download for</span>
            <span className="inline-flex h-[0.9em] w-[0.9em] items-center justify-center rounded-[22%] bg-accent text-base">
              <Logo size={40} className="h-[62%] w-[62%]" />
            </span>
            <span>desktop</span>
          </motion.h1>
          <motion.p className="lede mx-auto mt-6 max-w-[46ch]" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease, delay: 0.16 }}>
            Self-custodial. Your keys are generated and encrypted on your device and never leave it. {BRAND.name} is independent and not affiliated with Robinhood.
          </motion.p>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {BROWSERS.map((b, i) => {
              const active = b.key === browser;
              return (
                <motion.a
                  key={b.key}
                  href={file}
                  download
                  onClick={() => {
                    setBrowser(b.key);
                    setDownloaded(true);
                  }}
                  className={cx("browser-card text-left", active && "border-accent/60")}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease, delay: 0.2 + i * 0.08 }}
                >
                  <span className={cx("flex h-12 w-12 items-center justify-center rounded-full", active ? "bg-accent text-base" : "bg-card-2 text-ink")}>
                    <Icon.Globe size={22} />
                  </span>
                  <div>
                    <div className="display-md">{b.name}</div>
                    <div className="mt-1 text-[13px] text-ink-2">{b.note}</div>
                  </div>
                  <span className="mt-auto inline-flex items-center gap-1.5 text-[14px] font-semibold text-accent">
                    <Icon.ChevronDown size={16} /> Download for {b.name}
                  </span>
                </motion.a>
              );
            })}
          </div>
          <p className="mt-5 text-[12px] text-ink-3">
            {latest ? `${fileName} · ${formatBytes(latest.bytes)} · built ${new Date(latest.builtAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}.` : "Direct download of the packaged extension."} The same file works in all three browsers.
          </p>
        </section>

        <section id="install" className="mx-auto mt-28 max-w-[1200px]">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="eyebrow">{downloaded ? "Downloaded? Now install it." : "Install in a minute"}</p>
              <h2 className="display-lg mt-3">
                Four steps in {current.name}.
                <br />
                No account, no store.
              </h2>
            </div>
            <div className="inline-flex rounded-full border border-line bg-card p-1">
              {BROWSERS.map((b) => (
                <button key={b.key} onClick={() => setBrowser(b.key)} className={cx("rounded-full px-4 py-2 text-[13px] font-semibold transition-colors", b.key === browser ? "bg-accent text-base" : "text-ink-2 hover:text-ink")}>
                  {b.name}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {STEPS.map((s, i) => (
              <motion.div key={s.title} className="rounded-[28px] border border-line bg-card p-7" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.6, ease, delay: (i % 2) * 0.08 }}>
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-[14px] font-bold text-base">{i + 1}</span>
                  <div className="display-md">{s.title}</div>
                </div>
                <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-ink-2">{s.body}</p>
                <div className="mt-6">{s.art}</div>
              </motion.div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[20px] border border-line bg-surface px-5 py-4 text-[13px] text-ink-2">
            <span className="mono rounded-[8px] bg-card-2 px-2.5 py-1 text-ink">{extensionsPage}</span>
            <button className="inline-flex items-center gap-1.5 font-semibold text-ink hover:text-accent" onClick={() => void copy(extensionsPage)}>
              {copied ? <Icon.Check size={14} /> : <Icon.Copy size={14} />} {copied ? "Copied" : "Copy address"}
            </button>
            <span className="text-ink-3">Browsers block links to their own settings pages, so paste it into the address bar.</span>
          </div>
        </section>

        <section className="mx-auto mt-24 grid max-w-[1200px] gap-4 md:grid-cols-[1.3fr_1fr]">
          <div className="rounded-[28px] border border-line bg-card p-7">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-dim text-accent">
                <Icon.Shield size={18} />
              </span>
              <div className="display-md">Verify what you downloaded</div>
            </div>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">Every published build carries its SHA-256 checksum. If the hash of your file matches, you have the exact build published here.</p>
            <div className="mt-5 rounded-[14px] border border-line bg-surface p-4">
              <div className="label">SHA-256 · {fileName}</div>
              <div className="mono mt-2 break-all text-[12px] leading-relaxed text-ink">{latest?.sha256 ?? "Checksum unavailable — the build manifest could not be loaded."}</div>
              {latest && (
                <button className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-2 hover:text-ink" onClick={() => void copy(latest.sha256)}>
                  {copied ? <Icon.Check size={13} /> : <Icon.Copy size={13} />} Copy checksum
                </button>
              )}
            </div>
            <div className="mt-4 grid gap-2 text-[12px] text-ink-3 md:grid-cols-2">
              <div>
                <div className="label">macOS / Linux</div>
                <code className="mono mt-1 block text-ink-2">shasum -a 256 {fileName}</code>
              </div>
              <div>
                <div className="label">Windows (PowerShell)</div>
                <code className="mono mt-1 block text-ink-2">Get-FileHash {fileName}</code>
              </div>
            </div>
          </div>
          <a href={APP_URL} className="group flex flex-col rounded-[28px] border border-line bg-card p-7 transition-colors hover:border-line-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-card-2 text-ink">
              <Icon.Expand size={18} />
            </span>
            <div className="display-md mt-5">Prefer no install?</div>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">The web app is the same wallet in a browser tab: same encrypted vault, same Robinhood Chain, same swaps and bridges. Your keys stay in this browser's storage.</p>
            <span className="mt-auto inline-flex items-center gap-1.5 pt-6 text-[14px] font-semibold text-accent">
              Open the web app <Icon.ChevronRight size={15} />
            </span>
          </a>
        </section>

        <section className="mx-auto mt-16 max-w-[760px] text-center text-[12px] leading-relaxed text-ink-3">
          {BRAND.name} is not on the Chrome Web Store yet. Loading an unpacked extension is a standard browser feature; the browser may remind you about it on start-up. Only install {BRAND.name} from {BRAND.links.website.replace(/^https?:\/\//, "")}.
        </section>
      </main>
      <div className="mt-16">
        <Footer />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step illustrations — CSS only, no assets.
// ---------------------------------------------------------------------------

function Frame({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-line bg-base">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-card-2" />
        <span className="h-2.5 w-2.5 rounded-full bg-card-2" />
        <span className="h-2.5 w-2.5 rounded-full bg-card-2" />
        {title && <span className="mono ml-3 text-[11px] text-ink-3">{title}</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ArtUnzip({ name }: { name: string }) {
  return (
    <Frame title="Downloads">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-[12px] border border-line bg-card px-3 py-2">
          <Icon.Layers size={16} className="text-ink-2" />
          <span className="mono text-[12px] text-ink">{name}.zip</span>
        </div>
        <Icon.ChevronRight size={16} className="text-ink-3" />
        <div className="flex items-center gap-2 rounded-[12px] border border-accent/50 bg-accent-dim px-3 py-2">
          <span className="h-4 w-5 rounded-[3px] bg-accent" />
          <span className="mono text-[12px] text-ink">{name}/</span>
        </div>
      </div>
    </Frame>
  );
}

function ArtDeveloperMode({ page }: { page: string }) {
  return (
    <Frame title={page}>
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-semibold text-ink">Extensions</span>
        <span className="flex items-center gap-2 text-[12px] text-ink-2">
          Developer mode
          <span className="relative inline-flex h-5 w-9 items-center rounded-full bg-accent">
            <span className="absolute right-0.5 h-4 w-4 rounded-full bg-base" />
          </span>
        </span>
      </div>
      <div className="mt-3 h-8 rounded-[8px] bg-card" />
    </Frame>
  );
}

function ArtLoadUnpacked({ page }: { page: string }) {
  return (
    <Frame title={page}>
      <div className="flex flex-wrap gap-2 text-[12px] font-semibold">
        <span className="rounded-full bg-accent px-3 py-1.5 text-base">Load unpacked</span>
        <span className="rounded-full border border-line px-3 py-1.5 text-ink-2">Pack extension</span>
        <span className="rounded-full border border-line px-3 py-1.5 text-ink-2">Update</span>
      </div>
      <div className="mt-3 flex items-center gap-3 rounded-[12px] border border-line bg-card px-3 py-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-[22%] bg-accent text-base">
          <Logo size={14} />
        </span>
        <span className="text-[13px] font-semibold text-ink">{BRAND.name}</span>
        <span className="ml-auto text-[11px] text-ink-3">{BRAND.version}</span>
        <span className="relative inline-flex h-4 w-7 items-center rounded-full bg-accent">
          <span className="absolute right-0.5 h-3 w-3 rounded-full bg-base" />
        </span>
      </div>
    </Frame>
  );
}

function ArtPin() {
  return (
    <Frame>
      <div className="flex items-center gap-2 rounded-[10px] bg-card px-3 py-2">
        <span className="h-6 flex-1 rounded-full bg-card-2" />
        <span className="flex h-7 w-7 items-center justify-center rounded-[22%] bg-accent text-base shadow-[0_6px_20px_rgba(168,255,96,0.35)]">
          <Logo size={14} />
        </span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-card-2 text-ink-2">
          <Icon.Dots size={14} />
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[12px] text-ink-2">
        <Icon.Check size={14} className="text-accent" /> Pinned. One click opens {BRAND.name}.
      </div>
    </Frame>
  );
}
