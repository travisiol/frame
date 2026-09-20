import { encodeFunctionData, erc20Abi, formatUnits, maxUint256, type PublicClient } from "viem";
import type { Address, Hex, TokenInfo } from "@frame/types";

export { erc20Abi };

export const MAX_UINT256 = maxUint256;
/** Approvals at or above 2^96-1 (Permit2-style "max") are treated as unlimited. */
export const UNLIMITED_THRESHOLD = (1n << 96n) - 1n;

export function isUnlimitedAllowance(amount: bigint): boolean {
  return amount >= UNLIMITED_THRESHOLD;
}

export interface TokenMetadata {
  symbol: string;
  name: string;
  decimals: number;
  /** True when the address holds contract code. */
  isContract: boolean;
}

/** Reads symbol/name/decimals; tolerant of partial failures so unknown tokens can still be shown as UNKNOWN TOKEN. */
export async function readTokenMetadata(client: PublicClient, address: Address): Promise<TokenMetadata | null> {
  const code = await client.getCode({ address }).catch(() => undefined);
  const isContract = !!code && code !== "0x";
  if (!isContract) return null;
  const [symbol, name, decimals] = await Promise.allSettled([
    client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address, abi: erc20Abi, functionName: "name" }),
    client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
  ]);
  if (decimals.status !== "fulfilled") return null;
  return {
    symbol: symbol.status === "fulfilled" ? String(symbol.value) : "???",
    name: name.status === "fulfilled" ? String(name.value) : "Unknown token",
    decimals: Number(decimals.value),
    isContract,
  };
}

export async function readNativeBalance(client: PublicClient, owner: Address): Promise<bigint> {
  return client.getBalance({ address: owner });
}

/** Balances for many tokens in one round-trip when Multicall3 exists on the chain; otherwise batched individual reads. */
export async function readTokenBalances(
  client: PublicClient,
  owner: Address,
  tokens: TokenInfo[],
): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  const erc20s = tokens.filter((t) => t.address !== "native");
  const native = tokens.find((t) => t.address === "native");
  const jobs: Promise<void>[] = [];
  if (native) {
    jobs.push(
      readNativeBalance(client, owner).then((b) => {
        out.set("native", b);
      }),
    );
  }
  if (erc20s.length) {
    const hasMulticall = !!client.chain?.contracts?.multicall3;
    if (hasMulticall) {
      jobs.push(
        client
          .multicall({
            contracts: erc20s.map((t) => ({
              address: t.address as Address,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [owner],
            })),
            allowFailure: true,
          })
          .then((results) => {
            results.forEach((r, i) => {
              const t = erc20s[i];
              if (t && r.status === "success") out.set(t.address, r.result as bigint);
            });
          })
          .catch(async () => {
            await readIndividually(client, owner, erc20s, out);
          }),
      );
    } else {
      jobs.push(readIndividually(client, owner, erc20s, out));
    }
  }
  await Promise.all(jobs);
  return out;
}

async function readIndividually(client: PublicClient, owner: Address, tokens: TokenInfo[], out: Map<string, bigint>) {
  const results = await Promise.allSettled(
    tokens.map((t) =>
      client.readContract({ address: t.address as Address, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    ),
  );
  results.forEach((r, i) => {
    const t = tokens[i];
    if (t && r.status === "fulfilled") out.set(t.address, r.value);
  });
}

export async function readAllowance(client: PublicClient, token: Address, owner: Address, spender: Address): Promise<bigint> {
  return client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
}

export function encodeTransfer(to: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] });
}

export function encodeApprove(spender: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] });
}

/** Human formatting with sensible precision: never scientific notation, never fabricated digits. */
export function formatTokenAmount(raw: bigint | string, decimals: number, maxFractionDigits?: number): string {
  const value = typeof raw === "string" ? BigInt(raw) : raw;
  const full = formatUnits(value, decimals);
  const [int = "0", frac = ""] = full.split(".");
  const limit = maxFractionDigits ?? (decimals <= 6 ? 2 : 6);
  let f = frac.slice(0, limit).replace(/0+$/, "");
  if (value !== 0n && int === "0" && f === "" && frac.length) {
    // Tiny non-zero amount: show the first significant digits rather than "0".
    const sig = frac.match(/^(0*)([1-9]\d?)/);
    if (sig) f = `${sig[1]}${sig[2]}`;
  }
  // Group thousands on the string itself: Number() would lose precision past 2^53.
  const intFormatted = int.length > 3 ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : int;
  return f ? `${intFormatted}.${f}` : intFormatted;
}
