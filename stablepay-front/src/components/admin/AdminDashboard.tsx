"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useWalletClient } from "wagmi";
import { formatUnits } from "viem";
import { fetchAdminProjects } from "@/services/projects";
import { deriveProjectStatus } from "@/lib/formatters";
import type { Escrow } from "@/types/escrow";
import { useEscrowStatuses } from "@/hooks/useEscrowStatuses";
import { Shield, AlertTriangle, Layers, ArrowRight, CheckCircle2 } from "lucide-react";

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
  const { statuses } = useEscrowStatuses(escrows);

  const stats = useMemo(() => {
    const result = { total: escrows.length, active: 0, completed: 0, disputed: 0, totalUSDC: BigInt(0) };
    if (!statuses || escrows.length === 0) return result;

    for (const e of escrows) {
      const s = statuses.get(e.id.toLowerCase());
      if (!s) continue;
      const milestoneStatuses: string[] = [];
      for (const m of s.milestones) {
        if (!m) continue;
        milestoneStatuses.push(m.status);
        if (m.status === "DISPUTED") result.disputed++;
      }
      // Same rule as the user dashboard: every milestone PAID, RESOLVED or REFUNDED
      const completed = deriveProjectStatus(s.funded, s.cancelled, s.sellerAccepted, milestoneStatuses) === "COMPLETED";
      if (s.cancelled) { /* skip */ }
      else if (completed) result.completed++;
      else if (s.funded) result.active++;
      result.totalUSDC += BigInt(e.totalAmount);
    }
    return result;
  }, [statuses, escrows]);

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
