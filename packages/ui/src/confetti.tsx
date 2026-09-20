import { useMemo } from "react";
import { motion } from "framer-motion";

const COLORS = ["#A8FF60", "#F4F6F4", "#86D94A", "#8FC1FF", "#F5C451"];

/** One-shot confetti burst from the centre of its (relative) parent. Pure CSS transforms, no canvas. */
export function Confetti({ count = 70, seed = 3, className }: { count?: number; seed?: number; className?: string }) {
  const parts = useMemo(() => {
    let s = seed;
    const rand = () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
    return Array.from({ length: count }, (_, i) => {
      const angle = rand() * Math.PI * 2;
      const dist = 120 + rand() * 260;
      return {
        key: i,
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist * 0.75 - 80,
        rot: (rand() - 0.5) * 720,
        w: 6 + rand() * 6,
        h: 8 + rand() * 10,
        color: COLORS[i % COLORS.length]!,
        delay: rand() * 0.15,
        dur: 1.4 + rand() * 0.8,
        round: rand() > 0.6,
      };
    });
  }, [count, seed]);
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ""}`} aria-hidden="true">
      {parts.map((p) => (
        <motion.span
          key={p.key}
          className="absolute left-1/2 top-1/2 block"
          style={{ width: p.w, height: p.round ? p.w : p.h, background: p.color, borderRadius: p.round ? 999 : 2 }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
          animate={{ x: p.x, y: [0, p.y, p.y + 220], opacity: [1, 1, 0], rotate: p.rot, scale: 1 }}
          transition={{ duration: p.dur, delay: p.delay, ease: [0.16, 0.8, 0.3, 1], times: [0, 0.45, 1] }}
        />
      ))}
    </div>
  );
}
