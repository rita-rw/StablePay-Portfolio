"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useAccount, useReadContracts, useWalletClient } from "wagmi";
import { type Abi, formatUnits } from "viem";
import { useUser } from "@/hooks/useUser";
import { fetchUserProjects } from "@/services/projects";
import { deriveProjectStatus, getMilestoneStatus, decodeTitle } from "@/lib/formatters";
import type { Escrow } from "@/types/escrow";
import StablePayEscrowABI from "@/abi/StablePayEscrow.json";
import { Layers, Plus, ArrowRight, Clock, CheckCircle2, AlertTriangle } from "lucide-react";

const abi = StablePayEscrowABI.abi as Abi;

export default function Dashboard() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { user } = useUser();
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) return;
    fetchUserProjects(address, walletClient ?? undefined)
      .then(setEscrows)
      .catch(() => setEscrows([]))
      .finally(() => setLoading(false));
  }, [address, walletClient]);

  // On-chain status reads
  const contracts = useMemo(() => {
    if (escrows.length === 0) return [];
    const calls: { address: `0x${string}`; abi: Abi; functionName: string; args?: readonly [bigint] }[] = [];
    for (const e of escrows) {
      const addr = e.id as `0x${string}`;
      calls.push({ address: addr, abi, functionName: "sellerAccepted" });
      calls.push({ address: addr, abi, functionName: "funded" });
      calls.push({ address: addr, abi, functionName: "cancelled" });
      for (let i = 0; i < e.milestoneCount; i++) {
        calls.push({ address: addr, abi, functionName: "milestones", args: [BigInt(i)] });
      }
    }
    return calls;
  }, [escrows]);

  const { data: onChainData } = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0 },
  });

  // Derive stats from on-chain data
  const stats = useMemo(() => {
    const result = { active: 0, completed: 0, disputed: 0, totalUSDC: BigInt(0) };
    if (!onChainData || escrows.length === 0) return result;

    let idx = 0;
    for (const e of escrows) {
      const sellerAccepted = onChainData[idx]?.result as boolean ?? false; idx++;
      const funded = onChainData[idx]?.result as boolean ?? false; idx++;
      const cancelled = onChainData[idx]?.result as boolean ?? false; idx++;
      const milestoneStatuses: string[] = [];
      let hasDispute = false;
      for (let i = 0; i < e.milestoneCount; i++) {
        const r = onChainData[idx]?.result as [bigint, number, string, bigint, string, bigint, string] | undefined;
        if (r) {
          const s = getMilestoneStatus(Number(r[1]));
          milestoneStatuses.push(s);
          if (s === "DISPUTED") hasDispute = true;
        }
        idx++;
      }
      const status = deriveProjectStatus(funded, cancelled, sellerAccepted, milestoneStatuses);
      if (status === "COMPLETED") result.completed++;
      else if (status !== "CANCELLED") result.active++;
      if (hasDispute) result.disputed++;
      result.totalUSDC += BigInt(e.totalAmount);
    }
    return result;
  }, [onChainData, escrows]);

  // Recent projects (last 3)
  const recentProjects = useMemo(() => {
    if (!onChainData || escrows.length === 0) return [];

    const enriched: { escrow: Escrow; status: string; role: string }[] = [];
    let idx = 0;
    for (const e of escrows) {
      const sellerAccepted = onChainData[idx]?.result as boolean ?? false; idx++;
      const funded = onChainData[idx]?.result as boolean ?? false; idx++;
      const cancelled = onChainData[idx]?.result as boolean ?? false; idx++;
      const milestoneStatuses: string[] = [];
      for (let i = 0; i < e.milestoneCount; i++) {
        const r = onChainData[idx]?.result as [bigint, number, string, bigint, string, bigint, string] | undefined;
        if (r) milestoneStatuses.push(getMilestoneStatus(Number(r[1])));
        idx++;
      }
      const status = deriveProjectStatus(funded, cancelled, sellerAccepted, milestoneStatuses);
      const role = e.buyer.toLowerCase() === address?.toLowerCase() ? "Buyer" : "Seller";
      enriched.push({ escrow: e, status, role });
    }
    enriched.sort((a, b) => new Date(b.escrow.createdAt).getTime() - new Date(a.escrow.createdAt).getTime());
    return enriched.slice(0, 3);
  }, [onChainData, escrows, address]);

  const statusColor: Record<string, string> = {
    COMPLETED: "bg-purple-50 border border-purple-200 text-purple-700",
    IN_PROGRESS: "bg-amber-50 border border-amber-200 text-amber-700",
    FUNDED: "bg-emerald-50 border border-emerald-200 text-emerald-700",
    CREATED: "bg-zinc-50 border border-zinc-200 text-zinc-600",
    SELLER_ACCEPTED: "bg-blue-50 border border-blue-200 text-blue-700",
    CANCELLED: "bg-red-50 border border-red-200 text-red-700",
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-zinc-500">Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-4xl px-4 py-12">
        {/* Welcome */}
        <div className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-2">Dashboard</p>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 mb-1">
            Welcome back, {user?.companyName ?? "User"}
          </h1>
          <p className="text-zinc-500 text-sm">
            Here&apos;s an overview of your escrow activity on StablePay.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          <div className="rounded-2xl border border-zinc-300 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium text-zinc-500">Active</span>
            </div>
            <p className="text-2xl font-bold text-zinc-900">{stats.active}</p>
          </div>
          <div className="rounded-2xl border border-zinc-300 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="h-4 w-4 text-purple-500" />
              <span className="text-xs font-medium text-zinc-500">Closed</span>
            </div>
            <p className="text-2xl font-bold text-zinc-900">{stats.completed}</p>
          </div>
          <div className="rounded-2xl border border-zinc-300 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <span className="text-xs font-medium text-zinc-500">Disputed</span>
            </div>
            <p className="text-2xl font-bold text-zinc-900">{stats.disputed}</p>
          </div>
          <div className="rounded-2xl border border-zinc-300 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
            <div className="flex items-center gap-2 mb-3">
              <Layers className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium text-zinc-500">Total Volume</span>
            </div>
            <p className="text-2xl font-bold text-zinc-900">{formatUnits(stats.totalUSDC, 6)} <span className="text-sm font-normal text-zinc-400">USDC</span></p>
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex gap-3 mb-10">
          <Link
            href="/projects/new"
            className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110"
            style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 8px hsl(217 91% 30% / 0.35)" }}
          >
            <Plus className="h-4 w-4" /> Create Project
          </Link>
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-5 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            View All Projects <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {/* Recent projects */}
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 mb-4">Recent Projects</h2>
          {recentProjects.length === 0 ? (
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-10 text-center">
              <p className="text-zinc-500 mb-4">No projects yet. Create your first escrow to get started.</p>
              <Link
                href="/projects/new"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Create Project <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {recentProjects.map(({ escrow, status, role }) => (
                <Link
                  key={escrow.id}
                  href={`/projects/${escrow.id}`}
                  className="rounded-2xl border border-zinc-300 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)] hover:border-zinc-400 hover:shadow-md transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-zinc-900 group-hover:text-primary transition-colors">
                        {escrow.title ? decodeTitle(escrow.title) : `${escrow.id.slice(0, 6)}...${escrow.id.slice(-4)}`}
                      </p>
                      <p className="text-sm text-zinc-700 mt-0.5">
                        {role} &middot; {escrow.milestoneCount} milestone{escrow.milestoneCount !== 1 ? "s" : ""} &middot; {formatUnits(BigInt(escrow.totalAmount), 6)} USDC
                      </p>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${statusColor[status] ?? "text-zinc-500"}`}>
                      {status.replace("_", " ")}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
