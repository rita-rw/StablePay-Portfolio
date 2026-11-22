"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAccount, useReadContract, useReadContracts, useWalletClient, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { formatUnits, parseUnits, type Abi } from "viem";
import StablePayEscrowABI from "@/abi/StablePayEscrow.json";
import { fetchAdminDisputeDetail } from "@/services/admin";
import { API_URL, PLATFORM_ADDRESS, PLATFORM_FEE_BPS, DISPUTE_FEE_BPS } from "@/lib/constants";
import { authFetch } from "@/lib/authFetch";
import { parseContractError, shortAddr, getMilestoneStatus, decodeTitle, calcFeeBase, formatDate, formatDateTime } from "@/lib/formatters";
import { useMounted } from "@/hooks/useMounted";
import { useNow } from "@/hooks/useNow";
import { MilestonePayment } from "@/components/project/MilestonePayment";

/** Compact "2d 3h" / "3h 10m" / "5m" style remaining-time label. */
function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days >= 1) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours >= 1) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

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
  const mounted = useMounted();
  const now = useNow();
  // 'all-seller' | 'all-buyer' | 'custom' — tracks which resolve mode is selected per dispute
  const [resolveModes, setResolveModes] = useState<Record<string, "all-seller" | "all-buyer" | "custom">>({});
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [resolvedDisputes, setResolvedDisputes] = useState<Set<string>>(new Set());
  const [optimisticAwards, setOptimisticAwards] = useState<Record<string, string>>({});
  const [activeResolveId, setActiveResolveId] = useState<string | null>(null);
  const [escrowMeta, setEscrowMeta] = useState<{ title?: string | null; buyer?: string; seller?: string; buyerCompany?: string | null; sellerCompany?: string | null } | null>(null);
  const [correctionWindowDays, setCorrectionWindowDays] = useState<number | null>(null);
  const [backendMilestones, setBackendMilestones] = useState<Record<number, { label?: string | null; sellerAward?: string | null; paidAt?: string | null; deliveryReference?: string | null; disputeReason?: string | null; escalationReason?: string | null; sellerResponse?: string | null; resolutionNote?: string | null; isEscalated?: boolean; disputeOpenedAt?: string | null }>>({});

  const lastResolveIdRef = useRef<string | null>(null);
  // Decision note per dispute. Saved after the resolve tx confirms, so a failed or
  // cancelled tx never leaves a note on an unresolved dispute.
  const MIN_NOTE_LENGTH = 10;
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savedNotes, setSavedNotes] = useState<Record<string, string>>({});
  const [noteSaving, setNoteSaving] = useState<string | null>(null);
  const [noteErrors, setNoteErrors] = useState<Record<string, string>>({});
  const pendingNoteRef = useRef<{ id: string; milestoneIndex: number; note: string } | null>(null);

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
            const map: Record<number, { label?: string | null; sellerAward?: string | null; paidAt?: string | null; deliveryReference?: string | null; disputeReason?: string | null; escalationReason?: string | null; sellerResponse?: string | null; resolutionNote?: string | null; isEscalated?: boolean; disputeOpenedAt?: string | null }> = {};
            for (const m of data.milestones) {
              map[m.milestoneIndex] = { label: m.label, sellerAward: m.sellerAward, paidAt: m.paidAt, deliveryReference: m.deliveryReference, disputeReason: m.disputeReason, escalationReason: m.escalationReason, sellerResponse: m.sellerResponse, resolutionNote: m.resolutionNote, isEscalated: m.isEscalated, disputeOpenedAt: m.disputeOpenedAt };
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
      abi: StablePayEscrowABI.abi as Abi,
      functionName: "milestones",
      args: [BigInt(i)],
    }));
  }, [escrowAddress, milestoneCount]);

  const { data: onChainMilestones } = useReadContracts({
    contracts: milestoneContracts,
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
    if (!isResolveSuccess || !pendingNoteRef.current) return;
    const { id, milestoneIndex, note } = pendingNoteRef.current;
    pendingNoteRef.current = null;
    void saveResolutionNote(id, milestoneIndex, note);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run only when the resolve tx confirms; saveResolutionNote is recreated every render
  }, [isResolveSuccess]);

  useEffect(() => {
    if (!isResolveSuccess || !lastResolveIdRef.current) return;
    setResolvedDisputes((prev) => new Set(prev).add(lastResolveIdRef.current!));
    // Poll backend until sellerAward is available
    const poll = setInterval(() => fetchBackendData(), 2000);
    const timeout = setTimeout(() => clearInterval(poll), 20000);
    return () => { clearInterval(poll); clearTimeout(timeout); };
  }, [isResolveSuccess, fetchBackendData]);

  async function saveResolutionNote(id: string, milestoneIndex: number, note: string) {
    if (!walletClient) return;
    setNoteSaving(id);
    setNoteErrors((prev) => ({ ...prev, [id]: "" }));
    try {
      const postNote = () => authFetch(`${API_URL}/admin/disputes/${escrowAddress}/milestones/${milestoneIndex}/resolution-note`, walletClient, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolutionNote: note }),
      });
      let res = await postNote();
      // 409 right after the resolve tx: the backend's RPC can be a block behind
      // and still see the dispute as open. Retry a few times before giving up.
      for (let attempt = 0; res.status === 409 && attempt < 5; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        res = await postNote();
      }
      if (!res.ok) throw new Error();
      setSavedNotes((prev) => ({ ...prev, [id]: note }));
    } catch {
      setNoteErrors((prev) => ({ ...prev, [id]: "Could not save the decision note. Please try again." }));
    } finally {
      setNoteSaving(null);
    }
  }

  function handleResolve(dispute: OnChainDispute) {
    const amountBig = BigInt(dispute.amount);
    const disputeFeeBig = calcFeeBase(amountBig, DISPUTE_FEE_BPS);
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
      grossBig = netBig === 0n ? 0n : (netBig * 10_000n) / (10_000n - PLATFORM_FEE_BPS);
      if (grossBig > remainingBig) grossBig = remainingBig;
    } else {
      return;
    }

    const note = (noteDrafts[dispute.id] ?? "").trim();
    if (note.length < MIN_NOTE_LENGTH) return;

    lastResolveIdRef.current = dispute.id;
    pendingNoteRef.current = { id: dispute.id, milestoneIndex: dispute.milestoneIndex, note };
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
    : shortAddr(escrowAddress);
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
            const canResolve = !openedByBuyer || (openedAt ? now >= new Date(openedAt).getTime() + windowMs : false);
            const isResolvingThis = activeResolveId === dispute.id;
            const unlockAt = openedAt ? new Date(openedAt).getTime() + windowMs : null;
            const msUntilUnlock = unlockAt !== null ? unlockAt - now : null;
            // Only claim "the buyer opened this" when we actually know it — canResolve
            // defaults to locked on missing data, so the banner must stay vague then.
            const buyerOpenedKnown = !!(
              dispute.disputeOpenedBy &&
              displayBuyer &&
              dispute.disputeOpenedBy.toLowerCase() === displayBuyer.toLowerCase()
            );
            const lockedTitle = !canResolve
              ? unlockAt
                ? `Locked until ${formatDateTime(unlockAt)} — correction window still running`
                : "Locked — waiting for the dispute's on-chain open time to sync"
              : undefined;

            return (
              <div
                key={dispute.id}
                className="rounded-2xl border border-zinc-300 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)]"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-zinc-900">
                      Milestone {dispute.milestoneIndex + 1}
                      <span className="ml-2 font-normal text-zinc-700">
                        — {formatUnits(BigInt(dispute.amount), 6)} USDC
                      </span>
                    </p>
                    {backendMilestones[dispute.milestoneIndex]?.label?.trim() && (
                      <p className="mt-0.5 whitespace-pre-line text-sm font-normal text-zinc-500">
                        {backendMilestones[dispute.milestoneIndex]?.label?.trim()}
                      </p>
                    )}
                  </div>
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
                      <p className="text-zinc-900">{formatDate(dispute.disputeOpenedAt)}</p>
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
                      ? <p className="whitespace-pre-wrap break-words text-sm text-zinc-800">{backendMilestones[dispute.milestoneIndex].deliveryReference}</p>
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
                  {backendMilestones[dispute.milestoneIndex]?.sellerResponse && (
                    <div className="border-l-2 border-zinc-500 bg-zinc-50 px-4 py-3 rounded-r-md">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Seller&apos;s response</p>
                      <p className="whitespace-pre-wrap break-words text-sm text-zinc-800">{backendMilestones[dispute.milestoneIndex].sellerResponse}</p>
                    </div>
                  )}
                </div>

                {isResolved && (
                  <MilestonePayment
                    amount={dispute.amount}
                    status="RESOLVED"
                    hadDispute
                    sellerAward={backendMilestones[dispute.milestoneIndex]?.sellerAward ?? optimisticAwards[dispute.id]}
                  />
                )}
                {isResolved && (() => {
                  const note = savedNotes[dispute.id] ?? backendMilestones[dispute.milestoneIndex]?.resolutionNote;
                  if (note) {
                    return (
                      <div className="mt-2 border-l-2 border-blue-500 bg-zinc-50 px-4 py-3 rounded-r-md">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-blue-600">Decision note</p>
                        <p className="whitespace-pre-wrap break-words text-sm text-zinc-800">{note}</p>
                      </div>
                    );
                  }
                  // Missing note: the save after the tx failed, or the dispute was resolved before notes existed
                  const draft = (noteDrafts[dispute.id] ?? "").trim();
                  return (
                    <div className="mt-2 space-y-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Decision note</p>
                      <textarea
                        value={noteDrafts[dispute.id] ?? ""}
                        onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [dispute.id]: e.target.value }))}
                        placeholder="Explain the decision to the buyer and the seller…"
                        maxLength={1000}
                        rows={3}
                        className="w-full resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                      />
                      <button
                        onClick={() => saveResolutionNote(dispute.id, dispute.milestoneIndex, draft)}
                        disabled={draft.length < MIN_NOTE_LENGTH || noteSaving === dispute.id}
                        className="w-full rounded-lg bg-zinc-800 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-900 disabled:opacity-40"
                      >
                        {noteSaving === dispute.id ? "Saving..." : "Save decision note"}
                      </button>
                      {noteErrors[dispute.id] && (
                        <p className="text-xs text-red-500">{noteErrors[dispute.id]}</p>
                      )}
                    </div>
                  );
                })()}
                {!isResolved && (() => {
                  const amountBig = BigInt(dispute.amount);
                  const disputeFeeBig = calcFeeBase(amountBig, DISPUTE_FEE_BPS);
                  const remainingBig = amountBig - disputeFeeBig;
                  const allToSellerPlatformFee = calcFeeBase(remainingBig, PLATFORM_FEE_BPS);
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
                        const grossBig = netBig === 0n ? 0n : (netBig * 10_000n) / (10_000n - PLATFORM_FEE_BPS);
                        const capped = grossBig > remainingBig ? remainingBig : grossBig;
                        previewPlatformFee = calcFeeBase(capped, PLATFORM_FEE_BPS);
                        previewSellerNet = capped - previewPlatformFee;
                        previewBuyerAward = remainingBig - capped;
                      } else {
                        customInputError = true;
                      }
                    } catch {
                      customInputError = true;
                    }
                  }

                  const noteLength = (noteDrafts[dispute.id] ?? "").trim().length;
                  const canSubmit =
                    canResolve &&
                    noteLength >= MIN_NOTE_LENGTH &&
                    (mode === "all-seller" || mode === "all-buyer" || (mode === "custom" && customInput !== "" && !customInputError));

                  return (
                    <div className="space-y-3">
                      {!canResolve && (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
                          <p className="text-xs font-semibold text-amber-800">
                            🔒 Resolution locked
                            {msUntilUnlock && msUntilUnlock > 0 ? ` — ${formatDuration(msUntilUnlock)} left` : ""}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-amber-700">
                            {buyerOpenedKnown
                              ? `The buyer opened this dispute, so the contract enforces a ${correctionWindowDays ?? 7}-day correction window before the platform can resolve. `
                              : `This dispute is still within its ${correctionWindowDays ?? 7}-day correction window. `}
                            {unlockAt
                              ? `You can resolve it from ${formatDateTime(unlockAt)}.`
                              : `The dispute's on-chain open time hasn't synced yet — try refreshing in a moment.`}
                          </p>
                        </div>
                      )}

                      {/* Quick outcome buttons */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setResolveModes((prev) => ({ ...prev, [dispute.id]: "all-seller" }))}
                          disabled={!canResolve}
                          title={lockedTitle}
                          className={`flex-1 rounded-lg px-3 py-3 text-left transition-all duration-200 disabled:opacity-40 ${mode === "all-seller" ? "border-2 border-blue-600 bg-blue-600 shadow-lg" : "border-2 border-blue-400 bg-white hover:border-blue-500"}`}
                        >
                          <p className={`text-xs font-semibold mb-1.5 ${mode === "all-seller" ? "text-white" : "text-zinc-800"}`}>All to seller</p>
                          <p className={`text-xs font-medium ${mode === "all-seller" ? "text-white" : "text-zinc-900"}`}>Seller receives {formatUnits(allToSellerNet, 6)} USDC</p>
                          <p className={`text-[11px] mt-1 ${mode === "all-seller" ? "text-white/80" : "text-zinc-600"}`}>Platform fee (2.5% of seller&apos;s share): {formatUnits(allToSellerPlatformFee, 6)} USDC</p>
                          <p className={`text-[11px] ${mode === "all-seller" ? "text-white/80" : "text-zinc-600"}`}>Dispute fee (1%): {formatUnits(disputeFeeBig, 6)} USDC</p>
                        </button>
                        <button
                          onClick={() => setResolveModes((prev) => ({ ...prev, [dispute.id]: "all-buyer" }))}
                          disabled={!canResolve}
                          title={lockedTitle}
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
                        title={lockedTitle}
                        className={`rounded-lg border-2 px-3 py-2 transition-colors ${mode === "custom" ? "border-blue-600" : canResolve ? "border-zinc-200 cursor-pointer hover:border-zinc-400" : "border-zinc-200 opacity-40"}`}
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
                            <span>Platform fee (2.5% of seller&apos;s share)</span>
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

                      {/* Decision note — required, shown to both parties */}
                      <div className={`space-y-1 ${!canResolve ? "opacity-40" : ""}`}>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Decision note</p>
                        <textarea
                          value={noteDrafts[dispute.id] ?? ""}
                          onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [dispute.id]: e.target.value }))}
                          disabled={!canResolve}
                          placeholder="Explain the decision to the buyer and the seller…"
                          maxLength={1000}
                          rows={3}
                          className="w-full resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                        />
                        <p className="text-xs text-zinc-500">
                          Required, at least {MIN_NOTE_LENGTH} characters. Shown to the buyer and the seller, and cannot be changed later.
                        </p>
                      </div>

                      {/* Resolve button */}
                      <button
                        onClick={() => handleResolve(dispute)}
                        disabled={!canSubmit || isResolvePending || isResolveConfirming}
                        className="w-full rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
                        style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 8px hsl(217 91% 30% / 0.35)" }}
                      >
                        {isResolvePending && isResolvingThis ? "Confirm in wallet..." : isResolveConfirming && isResolvingThis ? "Waiting for confirmation..." : "Resolve dispute"}
                      </button>

                      {resolveError && isResolvingThis && (
                        <p className="text-xs text-red-500">{parseContractError(resolveError)}</p>
                      )}
                      {noteErrors[dispute.id] && (
                        <p className="text-xs text-red-500">{noteErrors[dispute.id]}</p>
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
