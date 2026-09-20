import { describe, expect, it } from "vitest";
import { ALLOWED_METHODS, validate as validateRpc } from "../../../api/rpc.ts";
import { validate as validateMarket } from "../../../api/market.ts";

describe("api/rpc relay validation", () => {
  const call = (method: string) => JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] });

  it("accepts wallet read methods and signed broadcasts on supported chains", () => {
    expect(validateRpc("4663", call("eth_getBalance")).ok).toBe(true);
    expect(validateRpc("1", call("eth_sendRawTransaction")).ok).toBe(true);
    expect(validateRpc("42161", JSON.stringify([JSON.parse(call("eth_chainId")), JSON.parse(call("eth_call"))])).ok).toBe(true);
    expect(ALLOWED_METHODS.has("eth_sendRawTransaction")).toBe(true);
  });

  it("never relays signing or node-admin methods — the relay is not an open proxy", () => {
    for (const m of ["eth_sign", "eth_sendTransaction", "personal_sign", "eth_signTypedData_v4", "admin_addPeer", "debug_traceTransaction", "eth_accounts"]) {
      const v = validateRpc("4663", call(m));
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.status).toBe(403);
    }
  });

  it("rejects unknown chains, malformed bodies and oversized batches", () => {
    expect(validateRpc("56", call("eth_chainId"))).toMatchObject({ ok: false, status: 400 });
    expect(validateRpc(null, call("eth_chainId"))).toMatchObject({ ok: false, status: 400 });
    expect(validateRpc("4663", "not json")).toMatchObject({ ok: false, status: 400 });
    expect(validateRpc("4663", "[]")).toMatchObject({ ok: false, status: 400 });
    expect(validateRpc("4663", JSON.stringify(Array.from({ length: 101 }, () => JSON.parse(call("eth_chainId")))))).toMatchObject({ ok: false, status: 400 });
    expect(validateRpc("4663", JSON.stringify({ jsonrpc: "2.0", id: 1 }))).toMatchObject({ ok: false, status: 403 });
  });
});

describe("api/market relay validation", () => {
  it("allows only the Yahoo chart and CoinGecko price endpoints over https", () => {
    expect(validateMarket("https://query1.finance.yahoo.com/v8/finance/chart/NVDA?range=1d&interval=5m").ok).toBe(true);
    expect(validateMarket("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd").ok).toBe(true);
    expect(validateMarket("https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=1").ok).toBe(true);
  });

  it("refuses everything else", () => {
    expect(validateMarket(null)).toMatchObject({ ok: false, status: 400 });
    expect(validateMarket("http://query1.finance.yahoo.com/v8/finance/chart/NVDA")).toMatchObject({ ok: false, status: 400 });
    expect(validateMarket("https://evil.example/v8/finance/chart/NVDA")).toMatchObject({ ok: false, status: 403 });
    expect(validateMarket("https://api.coingecko.com/api/v3/coins/list")).toMatchObject({ ok: false, status: 403 });
    expect(validateMarket("https://query1.finance.yahoo.com/v8/finance/chart/../../etc")).toMatchObject({ ok: false, status: 403 });
  });
});
