import { hexToString, isHex, stringToHex, type TypedDataDefinition } from "viem";
import type { Address, Hex, SignWarning } from "@frame/types";
import { isValidAddress } from "@frame/chain";

export interface MessageSignAnalysis {
  text: string;
  hex: Hex;
  warnings: SignWarning[];
}

/** personal_sign params arrive as [message, address] (MetaMask order) or [address, message]; the address is the one that is a valid address. */
export function splitPersonalSignParams(params: unknown[]): { message: string; address: Address } | null {
  const [a, b] = params;
  if (typeof a === "string" && typeof b === "string") {
    if (isValidAddress(b) && !isValidAddress(a)) return { message: a, address: b as Address };
    if (isValidAddress(a) && !isValidAddress(b)) return { message: b, address: a as Address };
    if (isValidAddress(a) && isValidAddress(b)) return { message: a, address: b as Address };
  }
  return null;
}

const PRINTABLE = /^[\x09\x0A\x0D\x20-\x7E -￿]*$/;

export function analyzeMessageSignRequest(message: string): MessageSignAnalysis {
  let text: string;
  let hex: Hex;
  let unreadable = false;
  if (isHex(message, { strict: true })) {
    hex = message;
    try {
      text = hexToString(message);
      if (!PRINTABLE.test(text) || text.length === 0) {
        unreadable = true;
        text = message;
      }
    } catch {
      unreadable = true;
      text = message;
    }
  } else {
    text = message;
    hex = stringToHex(message);
  }
  const warnings: SignWarning[] = [];
  if (unreadable) {
    warnings.push({
      code: "UNREADABLE",
      title: "Unreadable message",
      detail: "The message is raw bytes, not text. Only sign it if you trust this site and know what it does.",
    });
  }
  if (/wants you to sign in with your ethereum account|sign[- ]in|nonce:|uri:|issued at:|log ?in|authenticate/i.test(text)) {
    warnings.push({
      code: "AUTH_CHALLENGE",
      title: "Sign-in request",
      detail: "This signature logs you into the site. It cannot move funds, but only sign it on the site you intend to log into.",
    });
  }
  if (/approve|allowance|spender|permit|transfer/i.test(text)) {
    warnings.push({
      code: "APPROVAL_LIKE",
      title: "Mentions approvals or transfers",
      detail: "The text references token permissions. A plain message signature cannot approve tokens by itself, but read it carefully.",
    });
  }
  return { text, hex, warnings };
}

export interface TypedDataAnalysis {
  json: string;
  primaryType: string;
  domain: Record<string, unknown>;
  message: Record<string, unknown>;
  typedData: TypedDataDefinition;
  warnings: SignWarning[];
}

/** eth_signTypedData_v4 params: [address, JSON string | object]. */
export function splitTypedDataParams(params: unknown[]): { address: Address; raw: unknown } | null {
  const [a, b] = params;
  if (typeof a === "string" && isValidAddress(a)) return { address: a as Address, raw: b };
  if (typeof b === "string" && isValidAddress(b)) return { address: b as Address, raw: a };
  return null;
}

export function analyzeTypedDataRequest(raw: unknown, walletChainId: number): TypedDataAnalysis {
  let obj: Record<string, unknown>;
  try {
    obj = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
  } catch {
    throw new Error("Typed data is not valid JSON.");
  }
  if (!obj || typeof obj !== "object" || typeof obj.primaryType !== "string" || typeof obj.types !== "object" || typeof obj.message !== "object") {
    throw new Error("Typed data is missing types, primaryType or message.");
  }
  const domain = (obj.domain ?? {}) as Record<string, unknown>;
  const message = obj.message as Record<string, unknown>;
  const primaryType = obj.primaryType;
  const warnings: SignWarning[] = [];

  warnings.push({
    code: "TYPED_DATA",
    title: "Structured data",
    detail: `This is a typed-data signature (${primaryType}). Sites can use these to authorize actions off-chain.`,
  });

  const keys = Object.keys(message).map((k) => k.toLowerCase());
  const hasSpender = keys.includes("spender") || keys.includes("operator");
  const hasAmount = keys.some((k) => ["value", "amount", "allowed", "allowance"].includes(k));
  if (/permit/i.test(primaryType) || (hasSpender && hasAmount)) {
    warnings.push({
      code: "PERMIT",
      title: "Token permission (Permit)",
      detail: "Signing this lets the spender move your tokens without a transaction from you. Check the spender and the amount.",
    });
  } else if (hasSpender || keys.some((k) => /approv|allowance|delegate|authoriz/.test(k))) {
    warnings.push({
      code: "APPROVAL_LIKE",
      title: "Looks like a permission",
      detail: "The data contains approval-like fields. Make sure you trust this site.",
    });
  }
  const domainChain = domain.chainId !== undefined ? Number(domain.chainId) : undefined;
  if (domainChain !== undefined && Number.isFinite(domainChain) && domainChain !== walletChainId) {
    warnings.push({
      code: "TYPED_DATA",
      title: `For chain ${domainChain}`,
      detail: `The signature is scoped to chain ${domainChain}, not the network you are on (${walletChainId}).`,
    });
  }
  return {
    json: JSON.stringify(obj, null, 2),
    primaryType,
    domain,
    message,
    typedData: obj as unknown as TypedDataDefinition,
    warnings,
  };
}
