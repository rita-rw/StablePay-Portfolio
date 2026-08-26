"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Shield } from "lucide-react";
import { useUser } from "@/hooks/useUser";
import { PLATFORM_ADDRESS } from "@/lib/constants";
import { usePathname } from "next/navigation";

export default function Header() {
  const { address, isConnected } = useAccount();
  const { user, isRegistered } = useUser();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isPlatform = !!(address && PLATFORM_ADDRESS && address.toLowerCase() === PLATFORM_ADDRESS.toLowerCase());
  const showNav = mounted && isConnected && (isRegistered || isPlatform);
  const pathname = usePathname();
  const isLanding = pathname === "/" || pathname === "/faq" || pathname === "/register" || pathname.startsWith("/projects") || pathname.startsWith("/dispute-management") || pathname.startsWith("/admin-settings");

  return (
    <header className={`sticky top-0 z-50 border-b print:hidden ${isLanding ? "bg-white border-zinc-200" : "glass border-border/50"}`}>
      <div className="w-full px-8 flex h-16 items-center justify-between">
        {/* Left: logo + nav */}
        <div className="flex items-center gap-16">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg [print-color-adjust:exact]" style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 8px hsl(217 91% 30% / 0.45), inset 0 1px 0 hsl(210 100% 80% / 0.15)" }}>
              <Shield className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className={`text-xl font-bold ${isLanding ? "text-zinc-900" : "gradient-text"}`}>StablePay</span>
          </Link>

          {isLanding && !showNav && (
            <nav className="hidden md:flex items-center gap-8 text-sm">
              <Link href="/#how-it-works" className="text-zinc-500 hover:text-zinc-900 transition-colors">How it works</Link>
              <Link href="/#pricing" className="text-zinc-500 hover:text-zinc-900 transition-colors">Pricing</Link>
              <Link href="/faq" className="text-zinc-500 hover:text-zinc-900 transition-colors">FAQ</Link>
            </nav>
          )}
          {showNav && (
            <nav className="flex items-center gap-8 text-sm">
              <Link href="/projects" className="text-zinc-500 hover:text-zinc-900 transition-colors">
                {isPlatform ? "All Projects" : "My Projects"}
              </Link>
              {isPlatform && (
                <Link href="/dispute-management" className="text-zinc-500 hover:text-zinc-900 transition-colors">
                  Dispute Management
                </Link>
              )}
              {isPlatform && (
                <Link href="/admin-settings" className="text-zinc-500 hover:text-zinc-900 transition-colors">
                  Admin Settings
                </Link>
              )}
            </nav>
          )}
        </div>

        {/* Right: company name + connect */}
        <div className="flex items-center gap-4">
          {showNav && !isPlatform && user?.companyName && (
            <Link
              href="/account"
              className="text-sm font-medium text-zinc-600 hover:text-zinc-900 transition-colors"
            >
              {user.companyName}
            </Link>
          )}
          {showNav && isPlatform && (
            <span className="hidden sm:inline rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              Admin
            </span>
          )}
          <ConnectButton.Custom>
  {({ account, chain, openAccountModal, openConnectModal, openChainModal, mounted: rkMounted }) => {
    const ready = rkMounted && mounted;
    const connected = ready && account && chain;

    if (!connected) {
      return (
        <button
          onClick={openConnectModal}
          className="h-9 px-4 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110"
          style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 8px hsl(217 91% 30% / 0.35)" }}
        >
          Connect Wallet
        </button>
      );
    }

    if (chain.unsupported) {
      return (
        <button
          onClick={openChainModal}
          className="h-9 px-4 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 transition-all"
        >
          Wrong network
        </button>
      );
    }

    return (
      <button
        onClick={openAccountModal}
        className="h-9 px-4 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110"
        style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 8px hsl(217 91% 30% / 0.35)" }}
      >
        {account.displayName}
      </button>
    );
  }}
</ConnectButton.Custom>
                  </div>
      </div>
    </header>
  );
}
