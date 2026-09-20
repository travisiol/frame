import { RPC_ERROR } from "@frame/types";
import { safeErrorMessage } from "@frame/security";
import { ChainMismatchError, isNetworkError, isRateLimitError } from "@frame/chain";

export interface HumanError {
  /** Short, upper-case headline used by the UI. */
  title: string;
  /** Plain-English explanation and next step. */
  message: string;
  /** Redacted technical detail for the "View technical details" disclosure. */
  technical: string;
  /** Machine code for retries / analytics (never includes secrets). */
  code:
    | "USER_REJECTED"
    | "INSUFFICIENT_GAS"
    | "INSUFFICIENT_BALANCE"
    | "REVERTED"
    | "NONCE"
    | "FEE_TOO_LOW"
    | "NETWORK"
    | "RATE_LIMIT"
    | "CHAIN_MISMATCH"
    | "INVALID_PASSWORD"
    | "LOCKED"
    | "UNAUTHORIZED"
    | "INVALID_PARAMS"
    | "UNKNOWN";
}

/** Turns any thrown value into consumer language. The raw message is redacted before it is exposed. */
export function humanizeError(err: unknown): HumanError {
  const technical = safeErrorMessage(err, "No details available.");
  const lower = technical.toLowerCase();
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  const vaultCode = typeof err === "object" && err !== null ? (err as { code?: unknown; name?: unknown }) : undefined;

  if (code === RPC_ERROR.USER_REJECTED || /user rejected|user denied/.test(lower)) {
    return { title: "REQUEST REJECTED", message: "You declined this request. Nothing was sent.", technical, code: "USER_REJECTED" };
  }
  if (vaultCode?.name === "VaultError" && vaultCode.code === "INVALID_PASSWORD") {
    return { title: "INCORRECT PASSWORD", message: "The password did not unlock the vault. Try again.", technical, code: "INVALID_PASSWORD" };
  }
  if (err instanceof ChainMismatchError || /chain mismatch|wrong chain|reports chain/.test(lower)) {
    return {
      title: "WRONG NETWORK",
      message: "The RPC endpoint does not belong to the configured network. Check Settings › Advanced › Custom RPC.",
      technical,
      code: "CHAIN_MISMATCH",
    };
  }
  if (/wallet is locked|locked/.test(lower) && /wallet|vault/.test(lower)) {
    return { title: "WALLET LOCKED", message: "Unlock your wallet to continue.", technical, code: "LOCKED" };
  }
  if (code === RPC_ERROR.UNAUTHORIZED || /not been authorized|unauthorized/.test(lower)) {
    return { title: "NOT CONNECTED", message: "This site is not connected to the selected account.", technical, code: "UNAUTHORIZED" };
  }
  if (/insufficient funds for (intrinsic transaction cost|gas)|insufficient funds for transfer|insufficient balance for transfer|gas required exceeds allowance|insufficient funds/.test(lower)) {
    return {
      title: "NOT ENOUGH ETH FOR GAS",
      message: "Add a small amount of ETH on Robinhood Chain and try again.",
      technical,
      code: "INSUFFICIENT_GAS",
    };
  }
  if (/transfer amount exceeds balance|exceeds balance|erc20: insufficient|insufficient allowance|burn amount exceeds/.test(lower)) {
    return { title: "NOT ENOUGH BALANCE", message: "The amount is larger than what this account holds.", technical, code: "INSUFFICIENT_BALANCE" };
  }
  if (/nonce too low|already known|already imported/.test(lower)) {
    return {
      title: "TRANSACTION ALREADY PROCESSED",
      message: "A transaction with this sequence number was already submitted. Refresh and try again.",
      technical,
      code: "NONCE",
    };
  }
  if (/replacement transaction underpriced|fee too low|max fee per gas less than block base fee|underpriced/.test(lower)) {
    return { title: "NETWORK FEE TOO LOW", message: "The network fee was below the current minimum. Retry to refresh the fee.", technical, code: "FEE_TOO_LOW" };
  }
  if (/execution reverted|revert|contractfunctionexecutionerror|call_exception|out of gas/.test(lower)) {
    return { title: "TRANSACTION FAILED", message: "The contract rejected this transaction.", technical, code: "REVERTED" };
  }
  if (isRateLimitError(err)) {
    return {
      title: "NETWORK BUSY",
      message: "The RPC provider is rate-limiting requests. Wait a moment and retry, or set a dedicated RPC in Settings › Advanced.",
      technical,
      code: "RATE_LIMIT",
    };
  }
  if (isNetworkError(err)) {
    return {
      title: "NETWORK CONNECTION ISSUE",
      message: "Robinhood Chain did not respond. Retry, or change the RPC in Settings › Advanced.",
      technical,
      code: "NETWORK",
    };
  }
  if (code === RPC_ERROR.INVALID_PARAMS || /invalid param|invalid argument|invalid address/.test(lower)) {
    return { title: "INVALID REQUEST", message: "The request contained invalid parameters.", technical, code: "INVALID_PARAMS" };
  }
  return { title: "SOMETHING WENT WRONG", message: "The action could not be completed.", technical, code: "UNKNOWN" };
}
