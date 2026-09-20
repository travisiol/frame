import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
import { BRAND } from "@frame/config";
import { FRAME_FLOATING_ITEMS, FloatingField, Icon, Logo, PctChange, TokenAvatar, cx } from "@frame/ui";

export const DEMO_URL = (import.meta.env.VITE_DEMO_URL as string | undefined) ?? "/demo/";
export const EXT_URL = BRAND.links.github;

const ease = [0.2, 0.7, 0.2, 1] as const;

function useIsDesktop() {
  const [desktop, setDesktop] = useState(() => (typeof window !== "undefined" ? window.matchMedia("(min-width: 900px)").matches : true));
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const on = () => setDesktop(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

// ---------------------------------------------------------------------------
// Nav
// ---------------------------------------------------------------------------

export function Nav() {
  return (
    <>
      <a href="#top" className="nav-corner left-5 rounded-full px-2 py-1.5">
        <Logo size={22} className="text-accent" />
        <span className="display text-[15px] tracking-[0.18em] text-ink">{BRAND.name}</span>
      </a>
      <nav className="pill-nav hidden md:flex">
        <a href="#portfolio" className="pill-nav-link">
          Portfolio
        </a>
        <a href="#move" className="pill-nav-link">
          Move money
        </a>
        <a href="#security" className="pill-nav-link">
          Security
        </a>
        <a href={DEMO_URL} className="pill-nav-link">
          Demo
        </a>
      </nav>
      <div className="nav-corner right-5">
        <a href="#get" className="pill-cta pill-cta-lime pill-cta-sm">
          Get {BRAND.name}
        </a>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

export function Hero() {
  return (
    <section id="top" className="px-4 pt-4">
      <div className="hero-card">
        <FloatingField items={FRAME_FLOATING_ITEMS} count={34} seed={17} minSize={30} maxSize={132} avoid={[{ x: 22, y: 22, w: 56, h: 60 }]} />
        <div className="hero-vignette" />
        <div className="hero-content flex min-h-[calc(100svh_-_32px)] flex-col items-center justify-center px-6 py-28 text-center">
          <motion.p className="eyebrow" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease, delay: 0.1 }}>
            Built for Robinhood Chain
          </motion.p>
          <motion.h1 className="display-xl mt-5 max-w-[13ch]" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 0.2 }}>
            The wallet for onchain markets.
          </motion.h1>
          <motion.p className="lede mt-6 max-w-[34ch]" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 0.32 }}>
            Stocks. Crypto. RWA. <span className="text-ink">One wallet.</span>
          </motion.p>
          <motion.div className="mt-9 flex flex-wrap items-center justify-center gap-3" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 0.42 }}>
            <a href="#get" className="pill-cta pill-cta-lime">
              <Icon.Layers size={18} /> Get {BRAND.name}
            </a>
            <a href={DEMO_URL} className="pill-cta pill-cta-ink">
              View demo
            </a>
          </motion.div>
          <motion.p className="mt-8 text-[12px] text-ink-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.7 }}>
            Self-custodial · Chrome, Brave, Edge · Independent — not affiliated with Robinhood
          </motion.p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Ticker
// ---------------------------------------------------------------------------

const TICKER = [
  ["NVDA", "stock-token", "$184.20", 2.41],
  ["AAPL", "stock-token", "$228.08", 1.18],
  ["TSLA", "stock-token", "$350.80", -0.72],
  ["SPY", "etf", "$571.40", 0.63],
  ["ETH", "native", "$2,642.00", 3.12],
  ["USDG", "stable", "$1.00", 0],
  ["HOOD", "stock-token", "$31.42", -0.72],
  ["QQQ", "etf", "$496.20", 0.91],
  ["META", "stock-token", "$612.33", -1.24],
  ["GLD", "etf", "$248.30", 0.55],
  ["MSFT", "stock-token", "$421.14", 0.28],
  ["cbBTC", "crypto", "$97,240", 1.64],
  ["AMZN", "stock-token", "$203.87", 0.42],
  ["SGOV", "rwa", "$100.61", 0.01],
] as const;

export function Marquee() {
  const row = [...TICKER, ...TICKER];
  return (
    <div className="marquee mt-6" aria-hidden="true">
      <div className="marquee-track">
        {row.map(([s, c, p, ch], i) => (
          <span key={i} className="tick">
            <TokenAvatar symbol={s} category={c} size={30} />
            <span className="font-semibold text-ink">{s}</span>
            <span className="num text-ink-2">{p}</span>
            <PctChange value={ch} />
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pinned feature stage (Phantom-style: sticky headline, phone cross-fades as bullets scroll)
// ---------------------------------------------------------------------------

export interface FeatureItem {
  label: string;
  body: string;
  screen: ReactNode;
  tint: "lime" | "cool" | "warm" | "plain";
}

export function PinnedFeature({ id, eyebrow, title, items, cta }: { id: string; eyebrow: string; title: ReactNode; items: FeatureItem[]; cta?: { label: string; href: string } }) {
  const desktop = useIsDesktop();
  return desktop ? <PinnedStage id={id} eyebrow={eyebrow} title={title} items={items} cta={cta} /> : <StackedFeature id={id} eyebrow={eyebrow} title={title} items={items} cta={cta} />;
}

function PinnedStage({ id, eyebrow, title, items, cta }: { id: string; eyebrow: string; title: ReactNode; items: FeatureItem[]; cta?: { label: string; href: string } }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [active, setActive] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    const i = Math.min(items.length - 1, Math.max(0, Math.floor(v * items.length)));
    setActive((prev) => (prev === i ? prev : i));
  });
  const jump = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + i * window.innerHeight + 2, behavior: "smooth" });
  };
  const item = items[active]!;
  return (
    <section id={id} ref={ref} className="stage" style={{ "--n": items.length } as React.CSSProperties}>
      <div className="stage-sticky">
        <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[1.05fr_1fr] items-center gap-16 px-6 pt-16">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 className="display-xl mt-4">{title}</h2>
            <div className="mt-10">
              {items.map((it, i) => (
                <button key={it.label} className={cx("bullet", i === active && "bullet-active")} onClick={() => jump(i)}>
                  {it.body}
                </button>
              ))}
            </div>
            {cta && (
              <a href={cta.href} className="mt-8 inline-flex items-center gap-1.5 text-[15px] font-medium text-ink-2 transition-colors hover:text-ink">
                {cta.label} <Icon.ChevronRight size={16} />
              </a>
            )}
          </div>
          <div className={cx("stage-card flex flex-col items-center px-8 py-10", `tint-${item.tint}`)}>
            <div className="phone">
              {/* Screens are absolutely positioned, so the outgoing and incoming ones cross-fade together — no blank frame while scrolling fast. */}
              <AnimatePresence initial={false}>
                <motion.div key={active} className="phone-screen" initial={{ opacity: 0, y: 26, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -16, scale: 0.985 }} transition={{ duration: 0.4, ease }}>
                  {item.screen}
                </motion.div>
              </AnimatePresence>
            </div>
            <AnimatePresence initial={false} mode="popLayout">
              <motion.div key={`l${active}`} className="mt-6 text-center" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease }}>
                <div className="display-md">{item.label}</div>
                <div className="mt-1 text-[12px] text-ink-3">
                  {active + 1} / {items.length}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

function StackedFeature({ id, eyebrow, title, items, cta }: { id: string; eyebrow: string; title: ReactNode; items: FeatureItem[]; cta?: { label: string; href: string } }) {
  return (
    <section id={id} className="px-4 py-20">
      <div className="mx-auto max-w-[520px]">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="display-xl mt-4">{title}</h2>
        <div className="mt-10 space-y-8">
          {items.map((it) => (
            <motion.div key={it.label} className={cx("stage-card flex flex-col items-center px-5 py-8", `tint-${it.tint}`)} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.25 }} transition={{ duration: 0.6, ease }}>
              <div className="phone">
                <div className="phone-screen">{it.screen}</div>
              </div>
              <div className="display-md mt-6">{it.label}</div>
              <p className="mt-2 text-center text-[15px] leading-relaxed text-ink-2">{it.body}</p>
            </motion.div>
          ))}
        </div>
        {cta && (
          <a href={cta.href} className="mt-8 inline-flex items-center gap-1.5 text-[15px] font-medium text-ink-2">
            {cta.label} <Icon.ChevronRight size={16} />
          </a>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Principles + Get started
// ---------------------------------------------------------------------------

const PRINCIPLES = [
  { icon: Icon.Key, title: "Self-custodial", body: "Your keys are generated and encrypted on your device. FRAME has no server that could ever receive them." },
  { icon: Icon.Eye, title: "See what you sign", body: "Every transaction is simulated and translated into plain English — asset changes, permissions, risks — before you approve." },
  { icon: Icon.Shield, title: "Verified, not assumed", body: "Stock Tokens are verified by contract address, never by ticker. Unknown tokens are called unknown, not safe." },
] as const;

export function Principles() {
  return (
    <section className="px-4 py-10">
      <div className="mx-auto grid max-w-[1200px] gap-4 md:grid-cols-3">
        {PRINCIPLES.map((p, i) => {
          const I = p.icon;
          return (
            <motion.div key={p.title} className="rounded-[28px] border border-line bg-card p-7" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.4 }} transition={{ duration: 0.6, ease, delay: i * 0.08 }}>
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-dim text-accent">
                <I size={20} />
              </span>
              <div className="display-md mt-5">{p.title}</div>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{p.body}</p>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

const STATS = [
  ["60", "verified Stock Tokens in the registry"],
  ["2", "networks — Robinhood Chain mainnet and testnet"],
  ["0", "keys, phrases or passwords that leave your device"],
  ["1", "wallet for stocks, crypto and RWA"],
] as const;

const BROWSERS = [
  { name: "Chrome", note: "Google Chrome 116+" },
  { name: "Brave", note: "Brave, latest" },
  { name: "Edge", note: "Microsoft Edge 116+" },
] as const;

export function GetStarted() {
  return (
    <section id="get" className="px-4 pb-16 pt-24">
      <div className="mx-auto max-w-[1200px]">
        <div className="grid gap-8 md:grid-cols-4">
          {STATS.map(([n, l], i) => (
            <motion.div key={l} initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease, delay: i * 0.08 }}>
              <div className="stat-num">{n}</div>
              <div className="mt-2 max-w-[22ch] text-[14px] leading-snug text-ink-2">{l}</div>
            </motion.div>
          ))}
        </div>

        <div className="mt-28 text-center">
          <motion.p className="eyebrow" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
            It's more than a wallet.
          </motion.p>
          <motion.h2 className="display-xl mt-4" initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7, ease }}>
            Get started.
            <br />
            Get {BRAND.name}.
          </motion.h2>
          <motion.div className="mt-9 flex flex-wrap justify-center gap-3" initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7, ease, delay: 0.1 }}>
            <a href={EXT_URL} target="_blank" rel="noreferrer" className="pill-cta pill-cta-lime">
              <Icon.Layers size={18} /> Get {BRAND.name} for desktop
            </a>
            <a href={DEMO_URL} className="pill-cta pill-cta-ink">
              Try the demo first
            </a>
          </motion.div>
        </div>

        <div className="mt-28 text-center">
          <h3 className="display-xl inline-flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <span>Download for</span>
            <span className="inline-flex h-[0.9em] w-[0.9em] items-center justify-center rounded-[22%] bg-accent text-base">
              <Logo size={40} className="h-[62%] w-[62%]" />
            </span>
            <span>desktop</span>
          </h3>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {BROWSERS.map((b, i) => (
              <motion.a key={b.name} href={EXT_URL} target="_blank" rel="noreferrer" className="browser-card text-left" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease, delay: i * 0.08 }}>
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-card-2 text-ink">
                  <Icon.Globe size={22} />
                </span>
                <div>
                  <div className="display-md">{b.name}</div>
                  <div className="mt-1 text-[13px] text-ink-2">{b.note}</div>
                </div>
                <span className="mt-auto inline-flex items-center gap-1.5 text-[14px] font-semibold text-accent">
                  Get for {b.name} <Icon.ChevronRight size={15} />
                </span>
              </motion.a>
            ))}
          </div>
          <p className="mt-6 text-[12px] text-ink-3">Not on the Web Store yet — build from source and load the unpacked extension. Instructions in the repository.</p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

export function Footer() {
  return (
    <footer className="px-4 pb-8 pt-10">
      <div className="mx-auto max-w-[1200px] overflow-hidden rounded-[32px] border border-line bg-surface px-8 pb-8 pt-10">
        <div className="grid gap-10 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <Logo size={22} className="text-accent" />
              <span className="display text-[15px] tracking-[0.18em] text-ink">{BRAND.name}</span>
            </div>
            <p className="mt-4 max-w-[36ch] text-[13px] leading-relaxed text-ink-2">{BRAND.tagline} {BRAND.positioning}</p>
          </div>
          {[
            ["Product", [["Demo", DEMO_URL], ["Extension", EXT_URL], ["Security", "#security"]]],
            ["Resources", [["Source code", BRAND.links.github], ["Architecture", `${BRAND.links.github}`], ["Support", BRAND.links.support]]],
            ["Robinhood Chain", [["Explorer", "https://robinhoodchain.blockscout.com"], ["Testnet explorer", "https://explorer.testnet.chain.robinhood.com"]]],
          ].map(([title, links]) => (
            <div key={title as string}>
              <div className="label">{title as string}</div>
              <ul className="mt-3 space-y-2 text-[14px]">
                {(links as [string, string][]).map(([l, h]) => (
                  <li key={l}>
                    <a href={h} className="text-ink-2 transition-colors hover:text-ink" target={h.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="big-wordmark mt-12 text-center">{BRAND.name}</div>
        <p className="mt-6 max-w-[760px] text-[12px] leading-relaxed text-ink-3">{BRAND.disclaimer} Stock Tokens provide tokenized exposure to the referenced asset; holding one is not ownership of the underlying equity. Figures shown in illustrations are examples, not live quotes.</p>
      </div>
    </footer>
  );
}
