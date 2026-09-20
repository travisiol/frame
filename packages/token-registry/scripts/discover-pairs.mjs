#!/usr/bin/env node
/**
 * Registry discovery — reproducible, zero-dependency.
 *
 * Reads the `pairToken` field of every TokenLaunched log emitted by the Pons V2
 * factory on Robinhood Chain, then reads symbol()/name()/decimals() from each
 * distinct pair token over the public RPC. Prints registry-shaped JSON to stdout.
 *
 *   node packages/token-registry/scripts/discover-pairs.mjs [--blocks 1200000] [--rpc URL]
 *
 * Only contracts whose on-chain name ends with "• Robinhood Token" are marked as
 * Stock Tokens; USDG / cbBTC are recognised by exact address. Everything else is
 * printed under "unclassified" for manual review — a ticker alone proves nothing.
 */
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const RPC = opt("--rpc", "https://rpc.mainnet.chain.robinhood.com");
const SPAN = Number(opt("--blocks", "1200000"));
const CHUNK = 200_000;
const FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const TOPIC_TOKEN_LAUNCHED = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607";
const KNOWN = {
  "0x5fc5360d0400a0fd4f2af552add042d716f1d168": { category: "stable", underlying: { ticker: "USD", name: "US Dollar", type: "fiat" }, priceFeed: { provider: "pegged", id: "USD" } },
  "0xcec185eb182c47d1ba1efc84e6959e18cd620be4": { category: "crypto", underlying: { ticker: "BTC", name: "Bitcoin", type: "crypto" }, priceFeed: { provider: "coingecko", id: "coinbase-wrapped-btc" } },
};
const ETF = new Set(["SPY", "QQQ", "GLD", "SLV", "USO", "INDA", "EWY"]);
const RWA = new Set(["SGOV"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(calls, tries = 6) {
  const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, ...c }));
  for (let t = 0; t < tries; t++) {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 429) { await sleep(1500 * (t + 1)); continue; }
    const j = await r.json();
    const arr = Array.isArray(j) ? j.sort((a, b) => a.id - b.id) : [j];
    if (arr.some((x) => x.error && /too many/i.test(x.error.message))) { await sleep(1500 * (t + 1)); continue; }
    return arr;
  }
  throw new Error("RPC rate limit: giving up");
}
const decodeString = (hex) => {
  if (!hex || hex === "0x") return null;
  const h = hex.slice(2);
  const len = Number.parseInt(h.slice(64, 128), 16);
  return Buffer.from(h.slice(128, 128 + len * 2), "hex").toString("utf8");
};

const [bn] = await rpc([{ method: "eth_blockNumber", params: [] }]);
const latest = Number.parseInt(bn.result, 16);
const pairs = new Map();
let scannedFrom = latest;
for (let end = latest; end > latest - SPAN; end -= CHUNK) {
  const from = Math.max(end - CHUNK + 1, latest - SPAN + 1);
  const [res] = await rpc([{ method: "eth_getLogs", params: [{ address: FACTORY, topics: [TOPIC_TOKEN_LAUNCHED], fromBlock: "0x" + from.toString(16), toBlock: "0x" + end.toString(16) }] }]);
  if (res.error) { console.error(`chunk ${from}-${end}: ${res.error.message}`); continue; }
  for (const log of res.result) {
    const pair = ("0x" + log.data.slice(2 + 24, 2 + 64)).toLowerCase();
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  scannedFrom = from;
  console.error(`chunk ${from}-${end}: ${res.result.length} launches`);
  await sleep(700);
}
pairs.delete("0x0000000000000000000000000000000000000000");

const sel = { symbol: "0x95d89b41", name: "0x06fdde03", decimals: "0x313ce567" };
const tokens = [];
const unclassified = [];
const addrs = [...pairs.keys()];
for (let i = 0; i < addrs.length; i += 5) {
  const group = addrs.slice(i, i + 5);
  const res = await rpc(group.flatMap((a) => ["symbol", "name", "decimals"].map((s) => ({ method: "eth_call", params: [{ to: a, data: sel[s] }, "latest"] }))));
  group.forEach((address, k) => {
    const symbol = decodeString(res[k * 3]?.result);
    const name = decodeString(res[k * 3 + 1]?.result);
    const decimals = res[k * 3 + 2]?.result ? Number.parseInt(res[k * 3 + 2].result, 16) : null;
    if (!symbol || !name || decimals === null) return;
    const base = { address, symbol, name, decimals, verified: true, addedAt: new Date().toISOString().slice(0, 10), launches: pairs.get(address) };
    if (KNOWN[address]) tokens.push({ ...base, ...KNOWN[address] });
    else if (name.endsWith("• Robinhood Token")) {
      const underlyingName = name.replace(/\s*•\s*Robinhood Token$/, "");
      const category = ETF.has(symbol) ? "etf" : RWA.has(symbol) ? "rwa" : "stock-token";
      const type = RWA.has(symbol) ? "treasury" : ["GLD", "SLV", "USO"].includes(symbol) ? "commodity" : ETF.has(symbol) ? "etf" : "equity";
      tokens.push({ ...base, category, underlying: { ticker: symbol, name: underlyingName, type }, priceFeed: { provider: "yahoo", id: symbol } });
    } else unclassified.push({ ...base, verified: false });
  });
  await sleep(500);
}
tokens.sort((a, b) => b.launches - a.launches);
console.log(JSON.stringify({ chainId: 4663, scanned: { fromBlock: scannedFrom, toBlock: latest }, tokens, unclassified }, null, 2));
