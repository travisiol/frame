import { formatEther } from "viem";
import type {
  Address,
  ApprovalChange,
  AssetChange,
  PreparedTx,
  RiskFlag,
  RiskLevel,
  SimulationResult,
  TokenInfo,
  TxReview,
  TxSummaryLine,
} from "@frame/types";
import { chainName } from "@frame/config";
import { formatTokenAmount, formatUsd, isUnlimitedAllowance, isZeroAddress, sameAddress, shortAddress } from "@frame/chain";
import type { DecodedIntent } from "./decoder";

export interface ReviewContext {
  reviewId: string;
  walletChainId: number;
  prepared: PreparedTx;
  decoded: DecodedIntent;
  simulation: SimulationResult;
  /** Registry + custom tokens. */
  tokenLookup: (address: Address | "native") => TokenInfo | undefined;
  /** Metadata for tokens that are not in the registry (unverified). */
  unknownTokenLookup?: (address: Address) => Promise<TokenInfo | undefined>;
  spenderLabel?: (address: Address) => string | undefined;
  addressLabel?: (address: Address) => string | undefined;
  isContract?: (address: Address) => Promise<boolean>;
  priceUsd?: (token: TokenInfo) => number | null;
  ethPriceUsd?: number | null;
  nativeBalanceWei?: bigint;
  lowGasThresholdEth?: string;
  currentAllowance?: bigint;
  origin?: string;
  meta?: Record<string, string>;
  /** Contract age in days when the explorer knows it. */
  contractAgeDays?: number | null;
}

const NETWORK_LINE = (chainId: number): TxSummaryLine => ({ label: "Network", value: chainName(chainId) });

function levelOf(flags: RiskFlag[]): RiskLevel {
  if (flags.some((f) => f.level === "high")) return "high";
  if (flags.some((f) => f.level === "caution")) return "caution";
  return "low";
}

/** TransactionReviewer: turns a prepared transaction into what the user reads before signing. */
export async function reviewTransaction(ctx: ReviewContext): Promise<TxReview> {
  const { prepared, decoded, simulation } = ctx;
  const chainId = prepared.chainId;
  const risks: RiskFlag[] = [];
  const changes: AssetChange[] = [];
  const approvals: ApprovalChange[] = [];
  const lines: TxSummaryLine[] = [];
  let title = "Contract interaction";
  let contractLabel: string | undefined;

  const resolveToken = async (address: Address | "native" | undefined): Promise<TokenInfo | undefined> => {
    if (!address) return undefined;
    const known = ctx.tokenLookup(address);
    if (known) return known;
    if (address !== "native" && ctx.unknownTokenLookup) return ctx.unknownTokenLookup(address);
    return undefined;
  };

  const feeWei = BigInt(prepared.gas) * BigInt(prepared.maxFeePerGas);
  const feeEth = formatEther(feeWei);
  const feeUsd = ctx.ethPriceUsd ? Number(feeEth) * ctx.ethPriceUsd : null;
  const valueWei = BigInt(prepared.value);

  const labelFor = (a: Address) => ctx.addressLabel?.(a) ?? ctx.spenderLabel?.(a);
  const describe = (a: Address) => {
    const l = labelFor(a);
    return l ? `${l} (${shortAddress(a)})` : shortAddress(a);
  };

  switch (decoded.intent) {
    case "native_transfer": {
      const to = decoded.recipient as Address;
      const amount = formatTokenAmount(valueWei, 18);
      title = `Send ${amount} ETH`;
      lines.push({ label: "To", value: describe(to), mono: !labelFor(to) }, NETWORK_LINE(chainId));
      changes.push({ symbol: "ETH", amount, direction: "out", tokenAddress: "native", usd: ctx.ethPriceUsd ? Number(formatEther(valueWei)) * ctx.ethPriceUsd : null });
      await recipientRisks(to);
      break;
    }
    case "erc20_transfer": {
      const token = await resolveToken(decoded.token);
      const to = decoded.recipient as Address;
      const amount = token ? formatTokenAmount(decoded.amount ?? 0n, token.decimals) : (decoded.amount ?? 0n).toString();
      const sym = token?.symbol ?? "tokens";
      title = `Send ${amount} ${sym}`;
      lines.push({ label: "To", value: describe(to), mono: !labelFor(to) }, NETWORK_LINE(chainId));
      if (token) {
        const px = ctx.priceUsd?.(token) ?? null;
        changes.push({ symbol: token.symbol, amount, direction: "out", tokenAddress: token.address, usd: px !== null ? Number(amount.replace(/,/g, "")) * px : null });
        tokenRisks(token);
      } else {
        risks.push(unknownContractFlag(decoded.token as Address, "token"));
      }
      await recipientRisks(to);
      break;
    }
    case "approve": {
      const token = await resolveToken(decoded.token);
      const spender = decoded.spender as Address;
      const unlimited = decoded.unlimited === true;
      const revoke = (decoded.approvalAmount ?? 0n) === 0n;
      const amountStr = unlimited ? "Unlimited" : token ? formatTokenAmount(decoded.approvalAmount ?? 0n, token.decimals) : (decoded.approvalAmount ?? 0n).toString();
      const sym = token?.symbol ?? "tokens";
      const spenderLabel = ctx.spenderLabel?.(spender);
      contractLabel = spenderLabel;
      title = revoke ? `Revoke ${sym} spending permission` : unlimited ? `Allow unlimited ${sym} spending` : `Allow ${amountStr} ${sym} spending`;
      lines.push(
        { label: "Spender", value: spenderLabel ? `${spenderLabel} (${shortAddress(spender)})` : shortAddress(spender), mono: !spenderLabel },
        { label: "Amount", value: revoke ? `0 ${sym} (permission removed)` : `${amountStr} ${sym}` },
        NETWORK_LINE(chainId),
      );
      approvals.push({
        tokenAddress: (decoded.token as Address) ?? "0x",
        symbol: sym,
        spender,
        spenderLabel,
        amount: amountStr,
        unlimited,
        current:
          ctx.currentAllowance !== undefined && token ? (isUnlimitedAllowance(ctx.currentAllowance) ? "Unlimited" : formatTokenAmount(ctx.currentAllowance, token.decimals)) : undefined,
      });
      if (unlimited) {
        risks.push({
          code: "UNLIMITED_TOKEN_APPROVAL",
          level: "high",
          title: "Unlimited token approval",
          detail: `This lets the spender move any amount of ${sym} from this account at any time. Reduce it to what you need.`,
        });
      }
      if (!spenderLabel) risks.push(unknownContractFlag(spender, "spender"));
      if (token) tokenRisks(token);
      else risks.push(unknownContractFlag(decoded.token as Address, "token"));
      break;
    }
    case "swap": {
      const s = decoded.swap!;
      const tokenIn = await resolveToken(s.tokenIn);
      const tokenOut = await resolveToken(s.tokenOut);
      const routerLabel = ctx.spenderLabel?.(s.router);
      contractLabel = routerLabel;
      const inAmt = tokenIn && s.amountIn !== undefined ? formatTokenAmount(s.amountIn, tokenIn.decimals) : undefined;
      const outAmt = tokenOut && s.amountOutMin !== undefined ? formatTokenAmount(s.amountOutMin, tokenOut.decimals) : undefined;
      title = inAmt && tokenIn ? `Swap ${inAmt} ${tokenIn.symbol}` : "Swap";
      if (tokenOut) title += ` for ${outAmt && outAmt !== "0" ? `≥ ${outAmt} ` : ""}${tokenOut.symbol}`;
      lines.push({ label: "Using", value: routerLabel ? `${routerLabel} (${shortAddress(s.router)})` : shortAddress(s.router), mono: !routerLabel }, NETWORK_LINE(chainId));
      if (tokenIn && inAmt) {
        const px = ctx.priceUsd?.(tokenIn) ?? null;
        changes.push({ symbol: tokenIn.symbol, amount: inAmt, direction: "out", tokenAddress: tokenIn.address, usd: px !== null ? Number(inAmt.replace(/,/g, "")) * px : null });
        tokenRisks(tokenIn);
      }
      if (tokenOut) {
        changes.push({ symbol: tokenOut.symbol, amount: outAmt && outAmt !== "0" ? outAmt : "?", direction: "in", tokenAddress: tokenOut.address, approximate: true });
        tokenRisks(tokenOut);
      }
      if (!routerLabel) risks.push(unknownContractFlag(s.router, "contract"));
      if (valueWei > 0n && s.tokenIn !== "native") {
        changes.push({ symbol: "ETH", amount: formatTokenAmount(valueWei, 18), direction: "out", tokenAddress: "native" });
      }
      break;
    }
    case "contract_deploy": {
      title = "Deploy a contract";
      lines.push(NETWORK_LINE(chainId));
      risks.push({ code: "UNKNOWN_CONTRACT", level: "caution", title: "Contract deployment", detail: "This transaction creates a new contract from this account." });
      break;
    }
    default: {
      const to = prepared.to as Address;
      const label = labelFor(to);
      contractLabel = label;
      title = label ? `Interact with ${label}` : "Interact with a contract";
      lines.push({ label: "Contract", value: label ? `${label} (${shortAddress(to)})` : shortAddress(to), mono: !label });
      if (decoded.functionName) lines.push({ label: "Action", value: decoded.functionName });
      lines.push(NETWORK_LINE(chainId));
      if (valueWei > 0n) {
        changes.push({ symbol: "ETH", amount: formatTokenAmount(valueWei, 18), direction: "out", tokenAddress: "native", usd: ctx.ethPriceUsd ? Number(formatEther(valueWei)) * ctx.ethPriceUsd : null });
      }
      if (!label) risks.push(unknownContractFlag(to, "contract"));
    }
  }

  // Wallet-initiated flows carry their own intent: a bridge deliberately signs on the source chain,
  // a swap through an aggregator is a contract call whose meaning the wallet already knows.
  if (ctx.meta?.kind === "bridge") {
    const toChain = Number(ctx.meta.toChain);
    const dest = Number.isFinite(toChain) && toChain > 0 ? chainName(toChain) : "the destination network";
    title = valueWei > 0n ? `Move ${formatTokenAmount(valueWei, 18)} ETH to ${dest}` : `Move funds to ${dest}`;
    if (ctx.meta.provider) lines.unshift({ label: "Via", value: ctx.meta.provider });
    if (ctx.meta.amountOut) lines.push({ label: "Arrives", value: `≈ ${ctx.meta.amountOut} ETH on ${dest}${ctx.meta.eta ? ` · ${ctx.meta.eta}` : ""}` });
  } else if (ctx.meta?.kind === "swap" && decoded.intent === "contract_call" && ctx.meta.label) {
    title = ctx.meta.label;
  }

  if (ctx.contractAgeDays !== undefined && ctx.contractAgeDays !== null && ctx.contractAgeDays < 7 && decoded.intent !== "native_transfer") {
    risks.push({ code: "NEW_CONTRACT", level: "caution", title: "New contract", detail: `This contract was deployed ${ctx.contractAgeDays} day(s) ago.` });
  }

  if (prepared.chainId !== ctx.walletChainId && ctx.meta?.kind !== "bridge") {
    risks.push({ code: "CHAIN_MISMATCH", level: "high", title: "Different network", detail: `This transaction targets chain ${prepared.chainId}, but the wallet is on chain ${ctx.walletChainId}.` });
  }

  if (simulation.status === "reverted") {
    risks.push({ code: "FAILED_SIMULATION", level: "high", title: "Simulation failed", detail: simulation.revertReason ? `The contract rejected it: ${simulation.revertReason}` : "The transaction is expected to fail." });
  } else if (simulation.status === "unavailable") {
    risks.push({ code: "SIMULATION_UNAVAILABLE", level: "caution", title: "Not simulated", detail: simulation.error ?? "The outcome could not be checked in advance." });
  }

  if (ctx.nativeBalanceWei !== undefined) {
    const remaining = ctx.nativeBalanceWei - feeWei - valueWei;
    const threshold = ctx.lowGasThresholdEth ? BigInt(Math.round(Number(ctx.lowGasThresholdEth) * 1e18)) : 0n;
    if (remaining < 0n) {
      risks.push({ code: "LOW_GAS", level: "high", title: "Not enough ETH", detail: "This account cannot cover the amount plus the network fee." });
    } else if (threshold > 0n && remaining < threshold) {
      risks.push({ code: "LOW_GAS", level: "caution", title: "Low gas after this", detail: "You may not have enough ETH to make another transaction." });
    }
  }

  lines.push({ label: "Network fee", value: `~${feeUsd !== null ? formatUsd(feeUsd) : `${formatTokenAmount(feeWei, 18)} ETH`}` });

  return {
    reviewId: ctx.reviewId,
    chainId,
    from: prepared.from,
    to: prepared.to,
    recipient: decoded.intent === "native_transfer" || decoded.intent === "erc20_transfer" ? decoded.recipient : undefined,
    summary: { title, lines, intent: decoded.intent, contractLabel },
    changes,
    approvals,
    risks,
    riskLevel: levelOf(risks),
    simulation,
    fee: { wei: feeWei.toString(), eth: feeEth, usd: feeUsd },
    prepared,
    raw: { data: prepared.data, value: prepared.value, decoded: decoded.functionName ? `${decoded.functionName}(${Object.values(decoded.args ?? {}).join(", ")})` : undefined },
    createdAt: Date.now(),
    origin: ctx.origin,
    meta: ctx.meta,
  };

  async function recipientRisks(to: Address) {
    if (isZeroAddress(to)) {
      risks.push({ code: "ZERO_ADDRESS", level: "high", title: "Zero address", detail: "Funds sent to 0x000…000 are burned forever." });
      return;
    }
    if (sameAddress(to, prepared.from)) {
      risks.push({ code: "SELF_TRANSFER", level: "caution", title: "Sending to yourself", detail: "The recipient is this same account." });
    }
    if (ctx.isContract && !labelFor(to)) {
      const contract = await ctx.isContract(to).catch(() => false);
      if (contract) {
        risks.push({ code: "SEND_TO_CONTRACT", level: "caution", title: "Recipient is a contract", detail: "Most contracts cannot return funds sent to them by mistake. Make sure this is intended." });
      }
    }
  }

  function tokenRisks(token: TokenInfo) {
    if (!token.verified && token.address !== "native") {
      risks.push({ code: "UNVERIFIED_TOKEN", level: "caution", title: `Unverified token (${token.symbol})`, detail: `${token.address} is not in the verified token registry. Its name and ticker prove nothing.` });
    }
  }
}

function unknownContractFlag(address: Address, what: "contract" | "spender" | "token"): RiskFlag {
  return {
    code: "UNKNOWN_CONTRACT",
    level: "caution",
    title: `Unknown ${what}`,
    detail: `${address} is not a known ${what}. Nothing indicates it is malicious — it is simply not recognized.`,
  };
}
