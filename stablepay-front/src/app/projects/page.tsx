"use client";

import { useAccount, useWalletClient, useReadContracts } from "wagmi";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { formatUnits } from "viem";
import StablePayEscrowABI from "@/abi/StablePayEscrow.json";
import { fetchUserProjects, fetchAdminProjects } from "@/services/projects";
import { PLATFORM_ADDRESS } from "@/lib/constants";
import { getMilestoneStatus, getDisplayStatus, statusBadge, decodeTitle } from "@/lib/formatters";
import type { Escrow } from "@/types/escrow";

type Tab = "active" | "completed" | "all";
const ITEMS_PER_PAGE = 6;

export default function ProjectsPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const isPlatform = !!(address && PLATFORM_ADDRESS && address.toLowerCase() === PLATFORM_ADDRESS.toLowerCase());
  const [mounted, setMounted] = useState(false);
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("active");
  const [page, setPage] = useState(1);
  useEffect(() => setMounted(true), []);

  const fetchProjects = useCallback(async () => {
    if (!isConnected || !address) return;
    if (isPlatform && !walletClient) return;

    setLoading(true);
    setError(null);

    try {
      const data = isPlatform && walletClient
        ? await fetchAdminProjects(walletClient)
        : await fetchUserProjects(address, walletClient ?? undefined);
      setEscrows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch projects");
    } finally {
      setLoading(false);
    }
  }, [address, isConnected, isPlatform, walletClient]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Read on-chain status for all escrows + milestones in a single multicall
  const contracts = useMemo(() => {
    if (escrows.length === 0) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const abi = StablePayEscrowABI.abi as any;
    const calls: { address: `0x${string}`; abi: unknown; functionName: string; args?: readonly [bigint] }[] = [];
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contracts: contracts as any,
    query: { enabled: contracts.length > 0 },
  });

  // Map on-chain results back to escrow IDs
  const onChainMap = useMemo(() => {
    if (!onChainData || onChainData.length === 0) return new Map<string, { sellerAccepted: boolean; funded: boolean; cancelled: boolean; hasDispute: boolean; allPaid: boolean; hasSubmitted: boolean }>();
    const map = new Map<string, { sellerAccepted: boolean; funded: boolean; cancelled: boolean; hasDispute: boolean; allPaid: boolean; hasSubmitted: boolean }>();
    let idx = 0;
    for (const e of escrows) {
      const sellerAccepted = Boolean(onChainData[idx]?.result); idx++;
      const funded = Boolean(onChainData[idx]?.result); idx++;
      const cancelled = Boolean(onChainData[idx]?.result); idx++;
      let hasDispute = false;
      let allPaid = e.milestoneCount > 0;
      let hasSubmitted = false;
      for (let i = 0; i < e.milestoneCount; i++) {
        const result = onChainData[idx]?.result as [bigint, number, string, bigint, string, bigint, string] | undefined;
        if (result) {
          const status = getMilestoneStatus(Number(result[1]));
          if (status === "DISPUTED") hasDispute = true;
          if (status !== "PAID" && status !== "RESOLVED" && status !== "REFUNDED") allPaid = false;
          if (status === "SUBMITTED" || status === "DISPUTED" || status === "RESOLVED" || status === "PAID") hasSubmitted = true;
        } else {
          allPaid = false;
        }
        idx++;
      }
      map.set(e.id.toLowerCase(), { sellerAccepted, funded, cancelled, hasDispute, allPaid, hasSubmitted });
    }
    return map;
  }, [onChainData, escrows]);

  // Enrich escrows with on-chain status
  const enrichedEscrows = useMemo(() => {
    return escrows.map((escrow) => {
      const onChain = onChainMap.get(escrow.id.toLowerCase());
      const displayStatus = getDisplayStatus(escrow.status, onChain);
      return { escrow, displayStatus, onChain };
    });
  }, [escrows, onChainMap]);

  /** Latest milestone payment/settlement time, else createdAt — used to surface recently finished projects. */
  function completionSortTime(escrow: Escrow): number {
    const paidTimes = (escrow.milestones ?? [])
      .map((m) => (m.paidAt ? new Date(m.paidAt).getTime() : 0))
      .filter((t) => t > 0);
    if (paidTimes.length > 0) return Math.max(...paidTimes);
    return new Date(escrow.createdAt).getTime();
  }

  function formatCardDate(ms: number): string {
    return new Date(ms).toLocaleDateString("sv-SE", { day: "numeric", month: "short", year: "numeric" });
  }

  function listDateLabel(escrow: Escrow, displayStatus: string): string {
    const created = formatCardDate(new Date(escrow.createdAt).getTime());
    const isClosed =
      displayStatus === "COMPLETED" ||
      displayStatus === "CANCELLED" ||
      displayStatus === "SELLER_REJECTED";
    if (!isClosed) return `Created ${created}`;
    return `Created ${created} · Closed ${formatCardDate(completionSortTime(escrow))}`;
  }

  // Filter by tab
  const ACTIVE_STATUSES = ["CREATED", "SELLER_ACCEPTED", "FUNDED", "IN_PROGRESS"];
  const COMPLETED_STATUSES = ["COMPLETED", "CANCELLED", "SELLER_REJECTED"];

  const filtered = useMemo(() => {
    let list = enrichedEscrows;
    if (activeTab === "active") list = enrichedEscrows.filter((e) => ACTIVE_STATUSES.includes(e.displayStatus));
    else if (activeTab === "completed") list = enrichedEscrows.filter((e) => COMPLETED_STATUSES.includes(e.displayStatus));

    // Closed: newest finished first (not oldest created). Active/All keep API createdAt order.
    if (activeTab === "completed") {
      return [...list].sort((a, b) => completionSortTime(b.escrow) - completionSortTime(a.escrow));
    }
    return list;
  }, [enrichedEscrows, activeTab]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  // Reset page when tab changes
  useEffect(() => setPage(1), [activeTab]);

  // Tab counts
  const activeCount = enrichedEscrows.filter((e) => ACTIVE_STATUSES.includes(e.displayStatus)).length;
  const completedCount = enrichedEscrows.filter((e) => COMPLETED_STATUSES.includes(e.displayStatus)).length;

  useEffect(() => {
    if (mounted && !isConnected) router.replace("/");
  }, [mounted, isConnected, router]);

  if (!mounted || !isConnected) {
    return null;
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "active", label: "Active", count: activeCount },
    { key: "completed", label: "Closed", count: completedCount },
    { key: "all", label: "All", count: enrichedEscrows.length },
  ];

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-4xl px-4 py-12">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{isPlatform ? "All Client Projects" : "My Escrows"}</h1>
          <div className="flex items-center gap-3">
            {!isPlatform && (
              <Link
                href="/projects/new"
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all hover:brightness-110"
                style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 8px hsl(217 91% 30% / 0.35)" }}
              >
                + New Project
              </Link>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1">
          {tabs.map((tab) => (
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

        {loading && <p className="text-zinc-500">Loading projects...</p>}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-600">Error: {error}</p>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-10 text-center">
            <p className="text-zinc-500">
              {escrows.length === 0 ? "No projects found for this address." : "No projects in this category."}
            </p>
          </div>
        )}

        {paginated.length > 0 && (
          <div className="flex flex-col gap-3">
            {paginated.map(({ escrow, displayStatus, onChain }) => {
              const badge = statusBadge(displayStatus);
              const hasActiveDispute = isPlatform && (onChain?.hasDispute || escrow.milestones?.some((m) => m.status === "DISPUTED" || m.status === "ESCALATED"));

              const cardInner = (
                <>
                  <div className="mb-2 flex items-start justify-between gap-4">
                    <div>
                      <span className="font-semibold text-zinc-900 group-hover:text-primary transition-colors">
                        {decodeTitle(escrow.title || "Untitled Project")}
                      </span>
                      <p className="font-mono text-xs text-zinc-400 mt-0.5">
                        {escrow.id.slice(0, 6)}...{escrow.id.slice(-4)}
                        <span className="ml-3 not-italic font-sans">
                          {listDateLabel(escrow, displayStatus)}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {hasActiveDispute && (
                        <span className="rounded-full bg-red-50 border border-red-200 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                          DISPUTED
                        </span>
                      )}
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.color}`}>
                        {badge.label}
                      </span>
                      <span className="text-xs text-zinc-700">
                        {escrow.milestoneCount} milestone{escrow.milestoneCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-zinc-100 flex items-center justify-between">
                    <p className="text-xs text-zinc-700">
                      {escrow.buyerCompany ?? `${escrow.buyer.slice(0, 6)}...${escrow.buyer.slice(-4)}`}{" "}
                      <span className="text-zinc-400">&rarr;</span>{" "}
                      {escrow.sellerCompany ?? `${escrow.seller.slice(0, 6)}...${escrow.seller.slice(-4)}`}
                    </p>
                    <p className="text-xs text-zinc-700">
                      <span className="font-semibold text-zinc-900">{formatUnits(BigInt(escrow.totalAmount), 6)}</span>{" "}
                      <span className="text-zinc-700">USDC</span>
                    </p>
                  </div>
                </>
              );

              if (hasActiveDispute) {
                return (
                  <div
                    key={escrow.id}
                    onClick={() => router.push(`/projects/${escrow.id}`)}
                    className="cursor-pointer rounded-2xl border border-red-200 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)] transition-all hover:border-red-300 hover:shadow-md group"
                  >
                    <div className="mb-2 flex items-start justify-between gap-4">
                      <div>
                        <span className="font-semibold text-zinc-900 group-hover:text-primary transition-colors">
                          {decodeTitle(escrow.title || "Untitled Project")}
                        </span>
                        <p className="font-mono text-xs text-zinc-400 mt-0.5">
                          {escrow.id.slice(0, 6)}...{escrow.id.slice(-4)}
                          <span className="ml-3 not-italic font-sans">
                            {listDateLabel(escrow, displayStatus)}
                          </span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="rounded-full bg-red-50 border border-red-200 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                          DISPUTED
                        </span>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.color}`}>
                          {badge.label}
                        </span>
                        <span className="text-xs text-zinc-700">
                          {escrow.milestoneCount} milestone{escrow.milestoneCount !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-zinc-100 flex items-center justify-between">
                      <p className="text-xs text-zinc-700">
                        {escrow.buyerCompany ?? `${escrow.buyer.slice(0, 6)}...${escrow.buyer.slice(-4)}`}{" "}
                        <span className="text-zinc-400">&rarr;</span>{" "}
                        {escrow.sellerCompany ?? `${escrow.seller.slice(0, 6)}...${escrow.seller.slice(-4)}`}
                      </p>
                      <div className="flex items-center gap-3">
                        <p className="text-xs text-zinc-700">
                          <span className="font-semibold text-zinc-900">{formatUnits(BigInt(escrow.totalAmount), 6)}</span>{" "}
                          <span className="text-zinc-700">USDC</span>
                        </p>
                        <Link
                          href={`/dispute-management/${escrow.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors whitespace-nowrap"
                        >
                          Review Case →
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <Link
                  key={escrow.id}
                  href={`/projects/${escrow.id}`}
                  className="rounded-2xl border border-zinc-300 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)] transition-all hover:border-zinc-400 hover:shadow-md group"
                >
                  {cardInner}
                </Link>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-xl border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 disabled:opacity-40 hover:bg-zinc-50 transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-zinc-500">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded-xl border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 disabled:opacity-40 hover:bg-zinc-50 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
