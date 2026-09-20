import { BRAND } from "@frame/config";
import { LOGO_COLOR, LOGO_PNG_128, LOGO_PNG_64, LOGO_TRANSPARENT } from "./logo-data";
import { cx } from "./components";

/**
 * The FRAME logo — the artwork file from brand-src/, rendered as-is (cropped
 * to the mark by scripts/render-icons.mjs, never redrawn). The file has a
 * transparent background, so the mark floats on whatever is behind it.
 */
export function Logo({ size = 32, className, title = BRAND.name, glow = false }: { size?: number; className?: string; title?: string; glow?: boolean }) {
  return (
    <img
      src={LOGO_PNG_128}
      width={size}
      height={size}
      alt={title}
      draggable={false}
      className={cx("inline-block shrink-0 select-none", className)}
      style={{ borderRadius: LOGO_TRANSPARENT ? undefined : "22%", filter: glow ? `drop-shadow(0 ${Math.round(size / 6)}px ${Math.round(size / 2)}px ${LOGO_COLOR}66)` : undefined }}
    />
  );
}

/** Same artwork, larger default — kept for callers that used the tiled variant. */
export function LogoTile({ size = 40, className }: { size?: number; radius?: number; className?: string }) {
  return <Logo size={size} className={className} />;
}

export function Wordmark({ size = 20, className, gap = 10 }: { size?: number; className?: string; gap?: number }) {
  return (
    <span className={`inline-flex items-center ${className ?? ""}`} style={{ gap }}>
      <Logo size={size} />
      <span className="display" style={{ fontSize: size * 0.95, letterSpacing: "0.14em", lineHeight: 1 }}>
        {BRAND.name}
      </span>
    </span>
  );
}

/** Data URI of the logo for EIP-6963 provider discovery (icons must be data URIs). */
export function logoDataUri(): string {
  return LOGO_PNG_64;
}

/** Dominant colour of the artwork, for glows around the logo. */
export const LOGO_ACCENT = LOGO_COLOR;
