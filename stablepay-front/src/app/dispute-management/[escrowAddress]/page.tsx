"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAccount, useReadContract, useReadContracts, useWalletClient, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import StablePayEscrowABI from "@/abi/StablePayEscrow.json";
import { fetchAdminDisputeDetail } from "@/services/admin";
import { PLATFORM_ADDRESS } from "@/lib/constants";
import { parseContractError, shortAddr, getMilestoneStatus, decodeTitle } from "@/lib/formatters";

type OnChainDispute = {
  id: string;
  escrowAddress: string;
  milestoneIndex: number;
  amount: string;
  status: string;
  isEscalated: boolean;
  deliveryReference?: string | null;
  disputeReason?: string | null;
  disputeOpenedAt?: string | null;
  disputeOpenedBy?: string | null;
};

export default function AdminProjectDisputesPage() {
  const { escrowAddress: rawEscrowAddress } = useParams<{ escrowAddress: string }>();
  const escrowAddress = rawEscrowAddress as `0x${string}`;
  const router = useRouter();
  const { address, isConnected, status } = useAccount();
  const [mounted, setMounted] = useState(false);
  // 'all-seller' | 'all-buyer' | 'custom' — tracks which resolve mode is selected per dispute
  const [resolveModes, setResolveModes] = useState<Record<string, "all-seller" | "all-buyer" | "custom">>({});
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [resolvedDisputes, setResolvedDisputes] = useState<Set<string>>(new Set());
  const [optimisticAwards, setOptimisticAwards] = useState<Record<string, string>>({});
  const [activeResolveId, setActiveResolveId] = useState<string | null>(null);
  const [escrowMeta, setEscrowMeta] = useState<{ title?: string | null; buyer?: string; seller?: string; buyerCompany?: string | null; sellerCompany?: string | null } | null>(null);
  const [correctionWindowDays, setCorrectionWindowDays] = useState<number | null>(null);
  const [backendMilestones, setBackendMilestones] = useState<Record<number, { sellerAward?: string | null; buyerAward?: string | null; paidAt?: string | null; deliveryReference?: string | null; disputeReason?: string | null; escalationReason?: string | null; isEscalated?: boolean; disputeOpenedAt?: string | null }>>({});

  const lastResolveIdRef = useRef<string | null>(null);

  useEffect(() => setMounted(true), []);

  // Fetch metadata from backend (admin endpoint — triggers syncSingleEscrow)
  const { data: walletClient } = useWalletClient();
  const fetchBackendData = useCallback(() => {
    if (!escrowAddress || !walletClient) return;
    fetchAdminDisputeDetail(walletClient, escrowAddress)
      .then((data) => {
        if (data) {
          setEscrowMeta({ title: data.title, buyer: data.buyer, seller: data.seller, buyerCompany: data.buyerCompany, sellerCompany: data.sellerCompany });
          setCorrectionWindowDays(data.correctionWindowDays ?? 7);
          if (Array.isArray(data.milestones)) {
            const map: Record<number, { sellerAward?: string | null; buyerAward?: string | null; paidAt?: string | null; deliveryReference?: string | null; disputeReason?: string | null; escalationReason?: string | null; isEscalated?: boolean; disputeOpenedAt?: string | null }> = {};
            for (const m of data.milestones) {
              map[m.milestoneIndex] = { sellerAward: m.sellerAward, buyerAward: m.buyerAward, paidAt: m.paidAt, deliveryReference: m.deliveryReference, disputeReason: m.disputeReason, escalationReason: m.escalationReason, isEscalated: m.isEscalated, disputeOpenedAt: m.disputeOpenedAt };
            }
            setBackendMilestones(map);
          }
        }
      })
      .catch(() => {});
  }, [escrowAddress, walletClient]);

  useEffect(() => {
    fetchBackendData();
  }, [fetchBackendData]);

  // Read on-chain: buyer, seller, milestoneCount
  const { data: buyer } = useReadContract({
    address: escrowAddress,
    abi: StablePayEscrowABI.abi,
    functionName: "BUYER",
  });

  const { data: seller } = useReadContract({
    address: escrowAddress,
    abi: StablePayEscrowABI.abi,
    functionName: "SELLER",
  });

  const { data: milestoneCount } = useReadContract({
    address: escrowAddress,
    abi: StablePayEscrowABI.abi,
    functionName: "milestoneCount",
  });

  // Read all milestones on-chain
  const milestoneContracts = useMemo(() => {
    const count = milestoneCount ? Number(milestoneCount) : 0;
    if (count === 0) return [];
    return Array.from({ length: count }, (_, i) => ({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "milestones",
      args: [BigInt(i)],
    }));
  }, [escrowAddress, milestoneCount]);

  const { data: onChainMilestones } = useReadContracts({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contracts: milestoneContracts as any,
    query: { enabled: milestoneContracts.length > 0, refetchInterval: 5000 },
  });

  // Build dispute list from on-chain data
  const sellerAddress = (seller as string | undefined) ?? escrowMeta?.seller;
  const disputes = useMemo<OnChainDispute[]>(() => {
    if (!onChainMilestones || onChainMilestones.length === 0) return [];
    const result: OnChainDispute[] = [];
    for (let i = 0; i < onChainMilestones.length; i++) {
      const r = onChainMilestones[i]?.result as [bigint, number, string, bigint, string, bigint, string] | undefined;
      if (!r) continue;
      const status = getMilestoneStatus(Number(r[1]));
      const disputeOpenedAt = Number(r[5]);
      const hadDispute = disputeOpenedAt > 0;
      if (!hadDispute && status !== "DISPUTED") continue;
      const disputeOpenedBy = r[6] as string;
      const zeroAddr = "0x0000000000000000000000000000000000000000";
      const isEscalated =
        backendMilestones[i]?.isEscalated ??
        (status === "ESCALATED" ||
          !!(
            sellerAddress &&
            disputeOpenedBy !== zeroAddr &&
            disputeOpenedBy.toLowerCase() === sellerAddress.toLowerCase()
          ));
      result.push({
        id: `${escrowAddress}-${i}`,
        escrowAddress,
        milestoneIndex: i,
        amount: r[0].toString(),
        status,
        isEscalated,
        disputeOpenedAt: disputeOpenedAt > 0 ? new Date(disputeOpenedAt * 1000).toISOString() : null,
        disputeOpenedBy: disputeOpenedBy !== zeroAddr ? disputeOpenedBy : null,
      });
    }
    return result;
  }, [onChainMilestones, escrowAddress, sellerAddress, backendMilestones]);

  const {
    writeContract: writeResolve,
    data: resolveTxHash,
    isPending: isResolvePending,
    error: resolveError,
  } = useWriteContract();

  const { isLoading: isResolveConfirming, isSuccess: isResolveSuccess } =
    useWaitForTransactionReceipt({ hash: resolveTxHash, query: { enabled: !!resolveTxHash } });

  useEffect(() => {
    if (!isResolveSuccess || !lastResolveIdRef.current) return;
    setResolvedDisputes((prev) => new Set(prev).add(lastResolveIdRef.current!));
    // Poll backend until sellerAward is available
    const poll = setInterval(() => fetchBackendData(), 2000);
    const timeout = setTimeout(() => clearInterval(poll), 20000);
    return () => { clearInterval(poll); clearTimeout(timeout); };
  }, [isResolveSuccess, fetchBackendData]);

  function handleResolve(dispute: OnChainDispute) {
    const amountBig = BigInt(dispute.amount);
    const disputeFeeBig = (amountBig * 100n) / 10000n;
    const remainingBig = amountBig - disputeFeeBig;

    const mode = resolveModes[dispute.id];
    let grossBig: bigint;

    if (mode === "all-seller") {
      grossBig = remainingBig;
    } else if (mode === "all-buyer") {
      grossBig = 0n;
    } else if (mode === "custom") {
      const input = customInputs[dispute.id]?.trim();
      if (!input) return;
      // Input is NET seller amount — reverse to gross: gross = net * 10000 / 9750
      const netBig = parseUnits(input, 6);
      grossBig = netBig === 0n ? 0n : (netBig * 10000n) / 9750n;
      if (grossBig > remainingBig) grossBig = remainingBig;
    } else {
      return;
    }

    lastResolveIdRef.current = dispute.id;
    setActiveResolveId(dispute.id);
    setOptimisticAwards((prev) => ({ ...prev, [dispute.id]: grossBig.toString() }));
    writeResolve({
      address: dispute.escrowAddress as `0x${string}`,
      abi: StablePayEscrowABI.abi,
      functionName: "resolveDispute",
      args: [BigInt(dispute.milestoneIndex), grossBig],
    });
  }

  if (!mounted || status === "connecting" || status === "reconnecting") return null;

  if (!mounted) return null;
  if (!isConnected || address?.toLowerCase() !== PLATFORM_ADDRESS?.toLowerCase()) return null;

  const projectTitle = escrowMeta?.title
    ? decodeTitle(escrowMeta.title)
    : `${escrowAddress?.slice(0, 6)}...${escrowAddress?.slice(-4)}`;
  const displayBuyer = (buyer as string) ?? escrowMeta?.buyer;
  const displaySeller = (seller as string) ?? escrowMeta?.seller;

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-8">
          <button
            onClick={() => router.back()}
            className="mb-6 text-sm text-zinc-500 hover:text-zinc-900 hover:underline"
          >
            ← Back
          </button>

          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{projectTitle}</h1>
          <p className="mt-1 font-mono text-xs text-zinc-500">{escrowAddress}</p>
          <div className="mt-3 flex flex-col gap-0.5">
            {displayBuyer && (
              <p className="text-sm text-zinc-800">
                <span className="font-medium">Buyer:</span>{" "}
                {escrowMeta?.buyerCompany && <span className="mr-1">{escrowMeta.buyerCompany}</span>}
                <span className="font-mono text-xs text-zinc-500">{displayBuyer}</span>
              </p>
            )}
            {displaySeller && (
              <p className="text-sm text-zinc-800">
                <span className="font-medium">Seller:</span>{" "}
                {escrowMeta?.sellerCompany && <span className="mr-1">{escrowMeta.sellerCompany}</span>}
                <span className="font-mono text-xs text-zinc-500">{displaySeller}</span>
              </p>
            )}
            <p className="mt-1 text-sm text-zinc-500">
              {disputes.filter(d => !["PAID", "REFUNDED", "RESOLVED"].includes(d.status)).length} active ·{" "}
              {disputes.filter(d => ["PAID", "REFUNDED", "RESOLVED"].includes(d.status)).length} resolved
            </p>
          </div>
        </div>

        {disputes.length === 0 && (
          <div className="rounded-2xl border border-zinc-300 bg-white p-12 text-center shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
            <p className="text-lg font-medium text-zinc-900">No active disputes</p>
            <p className="mt-1 text-sm text-zinc-500">This project has no disputes to resolve.</p>
          </div>
        )}

        <div className="space-y-4">
          {disputes.map((dispute) => {
            const isResolved = resolvedDisputes.has(dispute.id) || ["PAID", "REFUNDED", "RESOLVED"].includes(dispute.status);
            const openedAt = backendMilestones[dispute.milestoneIndex]?.disputeOpenedAt ?? dispute.disputeOpenedAt;
            const windowMs = (correctionWindowDays ?? 7) * 24 * 60 * 60 * 1000;
            // Contract only enforces the correction window when the BUYER opened the
            // dispute (StablePayEscrow.sol resolveDispute) — a seller-opened/escalated
            // dispute can be resolved immediately. Default to "buyer" when unknown, to
            // stay conservative rather than unlock early on missing data.
            const openedByBuyer =
              !dispute.disputeOpenedBy || !displayBuyer ||
              dispute.disputeOpenedBy.toLowerCase() === displayBuyer.toLowerCase();
            const canResolve = !openedByBuyer || (openedAt ? Date.now() >= new Date(openedAt).getTime() + windowMs : false);
            const isResolvingThis = activeResolveId === dispute.id;

            return (
              <div
                key={dispute.id}
                className="rounded-2xl border border-zinc-300 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)]"
              >
                <div className="mb-4 flex items-center justify-between">
                  <p className="font-semibold text-zinc-900">
                    Milestone {dispute.milestoneIndex + 1}
                    <span className="ml-2 font-normal text-zinc-700">
                      — {formatUnits(BigInt(dispute.amount), 6)} USDC
                    </span>
                  </p>
                  {isResolved ? (
                    <span className="rounded-md bg-zinc-800 border border-zinc-800 px-2.5 py-1 text-xs font-semibold tracking-wide text-white">
                      {(() => {
                        const sa = backendMilestones[dispute.milestoneIndex]?.sellerAward ?? optimisticAwards[dispute.id];
                        if (sa === undefined) return "RESOLVED";
                        return BigInt(sa) === BigInt(0) ? "DISPUTE REFUNDED" : "RESOLVED & PAID";
                      })()}
                    </span>
                  ) : dispute.isEscalated ? (
                    <span className="rounded-md bg-orange-50 border border-orange-400 px-2.5 py-1 text-xs font-semibold tracking-wide text-orange-600">
                      ESCALATED
                    </span>
                  ) : (
                    <span className="rounded-md bg-zinc-100 border border-red-300 px-2.5 py-1 text-xs font-semibold tracking-wide text-red-600">
                      DISPUTED
                    </span>
                  )}
                </div>

                <div className="mb-4 grid grid-cols-2 gap-4 text-sm">
                  {dispute.disputeOpenedAt && (
                    <div>
                      <p className="text-xs font-medium text-zinc-500 mb-0.5">Opened</p>
                      <p className="text-zinc-900">{new Date(dispute.disputeOpenedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                    </div>
                  )}
                  {dispute.disputeOpenedBy && displayBuyer && (
                    <div>
                      <p className="text-xs font-medium text-zinc-500 mb-0.5">
                        Opened by ({dispute.disputeOpenedBy.toLowerCase() === displayBuyer.toLowerCase() ? "buyer" : "seller"})
                      </p>
                      <p className="text-zinc-900">
                        {dispute.disputeOpenedBy.toLowerCase() === displayBuyer.toLowerCase()
                          ? (escrowMeta?.buyerCompany ?? shortAddr(dispute.disputeOpenedBy))
                          : (escrowMeta?.sellerCompany ?? shortAddr(dispute.disputeOpenedBy))}
                      </p>
                    </div>
                  )}
                </div>

                <div className="mb-4 space-y-2">
                  <div className="rounded-lg border border-zinc-900 bg-zinc-50 px-4 py-3">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Seller delivery message</p>
                    {backendMilestones[dispute.milestoneIndex]?.deliveryReference
                      ? <p className="text-sm text-zinc-800">{backendMilestones[dispute.milestoneIndex].deliveryReference}</p>
                      : <p className="text-sm text-zinc-400 italic">No delivery submitted</p>
                    }
                  </div>
                  <div className="border-l-2 border-red-500 bg-zinc-50 px-4 py-3 rounded-r-md">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-red-600">Dispute</p>
                    {backendMilestones[dispute.milestoneIndex]?.disputeReason
                      ? <p className="text-sm text-zinc-800">{backendMilestones[dispute.milestoneIndex].disputeReason}</p>
                      : <p className="text-sm text-zinc-400 italic">No reason provided</p>
                    }
                  </div>
                  {dispute.isEscalated && backendMilestones[dispute.milestoneIndex]?.escalationReason && (
                    <div className="border-l-2 border-orange-400 bg-orange-50/40 px-4 py-3 rounded-r-md">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-orange-600">Seller escalation reason</p>
                      <p className="text-sm text-zinc-800">{backendMilestones[dispute.milestoneIndex].escalationReason}</p>
                    </div>
                  )}
                </div>

                {isResolved && (
                  <div className="rounded-lg border border-zinc-900 bg-white px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">Settlement</p>
                    {(() => {
                      const gross = parseFloat(formatUnits(BigInt(dispute.amount), 6));
                      const disputeFeeAmt = gross * 0.01;
                      const sellerAwardRaw = backendMilestones[dispute.milestoneIndex]?.sellerAward ?? optimisticAwards[dispute.id];
                      if (!sellerAwardRaw) {
                        return (
                          <div className="text-xs text-zinc-400 italic">
                            Loading settlement details…
                          </div>
                        );
                      }
                      const sellerGross = parseFloat(formatUnits(BigInt(sellerAwardRaw), 6));
                      const baseFeeAmt = sellerGross * 0.025;
                      const net = sellerGross - baseFeeAmt;
                      const buyerAwardRaw = backendMilestones[dispute.milestoneIndex]?.buyerAward;
                      const buyerRefund = buyerAwardRaw
                        ? parseFloat(formatUnits(BigInt(buyerAwardRaw), 6))
                        : Math.max(0, gross - sellerGross - disputeFeeAmt);
                      return (
                        <>
                          <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-xs">
                            <span className="text-zinc-500">Amount</span>
                            <span className="text-zinc-800">{gross.toFixed(2)} USDC</span>
                            <span className="text-zinc-500">Platform fee</span>
                            <span className="text-zinc-700">{baseFeeAmt.toFixed(2)} USDC <span className="text-zinc-400">(2.5%)</span></span>
                            <span className="text-zinc-500">Dispute fee</span>
                            <span className="text-zinc-700">{disputeFeeAmt.toFixed(2)} USDC <span className="text-zinc-400">(1%)</span></span>
                            {buyerRefund > 0.001 && (
                              <>
                                <span className="text-zinc-500">Refunded</span>
                                <span className="text-zinc-700">{buyerRefund.toFixed(2)} USDC</span>
                              </>
                            )}
                          </div>
                          <div className="mt-2 flex items-center justify-between border-t border-zinc-200 pt-2 text-xs">
                            <span className="font-medium text-zinc-700">Paid to seller</span>
                            <span className="font-bold text-sm text-zinc-900">{net.toFixed(2)} USDC</span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
                {!isResolved && (() => {
                  const amountBig = BigInt(dispute.amount);
                  const disputeFeeBig = (amountBig * 100n) / 10000n;
                  const remainingBig = amountBig - disputeFeeBig;
                  const allToSellerPlatformFee = (remainingBig * 250n) / 10000n;
                  const allToSellerNet = remainingBig - allToSellerPlatformFee;

                  const mode = resolveModes[dispute.id] ?? null;
                  const customInput = customInputs[dispute.id]?.trim() ?? "";

                  // Preview for custom mode
                  let previewSellerNet: bigint | null = null;
                  let previewBuyerAward: bigint | null = null;
                  let previewPlatformFee: bigint | null = null;
                  let customInputError = false;
                  if (mode === "custom" && customInput !== "") {
                    try {
                      const netBig = parseUnits(customInput, 6);
                      if (netBig >= 0n && netBig <= allToSellerNet) {
                        const grossBig = netBig === 0n ? 0n : (netBig * 10000n) / 9750n;
                        const capped = grossBig > remainingBig ? remainingBig : grossBig;
                        previewPlatformFee = (capped * 250n) / 10000n;
                        previewSellerNet = capped - previewPlatformFee;
                        previewBuyerAward = remainingBig - capped;
                      } else {
                        customInputError = true;
                      }
                    } catch {
                      customInputError = true;
                    }
                  }

                  const canSubmit =
                    canResolve &&
                    (mode === "all-seller" || mode === "all-buyer" || (mode === "custom" && customInput !== "" && !customInputError));

                  return (
                    <div className="space-y-3">
                      {/* Quick outcome buttons */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setResolveModes((prev) => ({ ...prev, [dispute.id]: "all-seller" }))}
                          disabled={!canResolve}
                          className={`flex-1 rounded-lg px-3 py-3 text-left transition-all duration-200 disabled:opacity-40 ${mode === "all-seller" ? "border-2 border-blue-600 bg-blue-600 shadow-lg" : "border-2 border-blue-400 bg-white hover:border-blue-500"}`}
                        >
                          <p className={`text-xs font-semibold mb-1.5 ${mode === "all-seller" ? "text-white" : "text-zinc-800"}`}>All to seller</p>
                          <p className={`text-xs font-medium ${mode === "all-seller" ? "text-white" : "text-zinc-900"}`}>Seller receives {formatUnits(allToSellerNet, 6)} USDC</p>
                          <p className={`text-[11px] mt-1 ${mode === "all-seller" ? "text-white/80" : "text-zinc-600"}`}>Platform fee (2.5%): {formatUnits(allToSellerPlatformFee, 6)} USDC</p>
                          <p className={`text-[11px] ${mode === "all-seller" ? "text-white/80" : "text-zinc-600"}`}>Dispute fee (1%): {formatUnits(disputeFeeBig, 6)} USDC</p>
                        </button>
                        <button
                          onClick={() => setResolveModes((prev) => ({ ...prev, [dispute.id]: "all-buyer" }))}
                          disabled={!canResolve}
                          className={`flex-1 rounded-lg px-3 py-3 text-left transition-all duration-200 disabled:opacity-40 ${mode === "all-buyer" ? "border-2 border-blue-600 bg-blue-600 shadow-lg" : "border-2 border-blue-400 bg-white hover:border-blue-500"}`}
                        >
                          <p className={`text-xs font-semibold mb-1.5 ${mode === "all-buyer" ? "text-white" : "text-zinc-800"}`}>All to buyer</p>
                          <p className={`text-xs font-medium ${mode === "all-buyer" ? "text-white" : "text-zinc-900"}`}>Buyer receives {formatUnits(remainingBig, 6)} USDC</p>
                          <p className={`text-[11px] mt-1 ${mode === "all-buyer" ? "text-white/80" : "text-zinc-600"}`}>No platform fee</p>
                          <p className={`text-[11px] ${mode === "all-buyer" ? "text-white/80" : "text-zinc-600"}`}>Dispute fee (1%): {formatUnits(disputeFeeBig, 6)} USDC</p>
                        </button>
                      </div>

                      {/* Custom split — separate section, only active when selected */}
                      <div
                        onClick={() => { if (canResolve) setResolveModes((prev) => ({ ...prev, [dispute.id]: "custom" })); }}
                        className={`rounded-lg border-2 px-3 py-2 transition-colors ${mode === "custom" ? "border-blue-600" : "border-zinc-200 cursor-pointer hover:border-zinc-400"}`}
                      >
                        <p className={`text-xs font-semibold mb-1.5 ${mode === "custom" ? "text-blue-600" : "text-zinc-500"}`}>Custom split</p>
                        {mode === "custom" ? (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            autoFocus
                            placeholder={`Seller receives 0 – ${formatUnits(allToSellerNet, 6)} USDC`}
                            value={customInputs[dispute.id] ?? ""}
                            onChange={(e) => setCustomInputs((prev) => ({ ...prev, [dispute.id]: e.target.value }))}
                            className={`w-full bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none ${customInputError ? "text-red-600" : ""}`}
                          />
                        ) : (
                          <p className="text-xs text-zinc-400">Click to enter a custom seller amount</p>
                        )}
                      </div>

                      {/* Settlement breakdown for custom mode */}
                      {mode === "custom" && previewSellerNet !== null && (
                        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs space-y-1">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">Settlement breakdown</p>
                          <div className="flex justify-between text-zinc-600">
                            <span>Seller receives</span>
                            <span className="font-semibold text-zinc-900">{formatUnits(previewSellerNet, 6)} USDC</span>
                          </div>
                          <div className="flex justify-between text-zinc-600">
                            <span>Buyer refund</span>
                            <span className="font-semibold text-zinc-900">{formatUnits(previewBuyerAward!, 6)} USDC</span>
                          </div>
                          <div className="flex justify-between text-zinc-600 border-t border-zinc-100 pt-1">
                            <span>Platform fee (2.5%)</span>
                            <span>{formatUnits(previewPlatformFee!, 6)} USDC</span>
                          </div>
                          <div className="flex justify-between text-zinc-600">
                            <span>Dispute fee (1%)</span>
                            <span>{formatUnits(disputeFeeBig, 6)} USDC</span>
                          </div>
                        </div>
                      )}

                      {customInputError && (
                        <p className="text-xs text-red-500">Amount must be between 0 and {formatUnits(allToSellerNet, 6)} USDC</p>
                      )}

                      {/* Resolve button */}
                      <button
                        onClick={() => handleResolve(dispute)}
                        disabled={!canSubmit || isResolvePending || isResolveConfirming}
                        className="w-full rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
                        style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 8px hsl(217 91% 30% / 0.35)" }}
                      >
                        {isResolvePending && isResolvingThis ? "Confirm in wallet..." : isResolveConfirming && isResolvingThis ? "Waiting for confirmation..." : "Resolve dispute"}
                      </button>

                      {!canResolve && (
                        <p className="text-xs text-zinc-500">
                          Resolve available after correction window (
                          {openedAt
                            ? new Date(new Date(openedAt).getTime() + windowMs).toLocaleDateString()
                            : "..."}
                          )
                        </p>
                      )}

                      {resolveError && isResolvingThis && (
                        <p className="text-xs text-red-500">{parseContractError(resolveError)}</p>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
