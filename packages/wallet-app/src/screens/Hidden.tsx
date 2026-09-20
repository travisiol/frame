import { Banner, Button, ScreenHeader } from "@frame/ui";
import { useBackend } from "../context";
import { useTokens } from "../data/hooks";
import { goBack, useNavigate } from "../nav";
import { AssetRow } from "../components/common";

export function HiddenTokensScreen() {
  const backend = useBackend();
  const navigate = useNavigate();
  const { hidden } = useTokens();
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Hidden tokens" onBack={() => goBack("/")} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        <Banner tone="info" className="mb-3">
          Unsolicited or suspicious tokens land here automatically. The wallet never interacts with them and never fetches links from their names.
        </Banner>
        {hidden.length === 0 ? (
          <div className="px-2 py-10 text-center text-[13px] text-ink-2">No hidden tokens.</div>
        ) : (
          <div className="space-y-0.5">
            {hidden.map((t) => (
              <AssetRow
                key={t.address}
                token={t}
                onClick={() => navigate(`/asset/${t.address}`)}
                trailingOverride={
                  <Button size="xs" onClick={(e) => { e.stopPropagation(); void backend.setTokenHidden({ address: t.address, hidden: false }); }}>
                    Unhide
                  </Button>
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
