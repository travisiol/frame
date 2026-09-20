import { decodeFunctionData, erc20Abi, parseAbi, slice, type Abi } from "viem";
import type { Address, Hex, TxIntentKind } from "@frame/types";
import { isUnlimitedAllowance } from "@frame/chain";

/** Common router ABIs so swaps read as swaps. Unknown selectors still decode to a generic contract call. */
const routerAbi = parseAbi([
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params)",
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params)",
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient)",
  "function deposit()",
  "function withdraw(uint256 wad)",
  "function multicall(bytes[] data)",
  "function execute(bytes commands, bytes[] inputs, uint256 deadline)",
]);

export interface DecodedIntent {
  intent: TxIntentKind;
  selector?: Hex;
  functionName?: string;
  /** erc20 transfer / transferFrom */
  token?: Address;
  recipient?: Address;
  amount?: bigint;
  /** approve */
  spender?: Address;
  approvalAmount?: bigint;
  unlimited?: boolean;
  /** swap heuristics */
  swap?: {
    router: Address;
    tokenIn?: Address | "native";
    tokenOut?: Address | "native";
    amountIn?: bigint;
    amountOutMin?: bigint;
  };
  /** Stringified arguments for the developer panel. */
  args?: Record<string, string>;
}

function stringifyArgs(args: readonly unknown[] | undefined, abiInputs?: readonly { name?: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  (args ?? []).forEach((a, i) => {
    const name = abiInputs?.[i]?.name || `arg${i}`;
    out[name] = typeof a === "bigint" ? a.toString() : Array.isArray(a) ? a.map(String).join(", ") : typeof a === "object" && a !== null ? JSON.stringify(a, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) : String(a);
  });
  return out;
}

function tryDecode(abi: Abi, data: Hex) {
  try {
    return decodeFunctionData({ abi, data });
  } catch {
    return null;
  }
}

/** Addresses decoded from calldata come back checksummed; the registry and every lookup use lowercase. */
const lc = (a: Address): Address => a.toLowerCase() as Address;

/** Plain-language intent of a transaction from `to`, `data` and `value`. Pure and synchronous. */
export function decodeTransaction(tx: { to?: Address; data?: Hex; value?: bigint }): DecodedIntent {
  const data = tx.data && tx.data !== "0x" ? tx.data : undefined;
  const value = tx.value ?? 0n;

  if (!tx.to) return { intent: "contract_deploy" };
  if (!data) return { intent: "native_transfer", recipient: tx.to, amount: value };

  const selector = slice(data, 0, 4) as Hex;
  const target = lc(tx.to);

  const erc = tryDecode(erc20Abi, data);
  if (erc) {
    const fnAbi = erc20Abi.find((f) => f.type === "function" && f.name === erc.functionName);
    const args = stringifyArgs(erc.args as readonly unknown[], fnAbi && "inputs" in fnAbi ? fnAbi.inputs : undefined);
    if (erc.functionName === "transfer") {
      const [to, amount] = erc.args as readonly [Address, bigint];
      return { intent: "erc20_transfer", selector, functionName: "transfer", token: target, recipient: lc(to), amount, args };
    }
    if (erc.functionName === "transferFrom") {
      const [, to, amount] = erc.args as readonly [Address, Address, bigint];
      return { intent: "erc20_transfer", selector, functionName: "transferFrom", token: target, recipient: lc(to), amount, args };
    }
    if (erc.functionName === "approve") {
      const [spender, amount] = erc.args as readonly [Address, bigint];
      return {
        intent: "approve",
        selector,
        functionName: "approve",
        token: target,
        spender: lc(spender),
        approvalAmount: amount,
        unlimited: isUnlimitedAllowance(amount),
        args,
      };
    }
  }

  const r = tryDecode(routerAbi, data);
  if (r) {
    const fnAbi = routerAbi.find((f) => f.type === "function" && f.name === r.functionName);
    const args = stringifyArgs(r.args as readonly unknown[], fnAbi && "inputs" in fnAbi ? fnAbi.inputs : undefined);
    const name = r.functionName;
    const a = r.args as readonly unknown[];
    const swap: DecodedIntent["swap"] = { router: target };
    switch (name) {
      case "swapExactTokensForTokens":
      case "swapExactTokensForTokensSupportingFeeOnTransferTokens": {
        const path = (a[2] as Address[]).map(lc);
        swap.tokenIn = path[0];
        swap.tokenOut = path[path.length - 1];
        swap.amountIn = a[0] as bigint;
        swap.amountOutMin = a[1] as bigint;
        break;
      }
      case "swapTokensForExactTokens": {
        const path = (a[2] as Address[]).map(lc);
        swap.tokenIn = path[0];
        swap.tokenOut = path[path.length - 1];
        swap.amountIn = a[1] as bigint;
        swap.amountOutMin = a[0] as bigint;
        break;
      }
      case "swapExactETHForTokens": {
        const path = (a[1] as Address[]).map(lc);
        swap.tokenIn = "native";
        swap.tokenOut = path[path.length - 1];
        swap.amountIn = value;
        swap.amountOutMin = a[0] as bigint;
        break;
      }
      case "swapExactTokensForETH": {
        const path = (a[2] as Address[]).map(lc);
        swap.tokenIn = path[0];
        swap.tokenOut = "native";
        swap.amountIn = a[0] as bigint;
        swap.amountOutMin = a[1] as bigint;
        break;
      }
      case "exactInputSingle": {
        const p = a[0] as { tokenIn: Address; tokenOut: Address; amountIn: bigint; amountOutMinimum: bigint };
        swap.tokenIn = lc(p.tokenIn);
        swap.tokenOut = lc(p.tokenOut);
        swap.amountIn = p.amountIn;
        swap.amountOutMin = p.amountOutMinimum;
        break;
      }
      case "buy": {
        swap.tokenIn = value > 0n ? "native" : undefined;
        swap.amountIn = value > 0n ? value : (a[0] as bigint);
        swap.amountOutMin = a[1] as bigint;
        break;
      }
      case "sell": {
        swap.amountIn = a[0] as bigint;
        swap.amountOutMin = a[1] as bigint;
        break;
      }
      default:
        return { intent: "contract_call", selector, functionName: name, args };
    }
    return { intent: "swap", selector, functionName: name, swap, args };
  }

  return { intent: "contract_call", selector };
}
