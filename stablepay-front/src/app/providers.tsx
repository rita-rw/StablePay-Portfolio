"use client";

import { RainbowKitProvider, getDefaultConfig, lightTheme } from "@rainbow-me/rainbowkit";
import { safeWallet, rainbowWallet, coinbaseWallet, metaMaskWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import "@rainbow-me/rainbowkit/styles.css";
import { WagmiProvider } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";

const config = getDefaultConfig({
  appName: "StablePay",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
  chains: [baseSepolia],
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
