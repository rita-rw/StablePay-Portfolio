"use client";

import { RainbowKitProvider, getDefaultConfig, lightTheme } from "@rainbow-me/rainbowkit";
import { safeWallet, rainbowWallet, coinbaseWallet, metaMaskWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import "@rainbow-me/rainbowkit/styles.css";
import { WagmiProvider } from "wagmi";
import { http } from "viem";
import { baseSepolia } from "wagmi/chains";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { RPC_URL } from "@/lib/constants";

const config = getDefaultConfig({
  appName: "StablePay",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
  chains: [baseSepolia],
  // Own RPC (falls back to the shared public sepolia.base.org when unset) —
  // otherwise every contract read in the UI hits the same free, rate-limited
  // endpoint the backend already has its own Alchemy key for.
  transports: {
    [baseSepolia.id]: http(RPC_URL),
  },
  // Explicit wallet list instead of RainbowKit's default: its default swaps
  // in the "Base" connector (Coinbase Smart Wallet / ERC-4337), which pulls
  // in @coinbase/cdp-sdk and breaks the build (see git history for the
  // module-not-found chain this caused). The classic coinbaseWallet
  // connector below covers the same "I only have Coinbase Wallet" users
  // without that dependency chain.
  wallets: [
    {
      groupName: "Popular",
      wallets: [safeWallet, rainbowWallet, coinbaseWallet, metaMaskWallet, walletConnectWallet],
    },
  ],
});

const queryClient = new QueryClient();

const rainbowTheme = lightTheme({
  accentColor: "hsl(217, 91%, 48%)",
  accentColorForeground: "white",
  borderRadius: "large",
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rainbowTheme}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
