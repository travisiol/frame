import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...rest }: IconProps, children: React.ReactNode) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const Icon = {
  Send: (p: IconProps) => base(p, <><path d="M7 17 17 7" /><path d="M9 7h8v8" /></>),
  Receive: (p: IconProps) => base(p, <><path d="M12 5v14" /><path d="m6 13 6 6 6-6" /></>),
  Swap: (p: IconProps) => base(p, <><path d="M4 8h13" /><path d="m14 5 3 3-3 3" /><path d="M20 16H7" /><path d="m10 13-3 3 3 3" /></>),
  Bridge: (p: IconProps) => base(p, <><circle cx="5" cy="12" r="2.5" /><circle cx="19" cy="12" r="2.5" /><path d="M7.5 12h9" /><path d="M9 8c1.5-2 4.5-2 6 0" /></>),
  Home: (p: IconProps) => base(p, <><path d="M4 11 12 4l8 7" /><path d="M6 10v10h12V10" /></>),
  Markets: (p: IconProps) => base(p, <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-8" /><path d="M22 20H2" /></>),
  Activity: (p: IconProps) => base(p, <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>),
  Settings: (p: IconProps) => base(p, <><path d="M4 7h10" /><path d="M18 7h2" /><circle cx="16" cy="7" r="2" /><path d="M4 17h2" /><path d="M10 17h10" /><circle cx="8" cy="17" r="2" /></>),
  Shield: (p: IconProps) => base(p, <><path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>),
  Search: (p: IconProps) => base(p, <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>),
  Star: (p: IconProps & { filled?: boolean }) => base({ ...p, fill: p.filled ? "currentColor" : "none" }, <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8L12 3.5Z" />),
  Copy: (p: IconProps) => base(p, <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>),
  Check: (p: IconProps) => base(p, <path d="m5 12 4.5 4.5L19 7" />),
  External: (p: IconProps) => base(p, <><path d="M14 5h5v5" /><path d="M19 5 11 13" /><path d="M18 14v5H5V6h5" /></>),
  Back: (p: IconProps) => base(p, <><path d="m14 6-6 6 6 6" /></>),
  ChevronRight: (p: IconProps) => base(p, <path d="m10 6 6 6-6 6" />),
  ChevronDown: (p: IconProps) => base(p, <path d="m6 10 6 6 6-6" />),
  Close: (p: IconProps) => base(p, <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>),
  Warning: (p: IconProps) => base(p, <><path d="M12 4 2.5 20h19L12 4Z" /><path d="M12 10v4" /><path d="M12 17h.01" /></>),
  Info: (p: IconProps) => base(p, <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5" /><path d="M12 8h.01" /></>),
  Lock: (p: IconProps) => base(p, <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>),
  Unlock: (p: IconProps) => base(p, <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></>),
  Eye: (p: IconProps) => base(p, <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>),
  EyeOff: (p: IconProps) => base(p, <><path d="M3 3l18 18" /><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.6" /><path d="M6.4 7.7A16.8 16.8 0 0 0 2.5 12s3.5 6 9.5 6c1.6 0 3-.4 4.2-1" /></>),
  Plus: (p: IconProps) => base(p, <><path d="M12 5v14" /><path d="M5 12h14" /></>),
  Minus: (p: IconProps) => base(p, <path d="M5 12h14" />),
  Qr: (p: IconProps) => base(p, <><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><path d="M14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2" /></>),
  Share: (p: IconProps) => base(p, <><path d="M12 15V4" /><path d="m8 8 4-4 4 4" /><path d="M5 12v8h14v-8" /></>),
  Trash: (p: IconProps) => base(p, <><path d="M5 7h14" /><path d="M9 7V4h6v3" /><path d="M7 7l1 13h8l1-13" /></>),
  Edit: (p: IconProps) => base(p, <><path d="M4 20h4l10-10-4-4L4 16v4Z" /><path d="m12.5 7.5 4 4" /></>),
  Refresh: (p: IconProps) => base(p, <><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v5h-5" /></>),
  Wallet: (p: IconProps) => base(p, <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M16 12h2" /><path d="M3 10h18" /></>),
  Globe: (p: IconProps) => base(p, <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17" /><path d="M12 3.5c3 3 3 14 0 17" /><path d="M12 3.5c-3 3-3 14 0 17" /></>),
  Key: (p: IconProps) => base(p, <><circle cx="8" cy="14" r="4" /><path d="m11 11 9-9" /><path d="m17 5 2 2" /><path d="m14 8 2 2" /></>),
  Alert: (p: IconProps) => base(p, <><circle cx="12" cy="12" r="8.5" /><path d="M12 8v5" /><path d="M12 16h.01" /></>),
  Dots: (p: IconProps) => base(p, <><circle cx="6" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="18" cy="12" r="1.2" fill="currentColor" /></>),
  Hidden: (p: IconProps) => base(p, <><path d="M4 12h16" /><path d="M8 8h8" /><path d="M10 16h4" /></>),
  Book: (p: IconProps) => base(p, <><path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Z" /><path d="M5 16h13" /></>),
  Link: (p: IconProps) => base(p, <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>),
  Expand: (p: IconProps) => base(p, <><path d="M4 9V4h5" /><path d="M20 15v5h-5" /><path d="m4 4 6 6" /><path d="m20 20-6-6" /></>),
  Bolt: (p: IconProps) => base(p, <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" />),
  Sun: (p: IconProps) => base(p, <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>),
  Layers: (p: IconProps) => base(p, <><path d="m12 4 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4" /><path d="m4 16 8 4 8-4" /></>),
};

export type IconName = keyof typeof Icon;
