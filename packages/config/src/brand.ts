/**
 * Global product identity.
 *
 * This is the ONLY place the product name lives. Every screen, manifest,
 * document and error message reads from here so the product can be renamed
 * by editing this single file.
 */
export const BRAND = {
  /** Product name in caps, as used in wordmarks and headlines. */
  name: "FRAME",
  /** Product name in sentence case, for running text. */
  displayName: "Frame",
  /** Core positioning line. */
  tagline: "The wallet for onchain markets.",
  /** Secondary line. */
  subline: "Stocks. Crypto. RWA. One wallet.",
  /** Marketing headline — never "another crypto wallet". */
  marketingHeadline: "The wallet for the onchain stock market.",
  /** Allowed positioning statements. */
  positioning: "Built for Robinhood Chain.",
  positioningAlt: "Independent wallet for Robinhood Chain.",
  /** Discreet legal disclaimer, shown in About, the landing footer and the store listing. */
  disclaimer:
    "FRAME is an independent application and is not affiliated with or endorsed by Robinhood Markets, Inc.",
  /** Semantic version of the product (mirrored in the extension manifest by the build). */
  version: "0.2.0",
  /** Reverse-DNS identifier used for EIP-6963 provider discovery. Set to the real domain before release. */
  rdns: "app.frame.wallet",
  /** Public links — placeholders until the product has a home. */
  links: {
    website: "https://frame-neon-mu.vercel.app",
    github: "https://github.com/",
    x: "https://x.com/",
    support: "mailto:support@frame.wallet.example",
    /** Official Robinhood Chain resources (independent of FRAME). */
    chainDocs: "https://docs.robinhood.com/chain/",
  },
  /** Short description for the extension manifest / store listing. */
  description:
    "Independent self-custodial wallet for Robinhood Chain. Stock Tokens, crypto and RWA in one wallet.",
} as const;

export type Brand = typeof BRAND;

/** Replaces the product name inside copy templates: "Welcome to {name}" → "Welcome to FRAME". */
export function withBrand(template: string): string {
  return template.replaceAll("{name}", BRAND.name).replaceAll("{displayName}", BRAND.displayName);
}
