import { BRAND } from "@frame/config";
import { LOGO_COLOR, LOGO_PNG_128, LOGO_PNG_64 } from "./logo-data";
import { cx } from "./components";

/**
 * The FRAME logo — the artwork file from brand-src/, rendered as-is on its
 * black tile (cropped to the mark by scripts/render-icons.mjs, never redrawn).
 * Sits flat on dark surfaces; the tile's corners are rounded like an app icon.
 */
export function Logo({ size = 32, className, title = BRAND.name, radius = 0.22 }: { size?: number; className?: string; title?: string; color?: string; radius?: number }) {
  return <img src={LOGO_PNG_128} width={size} height={size} alt={title} draggable={false} className={cx("inline-block shrink-0 select-none", className)} style={{ borderRadius: `${radius * 100}%` }} />;
}

/** Same artwork, larger default — kept for callers that used the tiled variant. */
export function LogoTile({ size = 40, radius = 0.22, className }: { size?: number; radius?: number; className?: string }) {
  return <Logo size={size} radius={radius} className={className} />;
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
