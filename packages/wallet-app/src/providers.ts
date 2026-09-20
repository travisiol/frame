import type { AppMode } from "@frame/types";
import {
  CachedMarketData,
  DEMO_ROUTER_A,
  DEMO_ROUTER_B,
  DemoMarketDataProvider,
  LifiAdapter,
  LiveMarketDataProvider,
  MockBridgeProvider,
  MockSwapProvider,
  type BridgeProvider,
  type MarketDataProvider,
  type SwapProvider,
} from "@frame/markets";

export interface MarketDataOptions {
  /** Same-origin relay for the web app (e.g. "/api/market"); the extension fetches upstreams directly. */
  relay?: string | null;
}

/** Shared wiring for every surface (extension, web app): LIVE gets real providers; the simulator (tests, VITE_APP_MODE=demo) gets labelled mocks. */
export function createMarketData(mode: AppMode, options: MarketDataOptions = {}): MarketDataProvider {
  if (mode === "demo") return new CachedMarketData(new DemoMarketDataProvider());
  const relay = options.relay;
  return new CachedMarketData(new LiveMarketDataProvider({ relay: relay ? (url) => `${relay}?url=${encodeURIComponent(url)}` : undefined }));
}

export function createSwapProviders(mode: AppMode, market: MarketDataProvider, lifiApiUrl: string | null): SwapProvider[] {
  if (mode === "demo") {
    return [new MockSwapProvider("demo-a", "Demo Router A", DEMO_ROUTER_A, market, 30, 0.14), new MockSwapProvider("demo-b", "Demo Router B", DEMO_ROUTER_B, market, 25, 0.09)];
  }
  return lifiApiUrl ? [new LifiAdapter(lifiApiUrl)] : [];
}

export function createBridgeProviders(mode: AppMode, market: MarketDataProvider, lifiApiUrl: string | null): BridgeProvider[] {
  if (mode === "demo") {
    return [new MockBridgeProvider("demo-fast", "Demo Fast Bridge", market, 13, 45), new MockBridgeProvider("demo-canonical", "Demo Canonical Bridge", market, 4, 900)];
  }
  return lifiApiUrl ? [new LifiAdapter(lifiApiUrl)] : [];
}
