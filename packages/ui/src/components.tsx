import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { formatPct } from "@frame/chain";
import { Icon } from "./icons";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "sm" | "xs";
  loading?: boolean;
  full?: boolean;
  leading?: ReactNode;
}

export function Button({ variant = "secondary", size = "md", loading, full, leading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      className={cx("btn", `btn-${variant}`, size === "sm" && "btn-sm", size === "xs" && "btn-xs", full && "w-full", className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={size === "md" ? 16 : 14} /> : leading}
      {children}
    </button>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cx("animate-spin", className)} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx("inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-2 transition-colors hover:bg-card-2 hover:text-ink disabled:opacity-40", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Big square action (SEND / SWAP / RECEIVE / BRIDGE). */
export function ActionTile({ label, icon, onClick, disabled }: { label: string; icon: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="group flex flex-1 flex-col items-center gap-2 rounded-[14px] border border-line bg-card px-2 py-3 transition-colors hover:border-line-2 hover:bg-card-2 disabled:opacity-40"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-card-2 text-ink transition-colors group-hover:bg-accent group-hover:text-base">{icon}</span>
      <span className="label text-[10px] text-ink">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

export function Card({ className, children, flat, onClick }: { className?: string; children: ReactNode; flat?: boolean; onClick?: () => void }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp onClick={onClick} className={cx(flat ? "card-flat" : "card", onClick && "w-full text-left transition-colors hover:bg-card-2", className)}>
      {children}
    </Comp>
  );
}

export function SectionLabel({ children, className, trailing }: { children: ReactNode; className?: string; trailing?: ReactNode }) {
  return (
    <div className={cx("flex items-center justify-between", className)}>
      <span className="label">{children}</span>
      {trailing}
    </div>
  );
}

export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  onClick,
  className,
  chevron,
  disabled,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  className?: string;
  chevron?: boolean;
  disabled?: boolean;
}) {
  const Comp = onClick ? "button" : "div";
  // A <button> with no type defaults to type="submit" — inside a <form> (e.g. Export recovery's
  // phrase/key picker), clicking a row to select it would also submit the form prematurely.
  const typeProp = onClick ? { type: "button" as const } : {};
  return (
    <Comp {...typeProp} onClick={onClick} disabled={disabled} className={cx("row", onClick && "row-hover", disabled && "opacity-50", className)}>
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-ink">{title}</div>
        {subtitle !== undefined && <div className="mt-0.5 truncate text-[12px] text-ink-2">{subtitle}</div>}
      </div>
      {trailing !== undefined && <div className="shrink-0 text-right">{trailing}</div>}
      {chevron && <Icon.ChevronRight size={16} className="shrink-0 text-ink-3" />}
    </Comp>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cx("divider", className)} />;
}

export function Pill({ tone = "muted", children, className, dot }: { tone?: "accent" | "muted" | "warn" | "loss"; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx("pill", `pill-${tone}`, className)}>
      {dot && <span className="status-dot animate-pulse-dot bg-current" />}
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, className, align = "left" }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string; align?: "left" | "right" }) {
  return (
    <div className={cx(align === "right" && "text-right", className)}>
      <div className="label">{label}</div>
      <div className="num mt-1 text-[15px] font-medium text-ink">{value}</div>
      {sub !== undefined && <div className="mt-0.5 text-[12px] text-ink-2">{sub}</div>}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      {icon && <div className="flex h-11 w-11 items-center justify-center rounded-full bg-card-2 text-ink-2">{icon}</div>}
      <div className="text-[14px] font-medium text-ink">{title}</div>
      {body && <div className="max-w-[260px] text-[12px] leading-relaxed text-ink-2">{body}</div>}
      {action}
    </div>
  );
}

export function Banner({ tone = "info", title, children, className, icon }: { tone?: "info" | "warn" | "danger" | "accent"; title?: ReactNode; children?: ReactNode; className?: string; icon?: ReactNode }) {
  const tones = {
    info: "border-line bg-surface text-ink-2",
    warn: "border-warn/30 bg-warn-dim text-warn",
    danger: "border-loss/30 bg-loss-dim text-loss",
    accent: "border-accent/30 bg-accent-dim text-accent",
  } as const;
  const defaultIcon = tone === "info" ? <Icon.Info size={16} /> : tone === "accent" ? <Icon.Check size={16} /> : <Icon.Warning size={16} />;
  return (
    <div className={cx("flex gap-3 rounded-[12px] border px-3 py-2.5 text-[12px] leading-relaxed", tones[tone], className)}>
      <span className="mt-0.5 shrink-0">{icon ?? defaultIcon}</span>
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cx(!!title && "mt-0.5", tone === "info" ? "text-ink-2" : "opacity-90")}>{children}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  trailing?: ReactNode;
  multiline?: boolean;
  rows?: number;
}

export function Field({ label, hint, error, trailing, multiline, rows, className, id, ...rest }: FieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="label mb-2 block">
          {label}
        </label>
      )}
      <div className="relative">
        {multiline ? (
          <textarea id={inputId} rows={rows ?? 3} className={cx("input textarea", !!error && "input-error")} {...(rest as unknown as React.TextareaHTMLAttributes<HTMLTextAreaElement>)} />
        ) : (
          <input id={inputId} className={cx("input", !!error && "input-error", !!trailing && "pr-11")} {...rest} />
        )}
        {trailing && <div className="absolute inset-y-0 right-2 flex items-center">{trailing}</div>}
      </div>
      {error ? <div className="mt-1.5 text-[12px] text-loss">{error}</div> : hint ? <div className="mt-1.5 text-[12px] text-ink-2">{hint}</div> : null}
    </div>
  );
}

export function PasswordField(props: FieldProps) {
  const [show, setShow] = useState(false);
  return (
    <Field
      type={show ? "text" : "password"}
      autoComplete="off"
      spellCheck={false}
      trailing={
        <IconButton label={show ? "Hide password" : "Show password"} onClick={() => setShow((s) => !s)} type="button" className="h-8 w-8">
          {show ? <Icon.EyeOff size={16} /> : <Icon.Eye size={16} />}
        </IconButton>
      }
      {...props}
    />
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="row row-hover items-start disabled:opacity-50"
    >
      <div className="min-w-0 flex-1 text-left">
        <div className="text-[14px] font-medium text-ink">{label}</div>
        {description && <div className="mt-0.5 text-[12px] leading-relaxed text-ink-2">{description}</div>}
      </div>
      <span className={cx("relative mt-0.5 inline-flex h-[22px] w-[38px] shrink-0 rounded-full border transition-colors", checked ? "border-accent bg-accent" : "border-line-2 bg-card-2")}>
        <span className={cx("absolute top-[2px] h-4 w-4 rounded-full transition-all", checked ? "left-[18px] bg-base" : "left-[2px] bg-ink-2")} />
      </span>
    </button>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[]; className?: string }) {
  return (
    <div className={cx("no-scrollbar flex gap-1 overflow-x-auto", className)} role="tablist">
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={it.value === value} className={cx("tab shrink-0", it.value === value && "tab-active")} onClick={() => onChange(it.value)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[]; className?: string }) {
  return (
    <div className={cx("inline-flex rounded-[10px] border border-line bg-surface p-0.5", className)}>
      {items.map((it) => (
        <button
          key={it.value}
          className={cx("h-7 rounded-[8px] px-3 text-[12px] font-semibold transition-colors", it.value === value ? "bg-card-2 text-ink" : "text-ink-2 hover:text-ink")}
          onClick={() => onChange(it.value)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export function PctChange({ value, className, size = "sm" }: { value: number | null | undefined; className?: string; size?: "sm" | "md" }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={cx("num text-ink-3", className)}>—</span>;
  const tone = value > 0 ? "text-accent" : value < 0 ? "text-loss" : "text-ink-2";
  return <span className={cx("num", tone, size === "sm" ? "text-[12px]" : "text-[14px]", className)}>{formatPct(value)}</span>;
}

export function Skeleton({ className, w, h = 14 }: { className?: string; w?: number | string; h?: number }) {
  return <span className={cx("skeleton inline-block", className)} style={{ width: w ?? "100%", height: h }} aria-hidden="true" />;
}

export function SkeletonRow() {
  return (
    <div className="row">
      <span className="skeleton h-9 w-9 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton w={110} />
        <Skeleton w={70} h={10} />
      </div>
      <div className="space-y-2 text-right">
        <Skeleton w={64} />
        <Skeleton w={40} h={10} />
      </div>
    </div>
  );
}

const AVATAR_TONES: Record<string, string> = {
  "stock-token": "bg-[#1b2a1b] text-accent",
  etf: "bg-[#1b2a1b] text-accent",
  rwa: "bg-[#2a261b] text-warn",
  stable: "bg-[#1b2430] text-[#8fc1ff]",
  native: "bg-[#22242a] text-ink",
  crypto: "bg-[#22242a] text-ink",
  ecosystem: "bg-card-2 text-ink-2",
  unknown: "bg-card-2 text-ink-3",
};

export function TokenAvatar({ symbol, category = "unknown", size = 36, logo, className }: { symbol: string; category?: string; size?: number; logo?: string; className?: string }) {
  const letters = symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, symbol.length > 4 ? 3 : 4).toUpperCase() || "?";
  const fontSize = letters.length >= 4 ? size * 0.26 : letters.length === 3 ? size * 0.3 : size * 0.36;
  return (
    <span
      className={cx("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold", AVATAR_TONES[category] ?? AVATAR_TONES.unknown, className)}
      style={{ width: size, height: size, fontSize, letterSpacing: "-0.02em" }}
      aria-hidden="true"
    >
      {logo ? <img src={logo} alt="" width={size} height={size} className="rounded-full" /> : letters}
    </span>
  );
}

export function Identicon({ address, size = 32, className }: { address: string; size?: number; className?: string }) {
  // Deterministic 5×5 symmetric pattern from the address — no external service, no lookup.
  const cells = useMemo(() => {
    const hex = address.toLowerCase().replace(/^0x/, "").padEnd(40, "0");
    const bits: boolean[] = [];
    for (let i = 0; i < 15; i++) bits.push(Number.parseInt(hex[i * 2] ?? "0", 16) % 2 === 0);
    const hue = Number.parseInt(hex.slice(30, 34), 16) % 360;
    return { bits, hue };
  }, [address]);
  const unit = size / 5;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cx("shrink-0 rounded-full", className)} aria-hidden="true">
      <rect width={size} height={size} fill="#1a1f1a" />
      {Array.from({ length: 25 }, (_, i) => {
        const x = i % 5;
        const y = Math.floor(i / 5);
        const mx = x < 3 ? x : 4 - x;
        const on = cells.bits[y * 3 + mx];
        return on ? <rect key={i} x={x * unit} y={y * unit} width={unit + 0.3} height={unit + 0.3} fill={`hsl(${cells.hue} 55% 62%)`} /> : null;
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

export function Donut({
  slices,
  size = 96,
  thickness = 12,
  className,
  center,
}: {
  slices: { value: number; color: string; label: string }[];
  size?: number;
  thickness?: number;
  className?: string;
  center?: ReactNode;
}) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className={cx("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1a1f1a" strokeWidth={thickness} />
        {total > 0 &&
          slices.map((s, i) => {
            const frac = Math.max(0, s.value) / total;
            const len = frac * c;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${Math.max(0, len - 2)} ${c - Math.max(0, len - 2)}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              >
                <title>{`${s.label}: ${(frac * 100).toFixed(1)}%`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
      </svg>
      {center && <div className="absolute inset-0 flex items-center justify-center">{center}</div>}
    </div>
  );
}

export function AllocationBar({ slices, className }: { slices: { value: number; color: string; label: string }[]; className?: string }) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  return (
    <div className={cx("flex h-2 w-full overflow-hidden rounded-full bg-card-2", className)}>
      {total > 0 &&
        slices.map((s, i) => (
          <div key={i} style={{ width: `${(Math.max(0, s.value) / total) * 100}%`, background: s.color }} title={s.label} className="h-full first:rounded-l-full last:rounded-r-full" />
        ))}
    </div>
  );
}

function pathFrom(points: { t: number; p: number }[], w: number, h: number, pad = 2) {
  if (points.length < 2) return { d: "", area: "", min: 0, max: 0, xs: [] as number[], ys: [] as number[] };
  const ps = points.map((x) => x.p);
  const min = Math.min(...ps);
  const max = Math.max(...ps);
  const span = max - min || 1;
  const xs = points.map((_, i) => pad + (i / (points.length - 1)) * (w - pad * 2));
  const ys = points.map((x) => pad + (1 - (x.p - min) / span) * (h - pad * 2));
  let d = `M${xs[0]!.toFixed(2)},${ys[0]!.toFixed(2)}`;
  for (let i = 1; i < xs.length; i++) d += ` L${xs[i]!.toFixed(2)},${ys[i]!.toFixed(2)}`;
  const area = `${d} L${xs[xs.length - 1]!.toFixed(2)},${h} L${xs[0]!.toFixed(2)},${h} Z`;
  return { d, area, min, max, xs, ys };
}

export function Sparkline({ points, width = 80, height = 28, className, positive }: { points: { t: number; p: number }[]; width?: number; height?: number; className?: string; positive?: boolean }) {
  const { d } = useMemo(() => pathFrom(points, width, height), [points, width, height]);
  const up = positive ?? (points.length > 1 ? points[points.length - 1]!.p >= points[0]!.p : true);
  if (!d) return <span className={cx("inline-block", className)} style={{ width, height }} />;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cx("shrink-0", className)} aria-hidden="true">
      <path d={d} fill="none" stroke={up ? "#A8FF60" : "#FF7A7A"} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function PriceChart({
  points,
  height = 160,
  className,
  formatValue,
  formatTime,
}: {
  points: { t: number; p: number }[];
  height?: number;
  className?: string;
  formatValue: (v: number) => string;
  formatTime: (t: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const geo = useMemo(() => pathFrom(points, width, height, 4), [points, width, height]);
  const up = points.length > 1 ? points[points.length - 1]!.p >= points[0]!.p : true;
  const color = up ? "#A8FF60" : "#FF7A7A";
  const gid = useId();
  const idx = hover !== null && geo.xs.length ? Math.min(geo.xs.length - 1, Math.max(0, Math.round((hover / width) * (geo.xs.length - 1)))) : null;
  const pt = idx !== null ? points[idx] : undefined;
  return (
    <div ref={ref} className={cx("relative w-full select-none", className)} style={{ height }}>
      {geo.d ? (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block"
          onMouseMove={(e) => setHover(e.nativeEvent.offsetX)}
          onMouseLeave={() => setHover(null)}
          onTouchMove={(e) => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const t = e.touches[0];
            if (t) setHover(t.clientX - rect.left);
          }}
          onTouchEnd={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.22" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={geo.area} fill={`url(#${gid})`} />
          <path d={geo.d} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
          {idx !== null && (
            <>
              <line x1={geo.xs[idx]} x2={geo.xs[idx]} y1={0} y2={height} stroke="#313731" strokeDasharray="3 3" />
              <circle cx={geo.xs[idx]} cy={geo.ys[idx]} r={3.5} fill={color} stroke="#080A09" strokeWidth={2} />
            </>
          )}
        </svg>
      ) : (
        <div className="flex h-full items-center justify-center text-[12px] text-ink-3">No price history available.</div>
      )}
      {pt && (
        <div className="pointer-events-none absolute left-0 top-0 rounded-[8px] border border-line bg-surface px-2 py-1 text-[11px]">
          <span className="num text-ink">{formatValue(pt.p)}</span>
          <span className="ml-2 text-ink-2">{formatTime(pt.t)}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

export function Sheet({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-end justify-center bg-base/70 backdrop-blur-[2px]" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className={cx("fade-up flex max-h-[92%] w-full flex-col rounded-t-[18px] border border-line bg-surface", wide ? "max-w-[560px]" : "max-w-[440px]")}
        onClick={(e) => e.stopPropagation()}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <div className="text-[15px] font-semibold text-ink">{title}</div>
            <IconButton label="Close" onClick={onClose}>
              <Icon.Close size={16} />
            </IconButton>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer && <div className="border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Dialog({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-base/70 p-4 backdrop-blur-[2px]" onClick={onClose} role="dialog" aria-modal="true">
      <div className="fade-up w-full max-w-[400px] rounded-[16px] border border-line bg-surface" onClick={(e) => e.stopPropagation()}>
        {title !== undefined && <div className="px-5 pt-5 text-[15px] font-semibold text-ink">{title}</div>}
        <div className="px-5 py-4 text-[13px] leading-relaxed text-ink-2">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 pb-5">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

export interface ToastItem {
  id: number;
  title: string;
  body?: string;
  tone?: "info" | "success" | "error";
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  push: (t: Omit<ToastItem, "id">) => void;
}

const ToastContext = createContext<ToastApi>({ push: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = ++counter.current;
    setItems((list) => [...list.slice(-2), { ...t, id }]);
    window.setTimeout(() => setItems((list) => list.filter((x) => x.id !== id)), t.tone === "error" ? 7000 : 4200);
  }, []);
  const api = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[60] flex flex-col items-center gap-2 px-3">
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              "fade-up pointer-events-auto flex w-full max-w-[380px] items-start gap-3 rounded-[12px] border px-3 py-2.5 text-[12px] shadow-[0_8px_30px_rgba(0,0,0,0.45)]",
              t.tone === "error" ? "border-loss/40 bg-[#1c1212]" : t.tone === "success" ? "border-accent/30 bg-[#121a10]" : "border-line bg-surface",
            )}
          >
            <span className={cx("mt-0.5 shrink-0", t.tone === "error" ? "text-loss" : t.tone === "success" ? "text-accent" : "text-ink-2")}>
              {t.tone === "error" ? <Icon.Warning size={15} /> : t.tone === "success" ? <Icon.Check size={15} /> : <Icon.Info size={15} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-ink">{t.title}</div>
              {t.body && <div className="mt-0.5 text-ink-2">{t.body}</div>}
            </div>
            {t.action && (
              <button className="shrink-0 font-semibold text-accent" onClick={t.action.onClick}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/** Copies text; returns a `copied` flag for 1.6 s. Never logs the value. */
export function useCopy(clearAfterSeconds = 0): { copied: boolean; copy: (text: string) => Promise<boolean> } {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
        if (clearAfterSeconds > 0) {
          window.setTimeout(async () => {
            try {
              // Only clear if the clipboard still holds what we put there.
              const current = await navigator.clipboard.readText().catch(() => null);
              if (current === text) await navigator.clipboard.writeText("");
            } catch {
              /* clipboard read not permitted — cannot confirm, so we do not claim it was cleared */
            }
          }, clearAfterSeconds * 1000);
        }
        return true;
      } catch {
        return false;
      }
    },
    [clearAfterSeconds],
  );
  return { copied, copy };
}

export function CopyButton({ text, label = "Copy", size = 14, className }: { text: string; label?: string; size?: number; className?: string }) {
  const { copied, copy } = useCopy();
  return (
    <IconButton label={copied ? "Copied" : label} onClick={() => void copy(text)} className={cx("h-7 w-7", className)}>
      {copied ? <Icon.Check size={size} className="text-accent" /> : <Icon.Copy size={size} />}
    </IconButton>
  );
}

// ---------------------------------------------------------------------------
// Screen chrome
// ---------------------------------------------------------------------------

export function ScreenHeader({ title, onBack, trailing, subtitle }: { title: ReactNode; onBack?: () => void; trailing?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-3">
      {onBack ? (
        <IconButton label="Back" onClick={onBack}>
          <Icon.Back size={18} />
        </IconButton>
      ) : (
        <span className="w-2" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-ink">{title}</div>
        {subtitle && <div className="truncate text-[11px] text-ink-2">{subtitle}</div>}
      </div>
      {trailing}
    </div>
  );
}

export function StepDots({ count, active }: { count: number; active: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={cx("h-1 rounded-full transition-all", i === active ? "w-5 bg-accent" : i < active ? "w-1.5 bg-ink-2" : "w-1.5 bg-line-2")} />
      ))}
    </div>
  );
}

export function KeyValue({ rows, className }: { rows: { label: ReactNode; value: ReactNode; mono?: boolean }[]; className?: string }) {
  return (
    <dl className={cx("divide-y divide-line", className)}>
      {rows.map((r, i) => (
        <div key={i} className="flex items-start justify-between gap-4 py-2.5 text-[13px]">
          <dt className="shrink-0 text-ink-2">{r.label}</dt>
          <dd className={cx("min-w-0 break-all text-right text-ink", r.mono && "mono")}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
