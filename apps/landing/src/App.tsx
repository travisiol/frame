import { APP_URL, Footer, GetStarted, Hero, Marquee, Nav, PinnedFeature, Principles } from "./Sections";
import { ApprovalsScreen, AssetScreen, BridgeScreen, ConnectScreen, LockScreen, MarketsScreen, PortfolioScreen, ReviewScreen, SendScreen, SwapScreen } from "./Screens";

export function Landing() {
  return (
    <div className="min-h-screen bg-base text-ink">
      <Nav />
      <Hero />
      <Marquee />

      <PinnedFeature
        id="portfolio"
        eyebrow="Your entire onchain portfolio"
        title={
          <>
            Markets,
            <br />
            not just tokens.
          </>
        }
        items={[
          { label: "Portfolio", body: "Stock Tokens, crypto and stables — recognized and categorized automatically. RWA first.", screen: <PortfolioScreen />, tint: "lime" },
          { label: "Markets", body: "Search NVDA, AAPL, SPY — or paste any contract and see at a glance whether it is verified.", screen: <MarketsScreen />, tint: "cool" },
          { label: "Asset", body: "Reference price, 24h move, your position. Tokenized exposure, clearly labelled. Never a made-up cost basis.", screen: <AssetScreen />, tint: "plain" },
        ]}
        cta={{ label: "Open the web app", href: APP_URL }}
      />

      <PinnedFeature
        id="move"
        eyebrow="Move money"
        title={
          <>
            Send, swap &amp; bridge
            <br />
            without leaving.
          </>
        }
        items={[
          { label: "Send", body: "Checksum checks, contract warnings and the full address on the confirmation screen.", screen: <SendScreen />, tint: "lime" },
          { label: "Swap", body: "Routes compared by what you actually receive after fees. Exact approvals, never unlimited by default.", screen: <SwapScreen />, tint: "cool" },
          { label: "Bridge", body: "Ethereum, Arbitrum or Base to Robinhood Chain in one flow, through existing bridges. No bridge jargon.", screen: <BridgeScreen />, tint: "warm" },
        ]}
        cta={{ label: "Swap in the web app", href: APP_URL }}
      />

      <PinnedFeature
        id="security"
        eyebrow="Your security"
        title={
          <>
            See what you sign.
            <br />
            Controlled by you.
          </>
        }
        items={[
          { label: "Transaction review", body: "Every transaction simulated and translated into plain English before you approve — asset changes, permissions, risks.", screen: <ReviewScreen />, tint: "warm" },
          { label: "Connected apps", body: "Sites see your address only after you say so. They can never move funds without your approval.", screen: <ConnectScreen />, tint: "cool" },
          { label: "Token approvals", body: "Unlimited approvals are flagged, editable and revocable from one place.", screen: <ApprovalsScreen />, tint: "plain" },
          { label: "Self-custody", body: "A password-encrypted vault, auto-lock, and keys that never leave your device. No backend, no backdoor.", screen: <LockScreen />, tint: "lime" },
        ]}
        cta={{ label: "Read the security model", href: "#get" }}
      />

      <Principles />
      <GetStarted />
      <Footer />
    </div>
  );
}
