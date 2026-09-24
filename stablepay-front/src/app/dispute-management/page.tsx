"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAccount, useWalletClient, useReadContracts } from "wagmi";
import { useRouter } from "next/navigation";
import Link from "next/link";
import StablePayEscrowABI from "@/abi/StablePayEscrow.json";
import { fetchAdminProjects } from "@/services/projects";
import { PLATFORM_ADDRESS } from "@/lib/constants";
import { getMilestoneStatus, shortAddr, decodeTitle } from "@/lib/formatters";
import type { Escrow } from "@/types/escrow";

type ProjectGroup = {
  escrowAddress: string;
  title: string | null;
  buyer: string;
  seller: string;
  activeDisputeCount: number;
  resolvedDisputeCount: number;
  buyerCompany?: string | null;
  sellerCompany?: string | null;
  oldestDisputeAt: string | null;
  resolvedAt: string | null;
};

type Tab = "active" | "resolved";

export default function AdminPage() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [mounted, setMounted] = useState(false);
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("active");
  const router = useRouter();

  useEffect(() => setMounted(true), []);

  const fetchProjects = useCallback(async () => {
    if (!isConnected || !address || !walletClient || address.toLowerCase() !== PLATFORM_ADDRESS?.toLowerCase()) return;
    try {
      const data = await fetchAdminProjects(walletClient);
      setEscrows(Array.isArray(data) ? data : []);
    } catch {
      setEscrows([]);
    } finally {
      setLoading(false);
    }
  }, [isConnected, address, walletClient]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const contracts = useMemo(() => {
    if (escrows.length === 0) return [];
    const calls = [];
    for (const e of escrows) {
      const addr = e.id as `0x${string}`;
      for (let i = 0; i < e.milestoneCount; i++) {
        calls.push({ address: addr, abi: StablePayEscrowABI.abi as never, functionName: "milestones", args: [BigInt(i)] as const });
      }
    }
    return calls;
  }, [escrows]);

  const { data: onChainData } = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0 },
  });

  const projects = useMemo<ProjectGroup[]>(() => {
    if (!onChainData || onChainData.length === 0) return [];
    const result: ProjectGroup[] = [];
    let idx = 0;
    for (const e of escrows) {
      let activeDisputeCount = 0;
      let resolvedDisputeCount = 0;
      const disputeDates: string[] = [];
      for (let i = 0; i < e.milestoneCount; i++) {
        const r = onChainData[idx]?.result as [bigint, number, string, bigint, string, bigint, string] | undefined;
        if (r) {
          const status = getMilestoneStatus(Number(r[1]));
          const ts = Number(r[5]);
          const hadDispute = ts > 0;
          if (status === "DISPUTED") {
            activeDisputeCount++;
            if (hadDispute) disputeDates.push(new Date(ts * 1000).toISOString());
          } else if (status === "RESOLVED" || (hadDispute && (status === "PAID" || status === "REFUNDED"))) {
            resolvedDisputeCount++;
            if (hadDispute) disputeDates.push(new Date(ts * 1000).toISOString());
          }
        }
        idx++;
      }
      if (activeDisputeCount > 0 || resolvedDisputeCount > 0) {
        const oldestDisputeAt = disputeDates.length > 0
          ? disputeDates.reduce((a, b) => (a < b ? a : b))
          : null;
        const resolvedPaidDates = (e.milestones ?? [])
          .filter((m) => ["RESOLVED", "PAID", "REFUNDED"].includes(m.status) && m.paidAt)
          .map((m) => m.paidAt as string);
        const resolvedAt = resolvedPaidDates.length > 0
          ? resolvedPaidDates.reduce((a, b) => (a > b ? a : b))
          : null;
        result.push({
          escrowAddress: e.id,
          title: e.title ?? null,
          buyer: e.buyer,
          seller: e.seller,
          activeDisputeCount,
          resolvedDisputeCount,
          buyerCompany: e.buyerCompany ?? null,
          sellerCompany: e.sellerCompany ?? null,
          oldestDisputeAt,
          resolvedAt,
        });
      }
    }
    return result;
  }, [escrows, onChainData]);

  const activeProjects = projects.filter((p) => p.activeDisputeCount > 0);
  const resolvedProjects = projects
    .filter((p) => p.activeDisputeCount === 0 && p.resolvedDisputeCount > 0)
    .sort((a, b) => {
      const aAt = a.resolvedAt ? Date.parse(a.resolvedAt) : 0;
      const bAt = b.resolvedAt ? Date.parse(b.resolvedAt) : 0;
      return bAt - aAt; // newest closed first
    });
  const displayed = activeTab === "active" ? activeProjects : resolvedProjects;

  useEffect(() => {
    if (mounted && (!isConnected || address?.toLowerCase() !== PLATFORM_ADDRESS?.toLowerCase())) router.replace("/");
  }, [mounted, isConnected, address, router]);

  if (!mounted) return null;
  if (!isConnected || address?.toLowerCase() !== PLATFORM_ADDRESS?.toLowerCase()) return null;

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-8">
          <Link href="/projects" className="mb-6 inline-block text-sm text-zinc-500 hover:text-zinc-900 hover:underline">
            ← Back to Projects
          </Link>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Dispute Management</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {loading ? "Loading..." : `${activeProjects.length} active · ${resolvedProjects.length} resolved`}
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 rounded-xl border border-zinc-300 bg-zinc-50 p-1">
          {([
            { key: "active" as Tab, label: "Active Disputes", count: activeProjects.length },
            { key: "resolved" as Tab, label: "Resolved Disputes", count: resolvedProjects.length },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? "bg-white text-zinc-900 shadow-sm border border-zinc-200"
                  : "text-zinc-500 hover:text-zinc-900"
              }`}
            >
              {tab.label} <span className="ml-1 text-xs text-zinc-400">({tab.count})</span>
            </button>
          ))}
        </div>

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-zinc-200" />
            ))}
          </div>
        )}

        {!loading && displayed.length === 0 && (
          <div className="rounded-2xl border border-zinc-300 bg-white p-12 text-center shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
            <p className="text-lg font-medium text-zinc-900">
              {activeTab === "active" ? "No active disputes" : "No resolved disputes yet"}
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              {activeTab === "active" ? "All escrows are running smoothly." : "Resolved disputes will appear here."}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {displayed.map((project) => (
            <Link
              key={project.escrowAddress.toLowerCase()}
              href={`/dispute-management/${project.escrowAddress}`}
              className="rounded-2xl border border-zinc-300 bg-white px-5 py-4 shadow-[0_2px_12px_rgba(0,0,0,0.08)] transition-all hover:border-zinc-400 hover:shadow-md flex items-center justify-between group"
            >
              <div>
                <p className="font-semibold text-zinc-900 group-hover:text-primary transition-colors">
                  {project.title
                    ? decodeTitle(project.title)
                    : `${project.escrowAddress.slice(0, 6)}...${project.escrowAddress.slice(-4)}`}
                </p>
                <p className="mt-0.5 text-xs text-zinc-700">
                  {project.buyerCompany ?? shortAddr(project.buyer)}{" "}
                  <span className="text-zinc-400">&rarr;</span>{" "}
                  {project.sellerCompany ?? shortAddr(project.seller)}
                </p>
                {project.oldestDisputeAt && (
                  <p className="mt-0.5 text-xs text-red-600">
                    Dispute opened:{" "}
                    {new Date(project.oldestDisputeAt).toLocaleDateString("en-GB", {
                      day: "numeric", month: "short", year: "numeric",
                    })}
                  </p>
                )}
                {activeTab === "resolved" && project.resolvedAt && (
                  <p className="mt-0.5 text-xs text-emerald-600">
                    Closed:{" "}
                    {new Date(project.resolvedAt).toLocaleDateString("en-GB", {
                      day: "numeric", month: "short", year: "numeric",
                    })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {activeTab === "active" ? (
                  <span className="rounded-full bg-red-50 border border-red-200 px-3 py-1 text-xs font-semibold text-red-700">
                    {project.activeDisputeCount} dispute{project.activeDisputeCount !== 1 ? "s" : ""}
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700">
                    {project.resolvedDisputeCount} resolved
                  </span>
                )}
                <svg className="h-4 w-4 text-zinc-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
