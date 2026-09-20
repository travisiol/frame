import type { Address, RiskLevel } from "@frame/types";
import { findToken, knownSpenderLabel } from "@frame/token-registry";

export interface RiskVerdict {
  level: RiskLevel;
  reasons: string[];
  source: string;
}

/**
 * RiskProvider — pluggable reputation sources (domain lists, contract
 * reputation, simulation services). Core wallet logic only consumes the
 * verdict; no single proprietary provider is required for the wallet to work.
 */
export interface RiskProvider {
  readonly id: string;
  checkOrigin(origin: string): Promise<RiskVerdict>;
  checkContract(chainId: number, address: Address): Promise<RiskVerdict>;
}

export interface LocalRiskLists {
  /** Origins known to be malicious (exact match, lowercase). */
  blockedOrigins: string[];
  /** Contract addresses known to be malicious (lowercase). */
  blockedContracts: string[];
  /** Origins the user trusts explicitly. */
  allowedOrigins: string[];
}

export const EMPTY_RISK_LISTS: LocalRiskLists = { blockedOrigins: [], blockedContracts: [], allowedOrigins: [] };

/** Offline provider: local block/allow lists + registry knowledge. It can only say "unknown", never "scam". */
export class LocalRiskProvider implements RiskProvider {
  readonly id = "local";
  constructor(private readonly lists: LocalRiskLists = EMPTY_RISK_LISTS) {}

  async checkOrigin(origin: string): Promise<RiskVerdict> {
    const o = origin.toLowerCase();
    if (this.lists.blockedOrigins.includes(o)) return { level: "high", reasons: ["This site is on the local blocklist."], source: this.id };
    if (this.lists.allowedOrigins.includes(o)) return { level: "low", reasons: [], source: this.id };
    if (!/^https:\/\//.test(o)) return { level: "caution", reasons: ["The site is not served over HTTPS."], source: this.id };
    return { level: "low", reasons: [], source: this.id };
  }

  async checkContract(chainId: number, address: Address): Promise<RiskVerdict> {
    const a = address.toLowerCase();
    if (this.lists.blockedContracts.includes(a)) return { level: "high", reasons: ["This contract is on the local blocklist."], source: this.id };
    if (findToken(chainId, a)?.verified || knownSpenderLabel(chainId, a)) return { level: "low", reasons: [], source: this.id };
    return { level: "caution", reasons: ["Unknown contract — not in the verified registry."], source: this.id };
  }
}

const ORDER: Record<RiskLevel, number> = { low: 0, caution: 1, high: 2 };

/** Merges several providers; the most severe verdict wins, reasons are concatenated. */
export class CompositeRiskProvider implements RiskProvider {
  readonly id = "composite";
  constructor(private readonly providers: RiskProvider[]) {}

  private merge(verdicts: PromiseSettledResult<RiskVerdict>[]): RiskVerdict {
    let level: RiskLevel = "low";
    const reasons: string[] = [];
    const sources: string[] = [];
    for (const v of verdicts) {
      if (v.status !== "fulfilled") continue;
      if (ORDER[v.value.level] > ORDER[level]) level = v.value.level;
      reasons.push(...v.value.reasons);
      sources.push(v.value.source);
    }
    return { level, reasons, source: sources.join("+") || this.id };
  }

  async checkOrigin(origin: string): Promise<RiskVerdict> {
    return this.merge(await Promise.allSettled(this.providers.map((p) => p.checkOrigin(origin))));
  }

  async checkContract(chainId: number, address: Address): Promise<RiskVerdict> {
    return this.merge(await Promise.allSettled(this.providers.map((p) => p.checkContract(chainId, address))));
  }
}
