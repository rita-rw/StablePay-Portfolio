"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useUser } from "@/hooks/useUser";
import Dashboard from "@/components/dashboard/Dashboard";
import AdminDashboard from "@/components/admin/AdminDashboard";
import { PLATFORM_ADDRESS } from "@/lib/constants";

import {
  Shield, ArrowRight, Lock, Zap, Scale, Clock, CheckCircle2,
  Layers, Globe, FileText, ChevronDown,
} from "lucide-react";

const steps = [
  {
    num: "01",
    title: "Create a Project",
    desc: "Define milestones, set USDC amounts, and specify the seller's wallet address on Base.",
    icon: Layers,
  },
  {
    num: "02",
    title: "Deliver Work",
    desc: "The freelancer submits deliverables per milestone. Everything is tracked on-chain.",
    icon: Zap,
  },
  {
    num: "03",
    title: "Get Paid",
    desc: "Funds release on approval — or get fairly resolved via built-in dispute resolution.",
    icon: CheckCircle2,
  },
];

const features = [
  {
    icon: Lock,
    title: "Milestone-Based Payments",
    description: "Split projects into milestones. Each one releases payment only when work is approved by the buyer.",
  },
  {
    icon: Scale,
    title: "Built-In Dispute Resolution",
    description: "7-day correction window for sellers. If unresolved, the platform arbitrates and splits funds fairly.",
  },
  {
    icon: Clock,
    title: "Auto-Approval Safety Net",
    description: "If a buyer goes silent, sellers can auto-claim payment after the approval window expires.",
  },
  {
    icon: Globe,
    title: "Stablecoin Payments",
    description: "Pay and get paid in USDC — no crypto volatility, no currency risk, no bank delays.",
  },
  {
    icon: Zap,
    title: "Built on Base",
    description: "Fast, cheap transactions on Ethereum's leading L2. Sub-cent fees, instant finality.",
  },
  {
    icon: FileText,
    title: "Full Audit Trail",
    description: "Every project generates a downloadable receipt with complete transaction history — ready for accounting and compliance.",
  },
];

export default function Landing() {
  const { address, isConnected, status } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { user, isRegistered, checked } = useUser();
  const [mounted, setMounted] = useState(false);
  const wasDisconnectedRef = useRef(false);
  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);

  const connected = mounted && isConnected;
  const isPlatform = !!(address && PLATFORM_ADDRESS && address.toLowerCase() === PLATFORM_ADDRESS.toLowerCase());
  const sessionPending = !mounted || status === "connecting" || status === "reconnecting" || (connected && !checked);
  const ctaHref = connected && isPlatform ? "/projects"
    : connected && isRegistered ? "/projects"
    : connected ? "/register"
    : null;
  const ctaLabel = isPlatform ? "Admin Dashboard"
    : isRegistered ? "My Projects"
    : "Start a deal";


  useEffect(() => {
    if (mounted && !isConnected) {
      wasDisconnectedRef.current = true;
    }
  }, [mounted, isConnected]);

  useEffect(() => {
    if (wasDisconnectedRef.current && connected) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      wasDisconnectedRef.current = false;
    }
  }, [connected]);

  if (sessionPending) return null;
  if (connected && isPlatform) return <AdminDashboard />;
  if (connected && isRegistered) return <Dashboard />;

  return (
    <div className="theme-app min-h-screen">

      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden bg-white flex flex-col" style={{ minHeight: "calc(100vh - 64px)", paddingTop: "16px", paddingBottom: "40px" }}>
        {/* Text content — narrow */}
        <div className="container relative">
          <div className="mx-auto max-w-2xl text-center">
            {/* Badge */}
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-4 py-1.5 text-xs font-medium text-zinc-500 tracking-wide">
              Smart contract escrow · Built on Base
            </div>

            {/* Headline */}
            <h1
              className="mb-3 font-bold leading-[1.06] tracking-tight text-zinc-900"
              style={{ fontSize: "clamp(2.2rem, 5vw, 4rem)" }}
            >
              The secure way to pay<br />for B2B contracts.
            </h1>

            {/* Sub */}
            <p className="mb-6 text-base leading-relaxed text-zinc-500 mx-auto" style={{ maxWidth: "460px" }}>
              Funds locked in smart contracts. Released only when work is approved. No middlemen, no disputes over payment.
            </p>

            {/* CTA */}
            <div className="flex justify-center mb-0">
              {ctaHref ? (
                <Link
                  href={ctaHref}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-8 py-3.5 text-sm font-semibold text-white transition-all hover:bg-zinc-700"
                >
                  {ctaLabel} <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <button
                  onClick={openConnectModal}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-8 py-3.5 text-sm font-semibold text-white transition-all hover:bg-zinc-700"
                >
                  Create your first project <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Auth state */}
            {connected && isRegistered && !isPlatform && user?.companyName && (
              <p className="mt-2 text-sm text-zinc-500">
                Signed in as <span className="font-semibold text-zinc-900">{user.companyName}</span>
              </p>
            )}
            {connected && isPlatform && (
              <p className="mt-2 text-sm text-zinc-500">
                Signed in as <span className="font-semibold text-zinc-900">Platform Admin</span>
              </p>
            )}
          </div>
        </div>

        {/* Flow visualization */}
        <div className="container mt-10 flex-1 flex flex-col justify-start">
          <div className="mx-auto w-full max-w-5xl">
            <div className="grid grid-cols-3 gap-5 items-stretch">

              {/* Buyer */}
              <div className="rounded-2xl border border-zinc-200 bg-white p-7 shadow-[0_2px_16px_rgba(0,0,0,0.06)] flex flex-col">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Buyer</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    <span className="h-1 w-1 rounded-full bg-emerald-500" />
                    Funded
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mb-0.5">Acme Corp</p>
                <p className="text-2xl font-bold tracking-tight text-zinc-900">$12,000 <span className="text-sm font-medium text-zinc-400">USDC</span></p>
                <div className="mt-3 pt-3 border-t border-zinc-100 space-y-2 flex-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-400">Milestone 1 — Design</span>
                    <span className="font-medium text-emerald-600">Approved</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-400">Milestone 2 — Development</span>
                    <span className="font-medium text-primary">In review</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-400">Milestone 3 — Delivery</span>
                    <span className="font-medium text-zinc-300">Pending</span>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-zinc-100 space-y-2">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-400">Contract</span>
                    <span className="font-mono text-zinc-500 text-[10px]">0x4a2f…8c3d</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-400">Network</span>
                    <span className="font-medium text-zinc-700">Base L2</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-400">Created</span>
                    <span className="font-medium text-zinc-700">Mar 18, 2026</span>
                  </div>
                </div>
              </div>

              {/* Smart Contract */}
              <div
                className="rounded-2xl p-7 flex flex-col"
                style={{
                  background: "linear-gradient(145deg, hsl(221 83% 28%) 0%, hsl(217 91% 50%) 100%)",
                  boxShadow: "0 4px 24px hsl(217 91% 48% / 0.3)",
                }}
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-blue-200">Smart Contract</span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">
                    <Lock className="h-4 w-4 text-white" />
                  </div>
                </div>
                <p className="text-blue-200 text-xs mb-0.5">Total locked</p>
                <p className="text-3xl font-bold text-white tracking-tight">$12,000 <span className="text-base font-medium text-blue-300">USDC</span></p>
                <div className="mt-4 space-y-3 flex-1">
                  <div>
                    <div className="flex justify-between text-[11px] text-blue-200 mb-1.5">
                      <span>Released</span>
                      <span>1 of 3 milestones</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-white/20">
                      <div className="h-1.5 rounded-full bg-white" style={{ width: "33%" }} />
                    </div>
                  </div>
                  <div className="space-y-2 pt-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-blue-200">Milestone 1</span>
                      <span className="text-white font-medium">$3,900 released</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-blue-200">Milestone 2</span>
                      <span className="text-blue-300">$4,200 locked</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-blue-200">Milestone 3</span>
                      <span className="text-blue-300">$3,900 locked</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-white/15 flex items-center gap-2">
                  <ArrowRight className="h-3 w-3 text-blue-300 shrink-0" />
                  <span className="text-[10px] text-blue-200">Funds release automatically on approval</span>
                </div>
              </div>

              {/* Seller */}
              <div className="rounded-2xl border border-zinc-200 bg-white p-7 shadow-[0_2px_16px_rgba(0,0,0,0.06)] flex flex-col">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Seller</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    <span className="h-1 w-1 rounded-full bg-primary" />
                    Active
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mb-0.5">Studio Works</p>
                <p className="text-2xl font-bold tracking-tight text-zinc-900">$3,900 <span className="text-sm font-medium text-zinc-400">USDC</span></p>
                <div className="mt-3 pt-3 border-t border-zinc-100 space-y-2 flex-1">
                  <p className="text-[11px] text-zinc-400">Payment history</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-600">Milestone 1 — Design</span>
                    <span className="text-[11px] font-semibold text-emerald-600">+$3,900</span>
                  </div>
                  <p className="text-[10px] text-zinc-400">Sent to wallet · 2 days ago</p>
                </div>
                <div className="mt-4 pt-4 border-t border-zinc-100 space-y-2">
                  <p className="text-[11px] text-zinc-400">Next milestone</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-600">Milestone 2 — Development</span>
                    <span className="text-[11px] font-semibold text-primary">$4,200</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400">Awaiting approval</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                      <span className="h-1 w-1 rounded-full bg-amber-400" />
                      In review
                    </span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* See how it works — pinned to bottom of section */}
        <a
          href="#how-it-works"
          className="absolute bottom-6 left-1/2 -translate-x-1/2 inline-flex flex-col items-center gap-1 text-sm text-zinc-400 hover:text-zinc-700 transition-colors"
        >
          See how it works
          <ChevronDown className="h-4 w-4" />
        </a>
      </section>

      {/* ─── How It Works ─── */}
      <section id="how-it-works" className="py-36 border-t border-zinc-200" style={{ background: "hsl(220 15% 93%)" }}>
        <div className="container">
          <div className="mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-4">Simple Process</p>
            <h2 className="text-4xl lg:text-5xl font-bold tracking-tight">How it works.</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((s, i) => (
              <div key={s.num} className="rounded-2xl border border-border bg-white p-8">
                <div className="mb-5 flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white shrink-0" style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 6px hsl(217 91% 30% / 0.4)" }}>
                    {i + 1}
                  </div>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <s.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{s.title}</h3>
                <p className="text-sm text-zinc-600 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section className="py-32 border-t border-zinc-200 bg-white">
        <div className="container">
          <div className="mb-16">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-4">Platform</p>
            <h2 className="text-4xl lg:text-5xl font-bold tracking-tight text-zinc-900 mb-4">Why StablePay?</h2>
            <p className="text-zinc-600 max-w-lg text-base leading-relaxed">
              Every payment is transparent, programmable, and protected.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-zinc-200 p-8 hover:border-zinc-300 hover:shadow-sm transition-all duration-200 bg-white"
              >
                <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-zinc-900">{f.title}</h3>
                <p className="text-sm text-zinc-600 leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Pricing ─── */}
      <section id="pricing" className="py-32 border-t border-zinc-200" style={{ background: "hsl(220 15% 93%)" }}>
        <div className="container">
          <div className="mb-16">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-4">Transparent Pricing</p>
            <h2 className="text-4xl lg:text-5xl font-bold tracking-tight text-zinc-900">Simple, honest fees.</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-zinc-200 p-8 hover:border-zinc-300 hover:shadow-sm transition-all duration-200 bg-white">
              <div className="flex items-baseline mb-1">
                <span className="text-5xl font-bold tracking-tight text-zinc-900">2.5%</span>
              </div>
              <p className="text-sm font-semibold text-zinc-900 mb-4">Platform fee — per approved milestone</p>
              <p className="text-sm text-zinc-600 leading-relaxed mb-5">
                Charged only when the buyer approves a completed milestone. The seller receives <strong>97.5%</strong> of the milestone amount instantly to their wallet. No setup fees, no subscriptions, no hidden costs.
              </p>
              <ul className="space-y-2">
                {[
                  "Deducted automatically by the smart contract",
                  "No charge until work is approved",
                  "Seller paid directly — no intermediary holds funds",
                  "No monthly fees or platform subscriptions",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-zinc-600">
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-zinc-200 p-8 hover:border-zinc-300 hover:shadow-sm transition-all duration-200 bg-white">
              <div className="flex items-baseline mb-1">
                <span className="text-5xl font-bold tracking-tight text-zinc-900">+1%</span>
              </div>
              <p className="text-sm font-semibold text-zinc-900 mb-4">Dispute resolution fee — only if escalated</p>
              <p className="text-sm text-zinc-600 leading-relaxed mb-5">
                If a dispute cannot be resolved between buyer and seller within the 7-day correction window, StablePay steps in as arbitrator. A 1% fee (total 3.5%) is added to cover platform review and fair resolution.
              </p>
              <ul className="space-y-2">
                {[
                  "Seller has 7 days to correct before escalation",
                  "Platform reviews evidence from both parties",
                  "Funds split fairly based on delivered work",
                  "Standard approvals always cost just 2.5%",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-zinc-600">
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Security ─── */}
      <section className="py-36 border-t border-zinc-200 bg-white">
        <div className="container">
          <div className="grid lg:grid-cols-2 gap-20 lg:gap-32 items-center max-w-5xl">
            {/* Text */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-4">Security</p>
              <h2 className="text-4xl lg:text-5xl font-bold tracking-tight mb-6 leading-[1.07]">
                Your funds.<br />Your control.
              </h2>
              <p className="text-zinc-600 leading-relaxed mb-10 text-sm">
                Funds are locked in smart contracts on Base and can only be released under predefined conditions.
                If a dispute arises, StablePay arbitrates fairly — transparently, on-chain.
              </p>
              <ul className="space-y-5">
                {[
                  "Funds locked by code — released only on approval or dispute resolution",
                  "Verifiable on Base — every contract is publicly auditable",
                  "On-chain transparency for every transaction",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-zinc-600">
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            {/* Visual: Escrow contract mockup card */}
            <div className="flex items-center justify-center">
              <div className="w-full max-w-sm">
                {/* Main card */}
                <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.07)]">
                  <div className="mb-5 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Funds Secured
                    </span>
                    <Lock className="h-4 w-4 text-zinc-400" />
                  </div>

                  <p className="text-xs font-medium text-zinc-500 mb-1">Total locked in escrow</p>
                  <p className="text-3xl font-bold tracking-tight text-zinc-900">
                    $24,500 <span className="text-base font-semibold text-zinc-400">USDC</span>
                  </p>

                  <div className="mt-4 mb-1 flex justify-between text-xs text-zinc-500">
                    <span>Milestone 2 of 4</span>
                    <span>50% complete</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-zinc-100">
                    <div className="h-1.5 w-1/2 rounded-full bg-primary" />
                  </div>

                  <div className="my-5 border-t border-zinc-100" />

                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Contract</span>
                      <span className="rounded bg-zinc-50 px-2 py-0.5 font-mono text-[10px] text-zinc-700">0x4a2f…8c3d</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Network</span>
                      <span className="font-semibold text-zinc-800">Base L2</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Release condition</span>
                      <span className="font-semibold text-emerald-600">Approval or arbitration</span>
                    </div>
                  </div>
                </div>

                {/* Two security badges below */}
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-2.5 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Shield className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-zinc-900">Escrow-secured</p>
                      <p className="text-[10px] text-zinc-500">Locked by smart contract</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-zinc-900">Verifiable on Base</p>
                      <p className="text-[10px] text-zinc-500">Publicly auditable</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="py-32 border-t border-zinc-200" style={{ background: "hsl(220 15% 93%)" }}>
        <div className="container">
          <div className="flex flex-col items-center text-center">
            <h2 className="font-bold tracking-tight mb-6 leading-[1.04]" style={{ fontSize: "clamp(2.4rem, 6vw, 4.5rem)" }}>
              Ready to get started?
            </h2>
            <p className="text-zinc-600 mb-10 leading-relaxed max-w-md">
              Create your first escrow project in under a minute. Connect your wallet, define milestones, and go.
            </p>
            {ctaHref ? (
              <Link
                href={ctaHref}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-9 py-4 text-sm font-semibold text-white transition-all hover:bg-zinc-700"
              >
                {ctaLabel} <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <button
                onClick={openConnectModal}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-9 py-4 text-sm font-semibold text-white transition-all hover:bg-zinc-700"
              >
                Connect Wallet <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-zinc-200 bg-white">
        <div className="w-full px-8 h-16 flex items-center gap-4 text-sm text-zinc-500">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0"
            style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 8px hsl(217 91% 30% / 0.45), inset 0 1px 0 hsl(210 100% 80% / 0.15)" }}
          >
            <Shield className="h-5 w-5 text-primary-foreground" />
          </div>
          <span>© 2026 StablePay</span>
          <span>•</span>
          <a href="/privacy" className="hover:text-zinc-900 transition-colors">Privacy</a>
          <span>•</span>
          <a href="/terms" className="hover:text-zinc-900 transition-colors">Terms of Service</a>
        </div>
      </footer>

    </div>
  );
}
