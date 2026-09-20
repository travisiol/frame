import { BRAND } from "@frame/config";

/**
 * The FRAME mark: two geometric strokes — a frame corner (┌) and a short
 * bar — that read as an F, a market frame and a portal at once. Built on a
 * 64-unit grid so it stays crisp at 16px.
 */
export const LOGO_GEOMETRY = {
  viewBox: "0 0 64 64",
  /** Frame corner: vertical + top bar as one path. */
  corner: "M15 12H49V22H25V52H15V12Z",
  /** Short middle bar. */
  bar: "M15 31H41V41H15V31Z",
} as const;

export function Logo({ size = 32, className, color = "currentColor", title = BRAND.name }: { size?: number; className?: string; color?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox={LOGO_GEOMETRY.viewBox} className={className} role="img" aria-label={title} shapeRendering="geometricPrecision">
      <path d={LOGO_GEOMETRY.corner} fill={color} />
      <path d={LOGO_GEOMETRY.bar} fill={color} />
    </svg>
  );
}

/** Mark on a rounded dark tile — used for the extension icon, favicons and avatars. */
export function LogoTile({ size = 40, radius = 0.22, className }: { size?: number; radius?: number; className?: string }) {
  const r = 64 * radius;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label={BRAND.name}>
      <rect width="64" height="64" rx={r} fill="#101310" />
      <rect x="0.5" y="0.5" width="63" height="63" rx={r - 0.5} fill="none" stroke="#252A25" />
      <g transform="translate(6 6) scale(0.8125)">
        <path d={LOGO_GEOMETRY.corner} fill="#A8FF60" />
        <path d={LOGO_GEOMETRY.bar} fill="#A8FF60" />
      </g>
    </svg>
  );
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

/** Data URI of the mark for EIP-6963 provider discovery (icon must be a data URI). */
export function logoDataUri(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#101310"/><g transform="translate(6 6) scale(0.8125)"><path d="${LOGO_GEOMETRY.corner}" fill="#A8FF60"/><path d="${LOGO_GEOMETRY.bar}" fill="#A8FF60"/></g></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
