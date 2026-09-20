// ---------------------------------------------------------------------------
// Errors (EIP-1193 codes + JSON-RPC codes)
// ---------------------------------------------------------------------------

export const RPC_ERROR = {
  USER_REJECTED: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED_METHOD: 4200,
  DISCONNECTED: 4900,
  CHAIN_DISCONNECTED: 4901,
  UNRECOGNIZED_CHAIN: 4902,
  INVALID_INPUT: -32000,
  RESOURCE_NOT_FOUND: -32001,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  METHOD_NOT_FOUND: -32601,
} as const;

export interface SerializedError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * Error carrying an EIP-1193 / JSON-RPC style code. Used across the wallet
 * core, the dApp provider and the UI. `message` must never contain secrets —
 * see @frame/security redact() before surfacing errors anywhere.
 */
export class RpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }

  toJSON(): SerializedError {
    return { code: this.code, message: this.message, ...(this.data !== undefined ? { data: this.data } : {}) };
  }

  static userRejected(message = "User rejected the request.") {
    return new RpcError(RPC_ERROR.USER_REJECTED, message);
  }
  static unauthorized(message = "The requested account and/or method has not been authorized by the user.") {
    return new RpcError(RPC_ERROR.UNAUTHORIZED, message);
  }
  static unsupportedMethod(method: string) {
    return new RpcError(RPC_ERROR.UNSUPPORTED_METHOD, `Method not supported: ${method}`);
  }
  static invalidParams(message = "Invalid parameters.") {
    return new RpcError(RPC_ERROR.INVALID_PARAMS, message);
  }
  static unrecognizedChain(chainId: string) {
    return new RpcError(RPC_ERROR.UNRECOGNIZED_CHAIN, `Unrecognized chain ID ${chainId}. Try adding the chain first.`);
  }
  static internal(message = "Internal error.") {
    return new RpcError(RPC_ERROR.INTERNAL, message);
  }
  static disconnected(message = "The wallet is disconnected.") {
    return new RpcError(RPC_ERROR.DISCONNECTED, message);
  }
}

export function isRpcError(e: unknown): e is RpcError {
  return e instanceof RpcError || (typeof e === "object" && e !== null && "code" in e && "message" in e);
}
