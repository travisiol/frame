import { create } from "zustand";
import type { WalletSnapshot } from "@frame/types";

export type AssetTab = "all" | "stocks" | "crypto" | "stables";

interface AppState {
  snapshot: WalletSnapshot | null;
  /** Set once the first snapshot arrived (or failed). */
  ready: boolean;
  error: string | null;
  assetTab: AssetTab;
  /** True while a secret (recovery phrase / private key) is displayed — used to suppress background refreshes. */
  revealingSecret: boolean;
  setSnapshot: (s: WalletSnapshot) => void;
  setError: (e: string | null) => void;
  setAssetTab: (t: AssetTab) => void;
  setRevealingSecret: (v: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  snapshot: null,
  ready: false,
  error: null,
  assetTab: "all",
  revealingSecret: false,
  setSnapshot: (snapshot) => set({ snapshot, ready: true, error: null }),
  setError: (error) => set({ error, ready: true }),
  setAssetTab: (assetTab) => set({ assetTab }),
  setRevealingSecret: (revealingSecret) => set({ revealingSecret }),
}));

export function useSnapshot(): WalletSnapshot | null {
  return useAppStore((s) => s.snapshot);
}
