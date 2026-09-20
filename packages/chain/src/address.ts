import { getAddress, isAddress, zeroAddress } from "viem";
import type { Address } from "@frame/types";

export const ZERO_ADDRESS = zeroAddress;

/** Valid 20-byte hex address (checksum not enforced here). */
export function isValidAddress(value: string): value is Address {
  return isAddress(value, { strict: false });
}

/** EIP-55 checksummed form. Throws on invalid input. */
export function checksum(value: string): Address {
  return getAddress(value);
}

export function normalizeAddress(value: string): Address {
  return value.toLowerCase() as Address;
}

export function sameAddress(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

export function isZeroAddress(value: string): boolean {
  return value.toLowerCase() === zeroAddress;
}

/** "0x7A4B…A92C" — enough characters to spot substitution attacks at a glance. */
export function shortAddress(value: string, chars = 4): string {
  if (!value) return "";
  const cs = isValidAddress(value) ? checksum(value) : value;
  return `${cs.slice(0, 2 + chars)}…${cs.slice(-chars)}`;
}

export type AddressInputResult =
  | { kind: "empty" }
  | { kind: "invalid"; reason: string }
  | {
      kind: "address";
      address: Address;
      /** Mixed-case input whose checksum did not match — a strong typo signal. */
      checksumMismatch: boolean;
      isZero: boolean;
    };

/** Classifies raw recipient input. Never rewrites the address. */
export function classifyAddressInput(input: string): AddressInputResult {
  const v = input.trim();
  if (!v) return { kind: "empty" };
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
    if (/^[0-9a-fA-F]{40}$/.test(v)) return { kind: "invalid", reason: "Address must start with 0x." };
    if (v.startsWith("0x") && v.length !== 42) return { kind: "invalid", reason: `Address must be 42 characters (got ${v.length}).` };
    if (/\.eth$/i.test(v)) return { kind: "invalid", reason: "Name resolution is not configured on Robinhood Chain. Paste the 0x address." };
    return { kind: "invalid", reason: "This is not a valid address." };
  }
  const hasMixedCase = /[a-f]/.test(v.slice(2)) && /[A-F]/.test(v.slice(2));
  const checksumMismatch = hasMixedCase && !isAddress(v, { strict: true });
  return { kind: "address", address: checksum(v), checksumMismatch, isZero: isZeroAddress(v) };
}
