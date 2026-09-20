import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { BRAND, chainName } from "@frame/config";
import { checksum } from "@frame/chain";
import { Banner, Button, Icon, ScreenHeader, useCopy, useToast } from "@frame/ui";
import { useSnapshot } from "../state/store";
import { useSelectedAccount } from "../data/hooks";
import { goBack } from "../nav";
import { OtherNetworksCard } from "../components/OtherNetworks";

export function ReceiveScreen() {
  const snap = useSnapshot();
  const account = useSelectedAccount();
  const [svg, setSvg] = useState<string>("");
  const { copied, copy } = useCopy();
  const toast = useToast();
  const address = account ? checksum(account.address) : "";

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    QRCode.toString(address, { type: "svg", margin: 1, width: 200, color: { dark: "#F4F6F4", light: "#00000000" }, errorCorrectionLevel: "M" })
      .then((s) => {
        if (!cancelled) setSvg(s);
      })
      .catch(() => setSvg(""));
    return () => {
      cancelled = true;
    };
  }, [address]);

  const share = async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "My Robinhood Chain address", text: address });
        return;
      } catch {
        /* dismissed */
      }
    }
    if (await copy(address)) toast.push({ title: "Address copied", body: "Sharing is not available here, so the address was copied instead." });
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Receive" onBack={() => goBack("/")} subtitle={snap ? chainName(snap.chainId) : undefined} />
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 pb-6">
        <div className="label mt-2">Your address</div>
        <div className="mt-1 text-[13px] font-medium text-ink">{account?.name}</div>
        <div className="card mt-4 flex h-[216px] w-[216px] items-center justify-center p-2">
          {svg ? <div className="h-[200px] w-[200px]" dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="text-[12px] text-ink-3">Generating QR…</span>}
        </div>
        <button className="mono mt-4 max-w-full break-all rounded-[10px] border border-line bg-surface px-3 py-2 text-center text-[12px] leading-relaxed text-ink" onClick={() => void copy(address)} title="Copy address">
          {address}
        </button>
        <div className="mt-3 flex w-full gap-2">
          <Button variant="primary" full leading={copied ? <Icon.Check size={15} /> : <Icon.Copy size={15} />} onClick={() => void copy(address)}>
            {copied ? "COPIED" : "COPY ADDRESS"}
          </Button>
          <Button full leading={<Icon.Share size={15} />} onClick={share}>
            SHARE
          </Button>
        </div>
        <div className="card mt-4 w-full px-4 py-3 text-[12px] leading-relaxed text-ink-2">
          <div className="label mb-1.5">Same address on every network</div>
          Funds sent on <span className="text-ink">Robinhood Chain</span> show up here right away. If your exchange only offers Ethereum, Arbitrum One or Base, withdraw to this same address there: {BRAND.name} shows the arrival and moves it to Robinhood Chain in one step.
        </div>
        <OtherNetworksCard compact className="mt-2 w-full" />
        <Banner tone="warn" className="mt-2 w-full">
          Only send assets on {snap ? chainName(snap.chainId) : "Robinhood Chain"}, Ethereum, Arbitrum One or Base to this address. Anything sent on another network may be lost.
        </Banner>
        {snap?.mode === "demo" && (
          <Banner tone="info" className="mt-2 w-full">
            This is a real address controlled by the wallet you created. In demo mode its balances are simulated — do not send real funds to it while testing.
          </Banner>
        )}
      </div>
    </div>
  );
}
