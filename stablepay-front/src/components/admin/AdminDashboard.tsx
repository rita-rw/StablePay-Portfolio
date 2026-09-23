"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useReadContracts, useWalletClient } from "wagmi";
import { type Abi, formatUnits } from "viem";
import { fetchAdminProjects } from "@/services/projects";
import { getMilestoneStatus } from "@/lib/formatters";
import type { Escrow } from "@/types/escrow";
import StablePayEscrowABI from "@/abi/StablePayEscrow.json";
import { Shield, AlertTriangle, Layers, ArrowRight, CheckCircle2 } from "lucide-react";

const abi = StablePayEscrowABI.abi as Abi;

export default function AdminDashboard() {
  const { data: walletClient } = useWalletClient();
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!walletClient) return;
    fetchAdminProjects(walletClient)
      .then(setEscrows)
      .catch(() => setEscrows([]))
      .finally(() => setLoading(false));
  }, [walletClient]);

  // On-chain reads for all escrows
  const contracts = useMemo(() => {
    if (escrows.length === 0) return [];
    const calls: { address: `0x${string}`; abi: Abi; functionName: string; args?: readonly [bigint] }[] = [];
    for (const e of escrows) {
      const addr = e.id as `0x${string}`;
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

  const stats = useMemo(() => {
    const result = { total: escrows.length, active: 0, completed: 0, disputed: 0, totalUSDC: BigInt(0) };
    if (!onChainData || escrows.length === 0) return result;

    let idx = 0;
    for (const e of escrows) {
      const funded = onChainData[idx]?.result as boolean ?? false; idx++;
      const cancelled = onChainData[idx]?.result as boolean ?? false; idx++;
      const milestoneStatuses: string[] = [];
      for (let i = 0; i < e.milestoneCount; i++) {
        const r = onChainData[idx]?.result as [bigint, number, string, bigint, string, bigint, string] | undefined;
        if (r) {
          const s = getMilestoneStatus(Number(r[1]));
          milestoneStatuses.push(s);
          if (s === "DISPUTED") result.disputed++;
        }
        idx++;
      }
      const allPaid = milestoneStatuses.length > 0 && milestoneStatuses.every((s) => s === "PAID");
      if (cancelled) { /* skip */ }
      else if (allPaid) result.completed++;
      else if (funded) result.active++;
      result.totalUSDC += BigInt(e.totalAmount);
    }
    return result;
  }, [onChainData, escrows]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading admin dashboard...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-4xl px-4 py-12">
        {/* Welcome */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold">Platform Overview</h1>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">Admin</span>
          </div>
          <p className="text-muted-foreground">
            Monitor all escrow activity across StablePay.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          <div className="glass rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Layers className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Total Projects</span>
            </div>
            <p className="text-2xl font-bold">{stats.total}</p>
          </div>
          <div className="glass rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="h-4 w-4 text-green-400" />
              <span className="text-xs text-muted-foreground">Active</span>
            </div>
            <p className="text-2xl font-bold">{stats.active}</p>
          </div>
          <div className="glass rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-4 w-4 text-purple-400" />
              <span className="text-xs text-muted-foreground">Closed</span>
            </div>
            <p className="text-2xl font-bold">{stats.completed}</p>
          </div>
          <div className="glass rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <span className="text-xs text-muted-foreground">Active Disputes</span>
            </div>
            <p className="text-2xl font-bold">{stats.disputed}</p>
          </div>
        </div>

        {/* Total volume */}
        <div className="glass rounded-xl p-6 mb-12">
          <p className="text-sm text-muted-foreground mb-1">Total Platform Volume</p>
          <p className="text-3xl font-bold">{formatUnits(stats.totalUSDC, 6)} <span className="text-lg text-muted-foreground">USDC</span></p>
        </div>

        {/* Quick actions */}
        <div className="grid md:grid-cols-2 gap-4">
          <Link
            href="/projects"
            className="glass rounded-xl p-6 hover:border-primary/30 transition-all group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold mb-1 group-hover:text-primary transition-colors">All Projects</h3>
                <p className="text-sm text-muted-foreground">View and manage all escrow contracts</p>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </Link>
          <Link
            href="/dispute-management"
            className="glass rounded-xl p-6 hover:border-red-500/30 transition-all group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold mb-1 group-hover:text-red-400 transition-colors">Dispute Management</h3>
                <p className="text-sm text-muted-foreground">
                  {stats.disputed > 0
                    ? `${stats.disputed} active dispute${stats.disputed !== 1 ? "s" : ""} need attention`
                    : "No active disputes"}
                </p>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-red-400 transition-colors" />
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
