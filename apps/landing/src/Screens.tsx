import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useInView } from "framer-motion";
import { BRAND } from "@frame/config";
import { formatUsd } from "@frame/chain";
import { Icon, Logo, PctChange, TokenAvatar, cx } from "@frame/ui";

/**
 * Animated wallet screens shown inside the phone mockups. They are built
 * from the same design system as the real app — no videos, no images — and
 * loop forever with framer-motion keyframes. Every figure is illustrative.
 */

export function Phone({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("phone", className)}>
      <div className="phone-screen">{children}</div>
    </div>
  );
}

const loop = (duration: number, delay = 0, repeatDelay = 1.6) => ({ duration, repeat: Infinity, repeatDelay, ease: "easeInOut" as const, delay });

function CountUp({ to, from = 0, format = (v: number) => formatUsd(v), duration = 1.6, className }: { to: number; from?: number; format?: (v: number) => string; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { amount: 0.6 });
  const [text, setText] = useState(format(from));
  useEffect(() => {
    if (!inView) return;
    const controls = animate(from, to, { duration, ease: [0.2, 0.7, 0.2, 1], onUpdate: (v) => setText(format(v)) });
    return () => controls.stop();
  }, [inView, from, to, duration, format]);
  return (
    <span ref={ref} className={cx("num", className)}>
      {text}
    </span>
  );
}

function TopBar({ title, right }: { title?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Logo size={16} className="text-accent" />
        <span className="display text-[12px] tracking-[0.18em] text-ink">{title ?? BRAND.name}</span>
      </div>
      {right ?? <span className="pill pill-muted">Robinhood Chain</span>}
    </div>
  );
}

function Btn({ children, tone = "lime", className }: { children: ReactNode; tone?: "lime" | "ink"; className?: string }) {
  return <span className={cx("screen-btn", tone === "lime" ? "bg-accent text-base" : "bg-card-2 text-ink", className)}>{children}</span>;
}

function AssetLine({ symbol, name, category, balance, value, change, delay = 0 }: { symbol: string; name: string; category: string; balance: string; value: string; change: number; delay?: number }) {
  return (
    <motion.div className="flex items-center gap-3 py-2" initial={{ opacity: 0, x: 12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: false, amount: 0.5 }} transition={{ delay, duration: 0.5 }}>
      <TokenAvatar symbol={symbol} category={category} size={32} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink">{name}</div>
        <div className="text-[11px] text-ink-2">{balance}</div>
      </div>
      <div className="text-right">
        <div className="num text-[13px] font-medium text-ink">{value}</div>
        <PctChange value={change} />
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------

export function PortfolioScreen() {
  return (
    <>
      <TopBar />
      <div className="label">Portfolio value</div>
      <div className="screen-title mt-1.5">
        <CountUp from={17_910} to={18_420.52} />
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[12px]">
        <span className="num text-accent">+$438.21 today</span>
        <PctChange value={2.44} />
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {[
          ["Send", Icon.Send],
          ["Swap", Icon.Swap],
          ["Receive", Icon.Receive],
          ["Bridge", Icon.Bridge],
        ].map(([label, I], i) => {
          const IconC = I as typeof Icon.Send;
          return (
            <motion.div key={label as string} className="flex flex-col items-center gap-1.5 rounded-[12px] border border-line bg-card py-2.5" initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: false }} transition={{ delay: 0.15 + i * 0.06 }}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-card-2 text-ink">
                <IconC size={14} />
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink">{label as string}</span>
            </motion.div>
          );
        })}
      </div>
      <div className="mt-4 flex h-2 w-full overflow-hidden rounded-full bg-card-2">
        {[
          ["46.5%", "#A8FF60"],
          ["36.5%", "#F4F6F4"],
          ["17%", "#5F6760"],
        ].map(([w, c], i) => (
          <motion.div key={c} style={{ background: c }} initial={{ width: 0 }} whileInView={{ width: w }} viewport={{ once: false }} transition={{ duration: 0.9, delay: 0.2 + i * 0.1, ease: [0.2, 0.7, 0.2, 1] }} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-ink-2">
        <span>Stock Tokens 46.5%</span>
        <span>Crypto 36.5%</span>
        <span>Stables 17%</span>
      </div>
      <div className="mt-3 divide-y divide-line">
        <AssetLine symbol="NVDA" name="NVDA Stock Token" category="stock-token" balance="26.17 NVDA" value="$4,820.40" change={2.41} delay={0.3} />
        <AssetLine symbol="ETH" name="Ether" category="native" balance="2.0 ETH" value="$5,284.00" change={3.12} delay={0.38} />
        <AssetLine symbol="USDG" name="Global Dollar" category="stable" balance="3,128 USDG" value="$3,128.00" change={0} delay={0.46} />
        <AssetLine symbol="AAPL" name="AAPL Stock Token" category="stock-token" balance="7.2 AAPL" value="$1,642.20" change={1.18} delay={0.54} />
      </div>
    </>
  );
}

export function MarketsScreen() {
  const query = "NVDA";
  return (
    <>
      <TopBar title="Markets" right={<span className="pill pill-accent">60 verified</span>} />
      <div className="flex h-11 items-center gap-2 rounded-[12px] border border-line bg-surface px-3 text-[13px]">
        <Icon.Search size={15} className="text-ink-3" />
        <span className="text-ink">
          {query.split("").map((ch, i) => (
            <motion.span key={i} animate={{ opacity: [0, 0, 1, 1, 1, 0] }} transition={{ duration: 7, times: [0, 0.05 + i * 0.05, 0.08 + i * 0.05, 0.9, 0.95, 1], repeat: Infinity }}>
              {ch}
            </motion.span>
          ))}
        </span>
        <motion.span className="h-4 w-[2px] bg-accent" animate={{ opacity: [1, 0, 1] }} transition={{ duration: 0.9, repeat: Infinity }} />
      </div>
      <motion.div className="mt-3 space-y-2" animate={{ opacity: [0, 0, 1, 1, 0], y: [8, 8, 0, 0, 8] }} transition={{ duration: 7, times: [0, 0.3, 0.4, 0.92, 1], repeat: Infinity }}>
        <div className="flex items-center gap-3 rounded-[14px] border border-accent/30 bg-accent-dim px-3 py-2.5">
          <TokenAvatar symbol="NVDA" category="stock-token" size={32} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              NVDA <span className="pill pill-accent">Verified</span>
            </div>
            <div className="text-[11px] text-ink-2">NVIDIA · Tokenized NVDA exposure</div>
          </div>
          <div className="text-right">
            <div className="num text-[13px] font-medium text-ink">$184.20</div>
            <PctChange value={2.41} />
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-[14px] border border-warn/30 bg-warn-dim px-3 py-2.5">
          <TokenAvatar symbol="NVDA" category="unknown" size={32} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              NVDA <span className="pill pill-warn">Unverified</span>
            </div>
            <div className="mono text-[10px] text-ink-2">0x3f9c…a71e · not in the registry</div>
          </div>
        </div>
      </motion.div>
      <div className="mt-4 label">Watchlist</div>
      <div className="mt-1 divide-y divide-line">
        <AssetLine symbol="AAPL" name="AAPL Stock Token" category="stock-token" balance="Apple" value="$228.08" change={1.18} delay={0.2} />
        <AssetLine symbol="SPY" name="SPY Stock Token" category="etf" balance="SPDR S&P 500" value="$571.40" change={0.63} delay={0.28} />
        <AssetLine symbol="TSLA" name="TSLA Stock Token" category="stock-token" balance="Tesla" value="$350.80" change={-0.72} delay={0.36} />
      </div>
    </>
  );
}

export function AssetScreen() {
  const d = "M2,52 C14,50 20,40 30,42 S48,58 60,44 S78,20 92,26 S110,44 124,30 S142,8 158,14 S180,30 196,18";
  return (
    <>
      <TopBar title="NVDA" right={<span className="pill pill-accent">Market open</span>} />
      <div className="text-[12px] text-ink-2">NVDA Stock Token · Tokenized NVDA exposure</div>
      <div className="screen-title mt-2">
        <CountUp from={181.4} to={184.2} format={(v) => formatUsd(v)} />
      </div>
      <div className="mt-1 flex items-center gap-2 text-[12px]">
        <span className="text-ink-2">24H</span>
        <PctChange value={2.42} />
      </div>
      <div className="mt-3 rounded-[16px] border border-line bg-card p-3">
        <svg viewBox="0 0 200 60" className="h-[110px] w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="asset-g" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#A8FF60" stopOpacity="0.25" />
              <stop offset="1" stopColor="#A8FF60" stopOpacity="0" />
            </linearGradient>
          </defs>
          <motion.path d={`${d} L196,60 L2,60 Z`} fill="url(#asset-g)" animate={{ opacity: [0, 0, 1, 1, 0] }} transition={{ duration: 6, times: [0, 0.35, 0.5, 0.9, 1], repeat: Infinity }} />
          <motion.path d={d} fill="none" stroke="#A8FF60" strokeWidth={2} strokeLinecap="round" animate={{ pathLength: [0, 1, 1, 1], opacity: [1, 1, 1, 0] }} transition={{ duration: 6, times: [0, 0.45, 0.9, 1], repeat: Infinity, ease: "easeInOut" }} />
        </svg>
        <div className="mt-1 flex gap-1">
          {["1H", "1D", "1W", "1M", "1Y"].map((r, i) => (
            <span key={r} className={cx("tab", i === 1 && "tab-active")}>
              {r}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Btn>BUY / SWAP</Btn>
        <Btn tone="ink">SEND</Btn>
        <Btn tone="ink">RECEIVE</Btn>
      </div>
      <div className="mt-3 rounded-[14px] border border-line bg-card px-3 py-2 text-[12px]">
        <div className="flex justify-between py-1">
          <span className="text-ink-2">Your balance</span>
          <span className="num text-ink">26.17 NVDA</span>
        </div>
        <div className="flex justify-between py-1">
          <span className="text-ink-2">Current value</span>
          <span className="num text-ink">$4,820.51</span>
        </div>
        <div className="flex justify-between py-1">
          <span className="text-ink-2">Average entry</span>
          <span className="text-ink-3">Cost basis unavailable</span>
        </div>
      </div>
    </>
  );
}

export function SendScreen() {
  return (
    <>
      <TopBar title="Send" />
      <div className="label">Recipient</div>
      <div className="mt-2 flex h-11 items-center gap-2 rounded-[12px] border border-line bg-surface px-3 text-[12px]">
        <span className="mono truncate text-ink">0x7099…dc79C8</span>
        <motion.span className="ml-auto text-accent" animate={{ opacity: [0, 0, 1, 1, 1, 0], scale: [0.5, 0.5, 1, 1, 1, 0.5] }} transition={{ duration: 7, times: [0, 0.12, 0.2, 0.9, 0.95, 1], repeat: Infinity }}>
          <Icon.Check size={16} />
        </motion.span>
      </div>
      <motion.div className="mt-1 text-[11px] text-ink-2" animate={{ opacity: [0, 0, 1, 1, 0] }} transition={{ duration: 7, times: [0, 0.2, 0.28, 0.92, 1], repeat: Infinity }}>
        Treasury · checksum valid · not a contract
      </motion.div>
      <div className="mt-4 label">Amount</div>
      <div className="mt-2 flex items-center gap-3 rounded-[16px] border border-line bg-card px-4 py-3">
        <TokenAvatar symbol="USDG" category="stable" size={32} />
        <span className="screen-title flex-1">25</span>
        <span className="text-[13px] font-semibold text-ink-2">USDG</span>
      </div>
      <motion.div className="mt-4 rounded-[16px] border border-line bg-card p-3" animate={{ opacity: [0, 0, 1, 1, 1, 0], y: [30, 30, 0, 0, 0, 30] }} transition={{ duration: 7, times: [0, 0.32, 0.42, 0.7, 0.9, 1], repeat: Infinity }}>
        <div className="flex items-start justify-between">
          <div>
            <div className="label">You are about to</div>
            <div className="mt-1 text-[16px] font-semibold text-ink">Send 25 USDG</div>
          </div>
          <span className="pill pill-accent">Low risk</span>
        </div>
        <div className="mt-2 flex justify-between text-[12px]">
          <span className="text-ink-2">Network fee</span>
          <span className="num text-ink">~$0.02</span>
        </div>
        <div className="mt-1 flex justify-between text-[12px]">
          <span className="text-ink-2">Simulation</span>
          <span className="text-accent">Successful</span>
        </div>
      </motion.div>
      <div className="mt-auto">
        <motion.div animate={{ scale: [1, 1, 1, 0.97, 1, 1] }} transition={{ duration: 7, times: [0, 0.68, 0.72, 0.74, 0.78, 1], repeat: Infinity }}>
          <Btn className="w-full">CONFIRM SEND</Btn>
        </motion.div>
      </div>
      <motion.div className="absolute inset-0 flex flex-col items-center justify-center bg-base/90" animate={{ opacity: [0, 0, 1, 1, 0] }} transition={{ duration: 7, times: [0, 0.76, 0.8, 0.93, 1], repeat: Infinity }}>
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-base">
          <Icon.Check size={26} />
        </span>
        <div className="display mt-3 text-[20px] text-ink">SENT</div>
        <div className="text-[12px] text-ink-2">25 USDG to Treasury</div>
      </motion.div>
    </>
  );
}

export function SwapScreen() {
  return (
    <>
      <TopBar title="Swap" />
      <div className="rounded-[16px] border border-line bg-card px-4 py-3">
        <div className="flex justify-between text-[10px] uppercase tracking-[0.12em] text-ink-2">
          <span>You pay</span>
          <span>Balance 3,128</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="screen-title flex-1">100</span>
          <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface py-1 pl-1 pr-2.5 text-[12px] font-semibold">
            <TokenAvatar symbol="USDG" category="stable" size={20} /> USDG
          </span>
        </div>
      </div>
      <div className="my-1 flex justify-center text-ink-3">
        <Icon.Receive size={16} />
      </div>
      <div className="rounded-[16px] border border-line bg-card px-4 py-3">
        <div className="text-[10px] uppercase tracking-[0.12em] text-ink-2">You receive</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="screen-title flex-1">
            <CountUp from={0.5} to={0.5413} duration={1.2} format={(v) => `~${v.toFixed(4)}`} />
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface py-1 pl-1 pr-2.5 text-[12px] font-semibold">
            <TokenAvatar symbol="NVDA" category="stock-token" size={20} /> NVDA
          </span>
        </div>
      </div>
      <div className="mt-3 label">Routes</div>
      <div className="mt-2 space-y-2">
        {[
          ["Router B", "0.5413 NVDA", "Fee $0.09", true],
          ["Router A", "0.5398 NVDA", "Fee $0.14", false],
        ].map(([name, out, fee, best]) => (
          <motion.div
            key={name as string}
            className={cx("flex items-center justify-between rounded-[14px] border px-3 py-2.5 text-[12px]", best ? "border-accent/40 bg-accent-dim" : "border-line bg-card")}
            animate={best ? { scale: [1, 1.02, 1] } : {}}
            transition={loop(2.4, 0.4, 2)}
          >
            <span className="flex items-center gap-2 text-ink">
              {name as string}
              {best && <span className="pill pill-accent">Best price</span>}
            </span>
            <span className="text-right">
              <span className="num block text-ink">{out as string}</span>
              <span className="text-[10px] text-ink-3">{fee as string}</span>
            </span>
          </motion.div>
        ))}
      </div>
      <div className="mt-auto">
        <div className="mb-2 flex gap-1.5">
          <motion.div className="h-1 flex-1 rounded-full bg-accent" />
          <motion.div className="h-1 flex-1 rounded-full bg-line" animate={{ backgroundColor: ["#252A25", "#252A25", "#A8FF60", "#A8FF60", "#252A25"] }} transition={{ duration: 6, times: [0, 0.4, 0.55, 0.9, 1], repeat: Infinity }} />
        </div>
        <Btn className="w-full">REVIEW · 2 STEPS</Btn>
        <div className="mt-1.5 text-center text-[10px] text-ink-3">Step 1: exact 100 USDG permission · Step 2: swap</div>
      </div>
    </>
  );
}

export function BridgeScreen() {
  return (
    <>
      <TopBar title="Move to Robinhood Chain" />
      <div className="rounded-[16px] border border-line bg-card px-4 py-3">
        <div className="text-[10px] uppercase tracking-[0.12em] text-ink-2">From · Ethereum</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="screen-title flex-1">1.00</span>
          <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface py-1 pl-1 pr-2.5 text-[12px] font-semibold">
            <TokenAvatar symbol="ETH" category="native" size={20} /> ETH
          </span>
        </div>
      </div>
      <div className="relative my-2 flex h-10 items-center justify-center">
        <div className="absolute inset-x-8 top-1/2 h-px bg-line" />
        <motion.span className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_16px_#A8FF60]" animate={{ left: ["8%", "88%"], opacity: [0, 1, 1, 0] }} transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut", times: [0, 0.1, 0.9, 1] }} />
        <span className="relative rounded-full border border-line bg-surface px-3 py-1 text-[11px] text-ink-2">~45 sec</span>
      </div>
      <div className="rounded-[16px] border border-accent/30 bg-accent-dim px-4 py-3">
        <div className="text-[10px] uppercase tracking-[0.12em] text-ink-2">To · Robinhood Chain</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="screen-title flex-1">
            <CountUp from={0} to={0.9987} duration={1.4} format={(v) => v.toFixed(4)} />
          </span>
          <span className="text-[13px] font-semibold text-ink-2">ETH</span>
        </div>
      </div>
      <div className="mt-3 rounded-[14px] border border-line bg-card px-3 py-2 text-[12px]">
        {[
          ["Best route", "Fast Bridge"],
          ["Fee", "$3.12"],
          ["Estimated time", "~45 sec"],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between py-1">
            <span className="text-ink-2">{k}</span>
            <span className="num text-ink">{v}</span>
          </div>
        ))}
      </div>
      <div className="mt-auto">
        <Btn className="w-full">MOVE FUNDS</Btn>
      </div>
    </>
  );
}

export function ReviewScreen() {
  return (
    <>
      <TopBar title="example.xyz" right={<span className="pill pill-muted">Secure</span>} />
      <div className="rounded-[16px] border border-line bg-card p-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="label">This app wants to</div>
            <div className="mt-1 text-[17px] font-semibold leading-tight text-ink">Swap 500 USDG for ≥ 2.71 NVDA</div>
          </div>
          <span className="pill pill-accent">Low risk</span>
        </div>
        <div className="mt-2 text-[11px] text-ink-2">Using Example Router · Robinhood Chain</div>
      </div>
      <div className="mt-2 rounded-[16px] border border-line bg-card p-3 text-[12px]">
        <div className="label">Expected changes</div>
        {[
          ["Send", "−500 USDG", "text-ink"],
          ["Receive", "+~2.71 NVDA", "text-accent"],
          ["Network fee", "−$0.03", "text-ink-2"],
        ].map(([k, v, c], i) => (
          <motion.div key={k} className="flex justify-between py-1" initial={{ opacity: 0, x: 8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: false }} transition={{ delay: 0.2 + i * 0.1 }}>
            <span className="text-ink-2">{k}</span>
            <span className={cx("num font-medium", c)}>{v}</span>
          </motion.div>
        ))}
      </div>
      <motion.div className="mt-2 rounded-[16px] border border-line bg-surface p-3 text-[12px]" animate={{ borderColor: ["#252A25", "#252A25", "#A8FF60", "#A8FF60", "#252A25"] }} transition={{ duration: 5, times: [0, 0.3, 0.4, 0.8, 1], repeat: Infinity }}>
        <div className="flex items-center justify-between">
          <span className="text-ink">Temporary 500 USDG approval</span>
          <span className="pill pill-muted">Exact</span>
        </div>
        <div className="mt-1 text-[11px] text-ink-3">Not unlimited. You can edit the amount before signing.</div>
      </motion.div>
      <div className="mt-auto grid grid-cols-2 gap-2">
        <Btn tone="ink">CANCEL</Btn>
        <Btn>CONFIRM</Btn>
      </div>
    </>
  );
}

export function ApprovalsScreen() {
  return (
    <>
      <TopBar title="Token approvals" right={<span className="pill pill-loss">1 high risk</span>} />
      <motion.div className="overflow-hidden" animate={{ height: ["auto", "auto", 0, 0, "auto"], opacity: [1, 1, 0, 0, 1] }} transition={{ duration: 7, times: [0, 0.5, 0.62, 0.9, 1], repeat: Infinity }}>
        <div className="mb-2 rounded-[16px] border border-loss/30 bg-card p-3">
          <div className="flex items-center gap-2">
            <TokenAvatar symbol="USDG" category="stable" size={28} />
            <span className="text-[13px] font-semibold text-ink">Global Dollar</span>
            <span className="pill pill-loss">High risk</span>
          </div>
          <div className="mt-1.5 text-[11px] text-ink-2">Spender: Unknown contract · 0x8a1e…44c2</div>
          <div className="mt-1 text-[12px]">
            Allowance: <span className="font-semibold text-loss">Unlimited</span>
          </div>
          <motion.div className="mt-2" animate={{ scale: [1, 1, 0.96, 1, 1] }} transition={{ duration: 7, times: [0, 0.42, 0.45, 0.48, 1], repeat: Infinity }}>
            <span className="screen-btn h-9 w-full bg-loss-dim text-[12px] text-loss">REVOKE</span>
          </motion.div>
        </div>
      </motion.div>
      <div className="rounded-[16px] border border-line bg-card p-3">
        <div className="flex items-center gap-2">
          <TokenAvatar symbol="NVDA" category="stock-token" size={28} />
          <span className="text-[13px] font-semibold text-ink">NVDA Stock Token</span>
          <span className="pill pill-accent">Low risk</span>
        </div>
        <div className="mt-1.5 text-[11px] text-ink-2">Spender: Example Router · 0x7eD5…EC7e</div>
        <div className="mt-1 text-[12px]">
          Allowance: <span className="num font-semibold text-ink">500 NVDA</span>
        </div>
      </div>
      <motion.div className="mt-3 rounded-[12px] border border-accent/30 bg-accent-dim px-3 py-2 text-[11px] text-accent" animate={{ opacity: [0, 0, 1, 1, 0] }} transition={{ duration: 7, times: [0, 0.6, 0.68, 0.92, 1], repeat: Infinity }}>
        Revoke submitted · unlimited permission removed
      </motion.div>
      <div className="mt-auto text-[10px] leading-relaxed text-ink-3">Revoking sets the permission to zero with a small onchain transaction.</div>
    </>
  );
}

export function LockScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <Logo size={36} className="text-accent" />
      <div className="display mt-3 text-[20px] tracking-[0.18em] text-ink">{BRAND.name}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-2">
        <Icon.Lock size={12} /> Wallet locked
      </div>
      <div className="mt-8 flex h-12 w-full items-center gap-2 rounded-[12px] border border-line bg-surface px-4">
        {Array.from({ length: 10 }, (_, i) => (
          <motion.span key={i} className="h-2 w-2 rounded-full bg-ink" animate={{ opacity: [0, 0, 1, 1, 0], scale: [0.4, 0.4, 1, 1, 0.4] }} transition={{ duration: 6, times: [0, 0.1 + i * 0.045, 0.14 + i * 0.045, 0.85, 1], repeat: Infinity }} />
        ))}
      </div>
      <motion.div className="mt-3 w-full" animate={{ scale: [1, 1, 0.97, 1, 1] }} transition={{ duration: 6, times: [0, 0.6, 0.63, 0.66, 1], repeat: Infinity }}>
        <Btn className="w-full">UNLOCK</Btn>
      </motion.div>
      <div className="mt-6 text-[11px] text-ink-3">Auto-locks after 15 minutes. Keys never leave this device.</div>
    </div>
  );
}

export function ConnectScreen() {
  return (
    <>
      <TopBar title="Connect to" />
      <div className="flex items-center gap-3 rounded-[16px] border border-line bg-surface px-3 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-card-2 text-ink-2">
          <Icon.Globe size={17} />
        </span>
        <div>
          <div className="text-[14px] font-semibold text-ink">example.xyz</div>
          <div className="text-[11px] text-ink-3">Secure connection</div>
        </div>
      </div>
      <div className="mt-3 rounded-[16px] border border-line bg-card p-3 text-[13px]">
        <div className="label">This site wants to</div>
        {["View your wallet address", "Request transaction approvals"].map((t, i) => (
          <motion.div key={t} className="mt-2 flex items-center gap-2 text-ink" initial={{ opacity: 0, x: 8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: false }} transition={{ delay: 0.2 + i * 0.12 }}>
            <Icon.Check size={14} className="text-accent" /> {t}
          </motion.div>
        ))}
        <div className="mt-2 text-[12px] text-ink-2">It cannot move funds without your approval.</div>
      </div>
      <div className="mt-3 label">Account</div>
      <div className="mt-2 flex items-center gap-3 rounded-[14px] border border-line bg-card px-3 py-2.5">
        <span className="h-7 w-7 rounded-full bg-[linear-gradient(135deg,#A8FF60,#1b2a1b)]" />
        <div className="flex-1 text-[13px] text-ink">Main Wallet</div>
        <span className="mono text-[11px] text-ink-2">0x72…189</span>
        <Icon.Check size={14} className="text-accent" />
      </div>
      <div className="mt-auto grid grid-cols-2 gap-2">
        <Btn tone="ink">CANCEL</Btn>
        <motion.div animate={{ scale: [1, 1, 0.97, 1, 1] }} transition={{ duration: 5, times: [0, 0.6, 0.63, 0.66, 1], repeat: Infinity }}>
          <Btn className="w-full">CONNECT</Btn>
        </motion.div>
      </div>
    </>
  );
}
