"use client";

import { useAccount, useWalletClient } from "wagmi";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { formatUnits } from "viem";
import { fetchUserProjects, fetchAdminProjects } from "@/services/projects";
import { PLATFORM_ADDRESS } from "@/lib/constants";
import { getDisplayStatus, statusBadge, decodeTitle, formatDate } from "@/lib/formatters";
import type { Escrow } from "@/types/escrow";
import { useMounted } from "@/hooks/useMounted";
import { useEscrowStatuses } from "@/hooks/useEscrowStatuses";

type Tab = "active" | "completed" | "all";
const ITEMS_PER_PAGE = 6;
const ACTIVE_STATUSES = ["CREATED", "SELLER_ACCEPTED", "FUNDED", "IN_PROGRESS"];
const COMPLETED_STATUSES = ["COMPLETED", "CANCELLED", "SELLER_REJECTED"];

function tabFromSearch(value: string | null): Tab {
  if (value === "closed" || value === "completed") return "completed";
  if (value === "all") return "all";
  return "active";
}

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsList />
    </Suspense>
  );
}

function ProjectsList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = tabFromSearch(searchParams.get("tab"));
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const isPlatform = !!(address && PLATFORM_ADDRESS && address.toLowerCase() === PLATFORM_ADDRESS.toLowerCase());
  const mounted = useMounted();
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  function selectTab(tab: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "active") params.delete("tab");
    else params.set("tab", tab === "completed" ? "closed" : "all");
    const query = params.toString();
    router.replace(query ? `/projects?${query}` : "/projects", { scroll: false });
  }

  const fetchProjects = useCallback(async () => {
    if (!isConnected || !address || !walletClient) return;

    setLoading(true);
    setError(null);

    try {
      const data = isPlatform
        ? await fetchAdminProjects(walletClient)
        : await fetchUserProjects(address, walletClient);
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
  const { statuses } = useEscrowStatuses(escrows);

  // Summarise each escrow's on-chain status for the project cards
  const onChainMap = useMemo(() => {
    const map = new Map<string, { sellerAccepted: boolean; funded: boolean; cancelled: boolean; hasDispute: boolean; allPaid: boolean; hasSubmitted: boolean }>();
    if (!statuses) return map;
    for (const e of escrows) {
      const s = statuses.get(e.id.toLowerCase());
      if (!s) continue;
      let hasDispute = false;
      let allPaid = e.milestoneCount > 0;
      let hasSubmitted = false;
      for (const m of s.milestones) {
        if (!m) {
          allPaid = false;
          continue;
        }
        if (m.status === "DISPUTED") hasDispute = true;
        if (m.status !== "PAID" && m.status !== "RESOLVED" && m.status !== "REFUNDED") allPaid = false;
        if (m.status === "SUBMITTED" || m.status === "DISPUTED" || m.status === "RESOLVED" || m.status === "PAID") hasSubmitted = true;
      }
      map.set(e.id.toLowerCase(), { sellerAccepted: s.sellerAccepted, funded: s.funded, cancelled: s.cancelled, hasDispute, allPaid, hasSubmitted });
    }
    return map;
  }, [statuses, escrows]);

  // Enrich escrows with on-chain status
  const enrichedEscrows = useMemo(() => {
    return escrows.map((escrow) => {
      const onChain = onChainMap.get(escrow.id.toLowerCase());
      const displayStatus = getDisplayStatus(escrow.status, onChain, escrow.milestones, escrow.milestoneCount);
      return { escrow, displayStatus, onChain };
    });
  }, [escrows, onChainMap]);

  /** Latest payment, or the cancel/reject time. createdAt only when neither exists. */
  function completionSortTime(escrow: Escrow): number {
    const paidTimes = (escrow.milestones ?? [])
      .map((m) => (m.paidAt ? new Date(m.paidAt).getTime() : 0))
      .filter((t) => t > 0);
    const paid = paidTimes.length > 0 ? Math.max(...paidTimes) : 0;
    const cancelled = escrow.cancelledAt ? new Date(escrow.cancelledAt).getTime() : 0;
    const best = Math.max(paid, cancelled);
    if (best > 0) return best;
    return new Date(escrow.createdAt).getTime();
  }

  function formatCardDate(ms: number): string {
    return formatDate(ms);
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

  const filtered = useMemo(() => {
    let list = enrichedEscrows;
    if (activeTab === "active") list = enrichedEscrows.filter((e) => ACTIVE_STATUSES.includes(e.displayStatus));
    else if (activeTab === "completed") list = enrichedEscrows.filter((e) => COMPLETED_STATUSES.includes(e.displayStatus));

    // Closed and All: newest finished first. Active keeps the API createdAt order.
    if (activeTab === "completed" || activeTab === "all") {
      return [...list].sort((a, b) => completionSortTime(b.escrow) - completionSortTime(a.escrow));
    }
    return list;
  }, [enrichedEscrows, activeTab]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  // Reset page when tab changes
  const [prevTab, setPrevTab] = useState(activeTab);
  if (activeTab !== prevTab) {
    setPrevTab(activeTab);
    setPage(1);
  }

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
    <div className="bg-white">
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
              onClick={() => selectTab(tab.key)}
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

        {(loading || !walletClient) && escrows.length === 0 && (
          <p className="text-zinc-500">Loading projects...</p>
        )}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-600">Error: {error}</p>
          </div>
        )}

        {!loading && walletClient && !error && filtered.length === 0 && (
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
