import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { cx } from "./components";

export interface FloatingItem {
  symbol: string;
  /** Visual tone of the coin. */
  tone?: "stock" | "stable" | "crypto" | "lime" | "ink";
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TONE: Record<NonNullable<FloatingItem["tone"]>, { bg: string; fg: string; border: string }> = {
  stock: { bg: "#111a12", fg: "#A8FF60", border: "rgba(168,255,96,0.28)" },
  stable: { bg: "#10161d", fg: "#8fc1ff", border: "rgba(143,193,255,0.25)" },
  crypto: { bg: "#17191b", fg: "#F4F6F4", border: "rgba(244,246,244,0.18)" },
  lime: { bg: "#A8FF60", fg: "#080A09", border: "rgba(168,255,96,0.9)" },
  ink: { bg: "#F4F6F4", fg: "#080A09", border: "rgba(244,246,244,0.9)" },
};

/**
 * A field of floating asset "coins" with depth of field: far coins are small,
 * blurred and dim; near coins are large and crisp. Drift is a slow loop;
 * the whole field parallaxes with the pointer. No assets, no canvas.
 */
/** Rectangle in percent of the field the coins must stay out of (text, cards). */
export interface AvoidRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function FloatingField({
  items,
  count = 26,
  seed = 11,
  parallax = 28,
  className,
  minSize = 34,
  maxSize = 118,
  speed = 1,
  avoid = [],
}: {
  items: FloatingItem[];
  count?: number;
  seed?: number;
  parallax?: number;
  className?: string;
  minSize?: number;
  maxSize?: number;
  speed?: number;
  avoid?: AvoidRect[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const coins = useMemo(() => {
    const rand = mulberry32(seed);
    const inside = (x: number, y: number) => avoid.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    const out: {
      key: number;
      item: FloatingItem;
      x: number;
      y: number;
      z: number;
      size: number;
      dur: number;
      delay: number;
      dx: number;
      dy: number;
      rot: number;
    }[] = [];
    for (let i = 0; i < count; i++) {
      let x = 0;
      let y = 0;
      let ok = false;
      for (let t = 0; t < 24 && !ok; t++) {
        x = 4 + rand() * 92;
        y = 6 + rand() * 88;
        ok = !inside(x, y);
      }
      if (!ok) continue;
      const z = rand();
      out.push({
        key: i,
        item: items[i % items.length]!,
        x,
        y,
        z,
        size: minSize + z * z * (maxSize - minSize),
        dur: (14 + rand() * 16) / speed,
        delay: -rand() * 20,
        dx: (rand() - 0.5) * 40,
        dy: (rand() - 0.5) * 56,
        rot: (rand() - 0.5) * 24,
      });
    }
    return out;
    // `avoid` is compared by value so inline arrays do not reshuffle the field on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, count, seed, minSize, maxSize, speed, JSON.stringify(avoid)]);

  useEffect(() => {
    const el = ref.current;
    if (!el || parallax === 0) return;
    let raf = 0;
    let tx = 0;
    let ty = 0;
    let cx0 = 0;
    let cy0 = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const tick = () => {
      cx0 += (tx - cx0) * 0.08;
      cy0 += (ty - cy0) * 0.08;
      el.style.setProperty("--mx", cx0.toFixed(4));
      el.style.setProperty("--my", cy0.toFixed(4));
      raf = Math.abs(tx - cx0) + Math.abs(ty - cy0) > 0.002 ? requestAnimationFrame(tick) : 0;
    };
    const onLeave = () => {
      tx = 0;
      ty = 0;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [parallax]);

  return (
    <div ref={ref} className={cx("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden="true" style={{ "--mx": 0, "--my": 0 } as CSSProperties}>
      {coins.map((c) => {
        const tone = TONE[c.item.tone ?? "stock"];
        const depthPx = parallax * (0.2 + c.z);
        const blur = (1 - c.z) * 5;
        const letters = c.item.symbol.length > 4 ? c.item.symbol.slice(0, 3) : c.item.symbol;
        return (
          <div
            key={c.key}
            className="absolute"
            style={{
              left: `${c.x}%`,
              top: `${c.y}%`,
              zIndex: Math.round(c.z * 10),
              transform: `translate(calc(var(--mx) * ${depthPx}px), calc(var(--my) * ${depthPx}px))`,
              transition: "transform 0.2s linear",
            }}
          >
            <motion.div
              animate={{ x: [0, c.dx, 0], y: [0, c.dy, 0], rotate: [0, c.rot, 0] }}
              transition={{ duration: c.dur, repeat: Infinity, ease: "easeInOut", delay: c.delay }}
              style={{
                width: c.size,
                height: c.size,
                marginLeft: -c.size / 2,
                marginTop: -c.size / 2,
                borderRadius: 999,
                background: tone.bg,
                color: tone.fg,
                border: `1px solid ${tone.border}`,
                boxShadow: c.z > 0.7 ? "0 24px 60px rgba(0,0,0,0.55)" : "0 10px 30px rgba(0,0,0,0.35)",
                filter: `blur(${blur.toFixed(1)}px)`,
                opacity: 0.35 + c.z * 0.65,
                fontSize: c.size * (letters.length >= 4 ? 0.22 : 0.3),
                fontWeight: 600,
                letterSpacing: "-0.02em",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-display)",
              }}
            >
              {letters}
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}

/** Default asset set for FRAME visuals — Robinhood Chain Stock Tokens, stables and crypto. */
export const FRAME_FLOATING_ITEMS: FloatingItem[] = [
  { symbol: "NVDA", tone: "stock" },
  { symbol: "ETH", tone: "crypto" },
  { symbol: "AAPL", tone: "stock" },
  { symbol: "USDG", tone: "stable" },
  { symbol: "TSLA", tone: "stock" },
  { symbol: "SPY", tone: "lime" },
  { symbol: "HOOD", tone: "stock" },
  { symbol: "GLD", tone: "ink" },
  { symbol: "MSFT", tone: "stock" },
  { symbol: "cbBTC", tone: "crypto" },
  { symbol: "QQQ", tone: "stock" },
  { symbol: "META", tone: "stock" },
  { symbol: "AMZN", tone: "lime" },
  { symbol: "SGOV", tone: "stable" },
];
