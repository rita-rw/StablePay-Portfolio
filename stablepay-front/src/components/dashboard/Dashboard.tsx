"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useAccount, useWalletClient } from "wagmi";
import { formatUnits } from "viem";
import { useUser } from "@/hooks/useUser";
import { useEscrowStatuses, type EscrowStatus } from "@/hooks/useEscrowStatuses";
import { fetchUserProjects } from "@/services/projects";
import { SignatureDeclinedError } from "@/lib/authFetch";
import { deriveProjectStatus, decodeTitle, calcFeeBase, shortAddr } from "@/lib/formatters";
import { PLATFORM_FEE_BPS } from "@/lib/constants";
import type { Escrow } from "@/types/escrow";
import { Wallet, ArrowDownLeft, Plus, ArrowRight, Clock, CheckCircle2, AlertTriangle } from "lucide-react";

type TodoAction = "review" | "dispute" | "fund" | "accept" | "submit";

const ACTION_LABEL: Record<TodoAction, string> = {
  review: "Review delivery",
  dispute: "Respond to dispute",
  fund: "Fund project",
  accept: "Accept project",
  submit: "Submit delivery",
};

const ACTION_RANK: Record<TodoAction, number> = {
  review: 0,
  dispute: 1,
  fund: 2,
  accept: 3,
  submit: 4,
};


const escrowCache = new Map<string, Escrow[]>();
let chainCache: { key: string; statuses: Map<string, EscrowStatus> } | null = null;

function chainKey(list: Escrow[]): string {
  return list.map((escrow) => `${escrow.id.toLowerCase()}:${escrow.milestoneCount}`).join("|");
}

/** Seller's net on a released amount. Same 2.5% split as the payment receipt. */
function sellerNet(base: bigint): bigint {
  return base - calcFeeBase(base, PLATFORM_FEE_BPS);
}

export default function Dashboard() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { user } = useUser();
  const cachedEscrows = address ? escrowCache.get(address.toLowerCase()) : undefined;
  const [escrows, setEscrows] = useState<Escrow[]>(cachedEscrows ?? []);
  const [loading, setLoading] = useState(cachedEscrows === undefined);
  // True when the user closed the MetaMask signature request — the list is then unknown, not empty
  const [signatureDeclined, setSignatureDeclined] = useState(false);

  useEffect(() => {
    if (!address || !walletClient) return;
    let cancelled = false;
    const key = address.toLowerCase();
    if (!escrowCache.has(key)) setLoading(true);
    fetchUserProjects(address, walletClient)
      .then((data) => {
        if (cancelled) return;
        escrowCache.set(key, data);
        setEscrows(data);
        setSignatureDeclined(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setEscrows([]);
        setSignatureDeclined(err instanceof SignatureDeclinedError);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, walletClient]);

  // On-chain status reads
  const { statuses, isError: chainError } = useEscrowStatuses(escrows);

  const chainKeyForEscrows = chainKey(escrows);
  const chainStatuses = statuses ?? (chainCache?.key === chainKeyForEscrows ? chainCache.statuses : undefined);

  // Save the latest on-chain reads so the dashboard can show them instantly
  // next time. Done in an effect, not during render, because render must not
  // change anything outside the component.
  useEffect(() => {
    if (statuses && escrows.length > 0) {
      chainCache = { key: chainKeyForEscrows, statuses };
    }
  }, [statuses, escrows.length, chainKeyForEscrows]);

  const chainProjects = useMemo(() => {
    if (!chainStatuses || escrows.length === 0) return [];
    const me = address?.toLowerCase();
    const enriched: {
      escrow: Escrow;
      status: string;
      role: string;
      hasDispute: boolean;
      paidOut: bigint;
      received: bigint;
      action: TodoAction | null;
    }[] = [];
    for (const e of escrows) {
      const onChain = chainStatuses.get(e.id.toLowerCase());
      if (!onChain) continue;
      const { sellerAccepted, funded, cancelled } = onChain;
      const milestoneStatuses: string[] = [];
      let hasDispute = false;
      let paidOut = BigInt(0);
      let received = BigInt(0);
      const isBuyer = e.buyer.toLowerCase() === me;
      const isSeller = e.seller.toLowerCase() === me;
      for (let i = 0; i < onChain.milestones.length; i++) {
        const m = onChain.milestones[i];
        if (!m) continue;
        const s = m.status;
        milestoneStatuses.push(s);
        if (s === "DISPUTED") hasDispute = true;
        const row = e.milestones?.find((dbRow) => dbRow.milestoneIndex === i);
        if (isBuyer) {
          if (s === "PAID") paidOut += m.amount;
          else if (s === "RESOLVED" && row?.sellerAward) paidOut += BigInt(row.sellerAward);
        }
        if (isSeller) {
          if (s === "RESOLVED" && row?.sellerAward) received += sellerNet(BigInt(row.sellerAward));
          else if (s === "PAID") {
            const base = row?.disputeOpenedAt != null && row.sellerAward ? BigInt(row.sellerAward) : m.amount;
            received += sellerNet(base);
          }
        }
      }
      const status = deriveProjectStatus(funded, cancelled, sellerAccepted, milestoneStatuses);
      let action: TodoAction | null = null;
      if (!cancelled && me) {
        if (isBuyer && milestoneStatuses.includes("SUBMITTED")) action = "review";
        else if (isSeller && milestoneStatuses.includes("DISPUTED")) action = "dispute";
        else if (isBuyer && sellerAccepted && !funded) action = "fund";
        else if (isSeller && !sellerAccepted) action = "accept";
        else if (isSeller && funded && milestoneStatuses.includes("PENDING")) action = "submit";
      }
      enriched.push({
        escrow: e,
        status,
        role: isBuyer ? "Buyer" : "Seller",
        hasDispute,
        paidOut,
        received,
        action,
      });
    }
    return enriched;
  }, [chainStatuses, escrows, address]);

  const stats = useMemo(() => {
    const result = { active: 0, completed: 0, disputed: 0, paidOut: BigInt(0), received: BigInt(0) };
    for (const project of chainProjects) {
      if (project.status === "COMPLETED" || project.status === "CANCELLED" || project.status === "SELLER_REJECTED") result.completed++;
      else result.active++;
      if (project.hasDispute) result.disputed++;
      result.paidOut += project.paidOut;
      result.received += project.received;
    }
    return result;
  }, [chainProjects]);

  const todos = useMemo(() => {
    return chainProjects
      .filter((project) => project.action !== null)
      .sort((a, b) => {
        const rank = ACTION_RANK[a.action!] - ACTION_RANK[b.action!];
        if (rank !== 0) return rank;
        return new Date(b.escrow.createdAt).getTime() - new Date(a.escrow.createdAt).getTime();
      });
  }, [chainProjects]);

  if (loading || (escrows.length > 0 && !chainStatuses && !chainError)) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="text-zinc-500">Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="bg-white">
      <div className="mx-auto max-w-4xl px-4 py-12">
        {/* Welcome */}
        <div className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-2">Dashboard</p>
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
              Welcome back, {user?.companyName ?? "User"}
            </h1>
            <Link
              href="/projects/new"
              className="inline-flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110"
              style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 8px hsl(217 91% 30% / 0.35)" }}
            >
              <Plus className="h-4 w-4" /> Create Project
            </Link>
          </div>
          <p className="text-zinc-500 text-sm mt-1">
            Here&apos;s an overview of your escrow activity on StablePay.
          </p>
        </div>

        {/* Stats */}
        <div className="mb-10 flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-4">
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
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl border border-zinc-300 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
              <div className="flex items-center gap-2 mb-3">
                <Wallet className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium text-zinc-500">Paid out</span>
              </div>
              <p className="text-2xl font-bold leading-tight text-zinc-900 tabular-nums whitespace-nowrap">
                {formatUnits(stats.paidOut, 6)}
              </p>
              <p className="mt-1 text-sm font-normal text-zinc-400">USDC</p>
            </div>
            <div className="rounded-2xl border border-zinc-300 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
              <div className="flex items-center gap-2 mb-3">
                <ArrowDownLeft className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium text-zinc-500">Received</span>
              </div>
              <p className="text-2xl font-bold leading-tight text-zinc-900 tabular-nums whitespace-nowrap">
                {formatUnits(stats.received, 6)}
              </p>
              <p className="mt-1 text-sm font-normal text-zinc-400">USDC</p>
            </div>
          </div>
        </div>

        {/* Tasks waiting on this wallet */}
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 mb-4">To do</h2>
          {todos.length === 0 ? (
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-10 text-center">
              {signatureDeclined ? (
                <p className="text-zinc-500">Sign the message above to see your projects.</p>
              ) : escrows.length === 0 ? (
                <>
                  <p className="text-zinc-500 mb-4">No projects yet. Create your first escrow to get started.</p>
                  <Link
                    href="/projects/new"
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    Create Project <ArrowRight className="h-4 w-4" />
                  </Link>
                </>
              ) : (
                <p className="text-zinc-500">Nothing needs your action right now.</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {todos.map(({ escrow, role, action }) => (
                <Link
                  key={escrow.id}
                  href={`/projects/${escrow.id}`}
                  className="rounded-2xl border border-zinc-300 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)] hover:border-zinc-400 hover:shadow-md transition-all group"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-semibold text-zinc-900 group-hover:text-primary transition-colors">
                        {escrow.title ? decodeTitle(escrow.title) : shortAddr(escrow.id)}
                      </p>
                      <p className="font-mono text-xs text-zinc-400 mt-0.5">
                        {shortAddr(escrow.id)}
                      </p>
                      <p className="text-sm text-zinc-700 mt-0.5">
                        {role} &middot; {escrow.milestoneCount} milestone{escrow.milestoneCount !== 1 ? "s" : ""} &middot; {formatUnits(BigInt(escrow.totalAmount), 6)} USDC
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                      {ACTION_LABEL[action!]}
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
