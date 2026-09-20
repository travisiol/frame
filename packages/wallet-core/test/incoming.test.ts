import { describe, expect, it } from "vitest";
import { parseEther } from "viem";
import { MemoryStore } from "@frame/storage";
import { ETHEREUM_MAINNET_ID, ROBINHOOD_MAINNET_ID } from "@frame/config";
import type { WalletEvent } from "@frame/types";
import { WalletService } from "../src/wallet-service";

function make() {
  const events: WalletEvent[] = [];
  const service = new WalletService({
    mode: "demo",
    defaultNetworkMode: "testnet",
    persistent: new MemoryStore(),
    session: new MemoryStore(),
    kdfIterations: 1_000,
    onEvent: (e) => events.push(e),
  });
  return { service, events };
}

describe("incoming-funds watcher", () => {
  it("records a baseline first, then reports arrivals on Robinhood Chain and on a bridge source chain", async () => {
    const { service, events } = make();
    const { address } = await service.createWallet({ password: "correct horse battery" });
    expect(await service.pollIncoming()).toEqual([]); // baseline only — nothing is "new" on the first look

    service.demo!.setEth(ROBINHOOD_MAINNET_ID, address, parseEther("2.5")); // seeded with 2 → +0.5
    service.demo!.setEth(ETHEREUM_MAINNET_ID, address, parseEther("1.35")); // seeded with 1.25 → +0.1
    const found = await service.pollIncoming();
    expect(found.map((f) => [f.chainId, f.symbol, f.amountRaw])).toEqual([
      [ROBINHOOD_MAINNET_ID, "ETH", parseEther("0.5").toString()],
      [ETHEREUM_MAINNET_ID, "ETH", parseEther("0.1").toString()],
    ]);
    expect(events.filter((e) => e.type === "funds")).toHaveLength(2);

    const snap = await service.getSnapshot();
    expect(snap.incoming).toHaveLength(2);
    const activity = await service.getActivity({ address, chainId: ROBINHOOD_MAINNET_ID });
    expect(activity.some((a) => a.source === "watcher" && a.title === "Received 0.1 ETH" && a.chainId === ETHEREUM_MAINNET_ID)).toBe(true);
    expect(activity.some((a) => a.source === "watcher" && a.title === "Received 0.5 ETH" && a.chainId === ROBINHOOD_MAINNET_ID)).toBe(true);

    // a decrease is not an arrival, and nothing new means nothing reported
    service.demo!.setEth(ROBINHOOD_MAINNET_ID, address, parseEther("2"));
    expect(await service.pollIncoming()).toEqual([]);
    expect(events.filter((e) => e.type === "funds")).toHaveLength(2);
  });

  it("survives a restart without re-announcing what it already saw", async () => {
    const persistent = new MemoryStore();
    const first = new WalletService({ mode: "demo", defaultNetworkMode: "testnet", persistent, session: new MemoryStore(), kdfIterations: 1_000 });
    const { address } = await first.createWallet({ password: "correct horse battery" });
    await first.pollIncoming();
    first.demo!.setEth(ETHEREUM_MAINNET_ID, address, parseEther("1.5"));
    expect(await first.pollIncoming()).toHaveLength(1);

    const events: WalletEvent[] = [];
    const second = new WalletService({ mode: "demo", defaultNetworkMode: "testnet", persistent, session: new MemoryStore(), kdfIterations: 1_000, onEvent: (e) => events.push(e) });
    await second.init();
    expect((await second.getSnapshot()).incoming).toHaveLength(1);
    // the simulator re-seeds 1.25 on restart: lower than the 1.5 baseline → nothing announced
    expect(await second.pollIncoming()).toEqual([]);
    expect(events.filter((e) => e.type === "funds")).toHaveLength(0);
  });
});
