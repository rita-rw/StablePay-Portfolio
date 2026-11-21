"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useWalletClient, usePublicClient } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { erc20Abi, formatUnits, keccak256, toHex, type Abi } from "viem";
import { Pencil } from "lucide-react";
import StablePayEscrowABI from "@/abi/StablePayEscrow.json";
import { useUser } from "@/hooks/useUser";
import { useNow } from "@/hooks/useNow";
import { useMounted } from "@/hooks/useMounted";
import { USDC_ADDRESS, PLATFORM_ADDRESS, API_URL, PLATFORM_FEE_BPS } from "@/lib/constants";
import { parseContractError, getMilestoneStatus, getDisplayStatus, statusBadge, milestoneStatusBadge, decodeTitle, formatUSDC, calcFeeBase, dayLabel } from "@/lib/formatters";
import { MilestoneTitle } from "@/components/shared/MilestoneTitle";
import { ProjectTimeline, type ProjectEvent } from "@/components/project/ProjectTimeline";
import { ProjectInfoCard } from "@/components/project/ProjectInfoCard";
import { FundProject } from "@/components/project/FundProject";
import { ProjectInvitation } from "@/components/project/ProjectInvitation";
import { MilestoneHistory } from "@/components/project/MilestoneHistory";
import { BuyerMilestoneActions } from "@/components/project/BuyerMilestoneActions";
import { SellerAwaitingApproval } from "@/components/project/SellerAwaitingApproval";
import { DeliveryForm } from "@/components/project/DeliveryForm";
import { EscalateDispute } from "@/components/project/EscalateDispute";
import { DisputeResponseForm } from "@/components/project/DisputeResponseForm";
import { type TxAction } from "@/lib/tx";
import { authFetch, hasValidAuth } from "@/lib/authFetch";
import { renameProjectTitle } from "@/services/projects";

/**
 * Saves the text behind an on-chain hash (delivery, dispute, escalation). No signature:
 * the backend checks the text against the hash the tx stored. Retries because the
 * backend's RPC node can be a block behind right after the tx confirms.
 */
async function postWithRetry(url: string, body: object, attempts = 3): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
    } catch { /* retry */ }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { address, isConnected, status } = useAccount();
  const { data: walletClient } = useWalletClient();
  const router = useRouter();
  const { isRegistered, checked: userChecked } = useUser();
  const mounted = useMounted();
  const [activeTab, setActiveTab] = useState<"overview" | "timeline">("overview");
  const [escrowMeta, setEscrowMeta] = useState<{
    title?: string | null;
    description?: string | null;
    buyerCompany?: string | null;
    sellerCompany?: string | null;
    correctionWindowDays?: number | null;
    autoApprovalDays?: number | null;
    disputeTimeoutDays?: number | null;
  } | null>(null);
  const [metaReady, setMetaReady] = useState(false);
  const [milestonesLoaded, setMilestonesLoaded] = useState(false);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [milestones, setMilestones] = useState<{
    milestoneIndex: number;
    amount: string;
    label?: string | null;
    status: string;
    isEscalated: boolean;
    deliveryReference?: string | null;
    submittedAt?: string | null;
    disputeReason?: string | null;
    disputeOpenedAt?: string | null;
    disputeOpenedBy?: string | null;
    disputeEscalatedAt?: string | null;
    escalationReason?: string | null;
    sellerResponse?: string | null;
    resolutionNote?: string | null;
    sellerAward?: string | null;
    paidAt?: string | null;
    autoApproved?: boolean | null;
  }[]>([]);
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const escrowAddress = id as `0x${string}`;

  useEffect(() => {
    const apiUrl = API_URL;
    if (!apiUrl || !escrowAddress) return;
    let cancelled = false;

    const applyDetail = (data: {
      title?: string | null;
      description?: string | null;
      buyerCompany?: string | null;
      sellerCompany?: string | null;
      correctionWindowDays?: number | null;
      autoApprovalDays?: number | null;
      disputeTimeoutDays?: number | null;
    }) => {
      setEscrowMeta((prev) => ({
        title: data.title ?? prev?.title ?? null,
        description: data.description ?? prev?.description ?? null,
        buyerCompany: data.buyerCompany ?? prev?.buyerCompany ?? null,
        sellerCompany: data.sellerCompany ?? prev?.sellerCompany ?? null,
        correctionWindowDays: data.correctionWindowDays ?? prev?.correctionWindowDays ?? null,
        autoApprovalDays: data.autoApprovalDays ?? prev?.autoApprovalDays ?? null,
        disputeTimeoutDays: data.disputeTimeoutDays ?? prev?.disputeTimeoutDays ?? null,
      }));
      setMetaReady(true);
    };

    // Kept off walletClient on purpose. A signature must not cancel this read,
    // or the page paints Untitled Project from the chain data alone.
    fetch(`${apiUrl}/projects/detail/${escrowAddress}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) applyDetail(data);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [escrowAddress]);

  useEffect(() => {
    const apiUrl = API_URL;
    if (!apiUrl || !escrowAddress || !walletClient) return;
    let cancelled = false;
    authFetch(`${apiUrl}/projects/detail/${escrowAddress}`, walletClient)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setEscrowMeta((prev) => ({
          title: data.title ?? prev?.title ?? null,
          description: data.description ?? prev?.description ?? null,
          buyerCompany: data.buyerCompany ?? prev?.buyerCompany ?? null,
          sellerCompany: data.sellerCompany ?? prev?.sellerCompany ?? null,
          correctionWindowDays: data.correctionWindowDays ?? prev?.correctionWindowDays ?? null,
          autoApprovalDays: data.autoApprovalDays ?? prev?.autoApprovalDays ?? null,
          disputeTimeoutDays: data.disputeTimeoutDays ?? prev?.disputeTimeoutDays ?? null,
        }));
        setMetaReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [escrowAddress, walletClient]);

  const applyMilestones = useCallback((data: unknown) => {
    if (!Array.isArray(data)) return;
    setMilestones((prev) => {
      const incoming = data as typeof prev;
      if (prev.length === 0) return incoming;
      return incoming.map((m) => {
        const old = prev.find((p) => p.milestoneIndex === m.milestoneIndex);
        if (!old) return m;
        return {
          ...old,
          ...m,
          label: m.label ?? old.label,
          deliveryReference: m.deliveryReference ?? old.deliveryReference,
          submittedAt: m.submittedAt ?? old.submittedAt,
          // Public payloads omit these keys. A participant payload with null means the dispute was cleared.
          disputeReason: "disputeReason" in m ? m.disputeReason : old.disputeReason,
          disputeOpenedAt: "disputeOpenedAt" in m ? m.disputeOpenedAt : old.disputeOpenedAt,
          disputeOpenedBy: "disputeOpenedBy" in m ? m.disputeOpenedBy : old.disputeOpenedBy,
          isEscalated: "isEscalated" in m ? m.isEscalated : old.isEscalated,
          escalationReason: "escalationReason" in m ? m.escalationReason : old.escalationReason,
          sellerResponse: "sellerResponse" in m ? m.sellerResponse : old.sellerResponse,
          resolutionNote: "resolutionNote" in m ? m.resolutionNote : old.resolutionNote,
        };
      });
    });
    setMilestonesLoaded(true);
  }, []);

  const fetchMilestones = useCallback((background = false) => {
    const apiUrl = API_URL;
    if (!apiUrl || !escrowAddress) return;
    fetch(`${apiUrl}/projects/${escrowAddress}/milestones`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => applyMilestones(data))
      .catch(() => {});
    if (walletClient && (!background || hasValidAuth(walletClient.account!.address))) {
      authFetch(`${apiUrl}/projects/${escrowAddress}/milestones`, walletClient)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => applyMilestones(data))
        .catch(() => {});
    }
  }, [escrowAddress, walletClient, applyMilestones]);

  useEffect(() => {
    fetchMilestones();
  }, [fetchMilestones]);

  const fetchEvents = useCallback(() => {
    const apiUrl = API_URL;
    if (!apiUrl || !escrowAddress) return;
    fetch(`${apiUrl}/projects/${escrowAddress}/events`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!Array.isArray(data)) return;
        setEvents(data);
        setEventsLoaded(true);
      })
      .catch(() => {});
  }, [escrowAddress]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Background polling so both parties see updates from the other side
  useEffect(() => {
    const interval = setInterval(() => {
      fetchMilestones(true);
      fetchEvents();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchMilestones, fetchEvents]);

  const { data: totalAmount } = useReadContract({
    address: escrowAddress,
    abi: StablePayEscrowABI.abi,
    functionName: "totalAmount",
  });

  const { data: isFunded } = useReadContract({
    address: escrowAddress,
    abi: StablePayEscrowABI.abi,
    functionName: "funded",
  });

  const { data: isCancelled, refetch: refetchCancelled } = useReadContract({
    address: escrowAddress,
    abi: StablePayEscrowABI.abi,
    functionName: "cancelled",
  });

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

  const { data: autoApprovalDaysOnChain } = useReadContract({
    address: escrowAddress,
    abi: StablePayEscrowABI.abi,
    functionName: "AUTO_APPROVAL_DAYS",
  });

  const { data: disputeTimeoutDaysOnChain } = useReadContract({
    address: escrowAddress,
    abi: StablePayEscrowABI.abi,
    functionName: "DISPUTE_TIMEOUT_DAYS",
  });

  const { data: correctionWindowDaysOnChain } = useReadContract({
    address: escrowAddress,
    abi: StablePayEscrowABI.abi,
    functionName: "CORRECTION_WINDOW_DAYS",
  });

  // Read on-chain milestone statuses via multicall
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

  // Merge on-chain status into milestones from backend
  const enrichedMilestones = useMemo(() => {
    if (!onChainMilestones || onChainMilestones.length === 0) return milestones;
    return milestones.map((m) => {
      const onChain = onChainMilestones[m.milestoneIndex];
      if (!onChain?.result) return m;
      const result = onChain.result as [bigint, number, string, bigint, string, bigint, string];
      const onChainSubmittedAt = Number(result[3]);
      const onChainDisputeOpenedAt = Number(result[5]);
      const onChainDisputeOpenedBy = result[6] as string;
      const zeroAddr = "0x0000000000000000000000000000000000000000";
      const onChainIsEscalated = !!(
        seller &&
        onChainDisputeOpenedBy !== zeroAddr &&
        onChainDisputeOpenedBy.toLowerCase() === (seller as string).toLowerCase()
      );
      const disputeStillOpen = onChainDisputeOpenedAt > 0;
      const isEscalated = disputeStillOpen && (m.isEscalated || onChainIsEscalated);
      const rawOnChainStatus = getMilestoneStatus(Number(result[1]));
      const terminalOnChain = rawOnChainStatus === "PAID" || rawOnChainStatus === "REFUNDED" || rawOnChainStatus === "RESOLVED";
      const onChainStatus = (isEscalated && !terminalOnChain) ? "ESCALATED" : (rawOnChainStatus ?? m.status);
      return {
        ...m,
        isEscalated,
        status: onChainStatus,
        submittedAt: onChainSubmittedAt > 0 ? new Date(onChainSubmittedAt * 1000).toISOString() : m.submittedAt,
        // resubmitDuringDispute zeroes the on-chain dispute. Do not keep the old DB row,
        // or a later approval is shown as a dispute settlement.
        disputeOpenedAt: disputeStillOpen ? new Date(onChainDisputeOpenedAt * 1000).toISOString() : null,
        disputeOpenedBy: disputeStillOpen && onChainDisputeOpenedBy !== zeroAddr ? onChainDisputeOpenedBy : null,
        disputeReason: disputeStillOpen ? m.disputeReason : null,
        escalationReason: disputeStillOpen ? m.escalationReason : null,
        sellerResponse: disputeStillOpen ? m.sellerResponse : null,
      };
    });
  }, [milestones, onChainMilestones, seller]);

  // Re-fetch milestones from backend when sellerAward is missing for dispute outcomes
  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!apiUrl || !escrowAddress) return;
    const needsAward = enrichedMilestones.some(
      (m) => ["RESOLVED", "PAID", "REFUNDED"].includes(m.status) && !!m.disputeOpenedAt && !m.sellerAward
    );
    if (!needsAward) return;
    const timer = setTimeout(() => {
      fetch(`${apiUrl}/projects/${escrowAddress}/milestones`)
        .then((r) => r.json())
        .then((data) => { if (Array.isArray(data)) setMilestones(data); })
        .catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
  }, [enrichedMilestones, escrowAddress]);

  // Fetch sellerAward from on-chain events for resolved milestones missing backend data
  const publicClient = usePublicClient();
  const [onChainAwards, setOnChainAwards] = useState<Record<number, string>>({});
  // Track milestone indices where the on-chain fetch was already attempted (success or fail)
  const onChainFetchAttempted = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!publicClient || !escrowAddress) return;
    const resolvedWithoutAward = enrichedMilestones.filter(
      (m) =>
        ["RESOLVED", "PAID"].includes(m.status) &&
        !!m.disputeOpenedAt &&
        !m.sellerAward &&
        !(m.milestoneIndex in onChainAwards) &&
        !onChainFetchAttempted.current.has(m.milestoneIndex)
    );
    if (resolvedWithoutAward.length === 0) return;

    // Mark all as attempted immediately so we never retry on 413/failure
    resolvedWithoutAward.forEach((m) => onChainFetchAttempted.current.add(m.milestoneIndex));

    publicClient.getBlockNumber().then((currentBlock) => {
      const fromBlock = currentBlock > 5000n ? currentBlock - 5000n : 0n;
      return publicClient.getContractEvents({
        address: escrowAddress,
        abi: StablePayEscrowABI.abi as Abi,
        eventName: "DisputeResolved",
        fromBlock,
      });
    })
      .then((logs) => {
        const awards: Record<number, string> = {};
        for (const log of logs) {
          const args = log.args as { milestoneIndex?: bigint; sellerAward?: bigint };
          if (args.milestoneIndex !== undefined && args.sellerAward !== undefined) {
            awards[Number(args.milestoneIndex)] = args.sellerAward.toString();
          }
        }
        if (Object.keys(awards).length > 0) {
          setOnChainAwards((prev) => ({ ...prev, ...awards }));
        }
      })
      .catch(() => {});
  }, [publicClient, escrowAddress, enrichedMilestones, onChainAwards]);

  const { data: sellerAccepted, refetch: refetchSellerAccepted } = useReadContract({
    address: escrowAddress,
    abi: StablePayEscrowABI.abi,
    functionName: "sellerAccepted",
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && escrowAddress ? [address, escrowAddress] : undefined,
  });

  const {
    writeContract: writeApprove,
    data: approveTxHash,
    isPending: isApprovePending,
    error: approveError,
  } = useWriteContract();

  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess } =
    useWaitForTransactionReceipt({
      hash: approveTxHash,
      query: { enabled: !!approveTxHash },
    });

  const {
    writeContract: writeFund,
    data: fundTxHash,
    isPending: isFundPending,
    error: fundError,
  } = useWriteContract();

  const { isLoading: isFundConfirming, isSuccess: isFundSuccess } =
    useWaitForTransactionReceipt({
      hash: fundTxHash,
      query: { enabled: !!fundTxHash },
    });

  useEffect(() => {
    if (isApproveSuccess) {
      refetchAllowance();
    }
  }, [isApproveSuccess, refetchAllowance]);

  const hasEnoughAllowance =
    allowance !== undefined &&
    totalAmount !== undefined &&
    (allowance as bigint) >= (totalAmount as bigint);

  const isBuyer =
    !!(address && buyer && address.toLowerCase() === (buyer as string).toLowerCase());
  const isSeller =
    !!(address && seller && address.toLowerCase() === (seller as string).toLowerCase());
  const isPlatform = !!(address && PLATFORM_ADDRESS && address.toLowerCase() === PLATFORM_ADDRESS.toLowerCase());

  const displayTitle = decodeTitle(escrowMeta?.title || "Untitled Project");

  const startEditTitle = () => {
    setTitleDraft(escrowMeta?.title ? decodeTitle(escrowMeta.title) : "");
    setTitleError(null);
    setIsEditingTitle(true);
  };

  const cancelEditTitle = () => {
    setIsEditingTitle(false);
    setTitleDraft("");
    setTitleError(null);
  };

  const saveTitle = async () => {
    if (!walletClient) {
      setTitleError("Wallet not ready — please try again.");
      return;
    }
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      setTitleError("Title is required");
      return;
    }
    if (nextTitle.length > 200) {
      setTitleError("Title must be at most 200 characters");
      return;
    }

    setTitleSaving(true);
    setTitleError(null);
    try {
      const result = await renameProjectTitle(walletClient, escrowAddress, nextTitle);
      if (!result.ok) {
        setTitleError(result.error || "Failed to rename project");
        return;
      }
      setEscrowMeta((prev) => (prev ? { ...prev, title: result.title ?? nextTitle } : { title: result.title ?? nextTitle }));
      setIsEditingTitle(false);
      setTitleDraft("");
    } catch {
      setTitleError("Failed to rename project — please try again.");
    } finally {
      setTitleSaving(false);
    }
  };

  const [deliveryInputs, setDeliveryInputs] = useState<Record<number, string>>({});
  const [disputeInputs, setDisputeInputs] = useState<Record<number, string>>({});
  const [resubmitInputs, setResubmitInputs] = useState<Record<number, string>>({});
  const [deliverySaveError, setDeliverySaveError] = useState<Record<number, string>>({});
  const [optimisticDeliveries, setOptimisticDeliveries] = useState<Record<number, string>>({});
  // Chain receipt arrived, backend status not synced yet. Keeps the card in its
  // final submitted layout so it doesn't jump again when the listener catches up.
  const [confirmedSubmits, setConfirmedSubmits] = useState<Set<number>>(new Set());
  const [optimisticDisputes, setOptimisticDisputes] = useState<Record<number, string>>({});
  // Chain receipt arrived, backend status not synced yet. Keeps the card in its
  // final disputed layout instead of an empty Processing state.
  const [confirmedDisputes, setConfirmedDisputes] = useState<Set<number>>(new Set());
  // Chain receipt arrived, backend status not synced yet. Keeps the card in its
  // final paid layout instead of an empty Processing state.
  const [confirmedPaids, setConfirmedPaids] = useState<Set<number>>(new Set());
  const [escalationReasons, setEscalationReasons] = useState<Record<number, string>>({});
  const [escalationExpanded, setEscalationExpanded] = useState<Record<number, boolean>>({});
  // Seller's off-chain response to a buyer-opened dispute (no tx, saved in the backend only)
  const [sellerResponseDrafts, setSellerResponseDrafts] = useState<Record<number, string>>({});
  const [sellerResponseExpanded, setSellerResponseExpanded] = useState<Record<number, boolean>>({});
  const [savedSellerResponses, setSavedSellerResponses] = useState<Record<number, string>>({});
  const [sellerResponseSaving, setSellerResponseSaving] = useState<number | null>(null);
  const [sellerResponseError, setSellerResponseError] = useState<Record<number, string>>({});
  const [disputeExpanded, setDisputeExpanded] = useState<Record<number, boolean>>({});
  // Last submission time we already reset the dispute draft for. A resubmit changes submittedAt.
  const disputeDraftEpoch = useRef<Record<number, string>>({});

  useEffect(() => {
    setDisputeExpanded({});
    setDisputeInputs({});
    setOptimisticDisputes({});
    setConfirmedDisputes(new Set());
    disputeDraftEpoch.current = {};
  }, [address]);

  useEffect(() => {
    const toClear: number[] = [];
    for (const milestone of enrichedMilestones) {
      if (milestone.status !== "SUBMITTED" || milestone.disputeOpenedAt) continue;
      const epoch = milestone.submittedAt ?? "";
      if (disputeDraftEpoch.current[milestone.milestoneIndex] === epoch) continue;
      disputeDraftEpoch.current[milestone.milestoneIndex] = epoch;
      toClear.push(milestone.milestoneIndex);
    }
    if (toClear.length === 0) return;
    setDisputeExpanded((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const index of toClear) {
        if (next[index]) {
          next[index] = false;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setDisputeInputs((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const index of toClear) {
        if (index in next) {
          delete next[index];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setOptimisticDisputes((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const index of toClear) {
        if (index in next) {
          delete next[index];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setConfirmedDisputes((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const index of toClear) {
        if (next.delete(index)) changed = true;
      }
      return changed ? next : prev;
    });
  }, [enrichedMilestones]);

  // Tracks which milestones are waiting for backend to confirm the new status.
  // Map<milestoneIndex, expectedStatus> e.g. Map(0 → "PAID")
  const [processingMilestones, setProcessingMilestones] = useState<Map<number, string>>(new Map());
  const lastApprovedIndexRef = useRef<number | null>(null);
  const lastClaimIndexRef = useRef<number | null>(null);
  const lastSubmittedIndexRef = useRef<number | null>(null);
  const lastDisputedIndexRef = useRef<number | null>(null);
  const lastResubmitIndexRef = useRef<number | null>(null);
  const lastTimeoutIndexRef = useRef<number | null>(null);
  // Which card is in a wallet flow. State, not the refs above: those are only
  // read in effects, and reading them while rendering is a hooks error.
  const [approveIndex, setApproveIndex] = useState<number | null>(null);
  const [claimIndex, setClaimIndex] = useState<number | null>(null);
  const [submitIndex, setSubmitIndex] = useState<number | null>(null);
  const [disputeIndex, setDisputeIndex] = useState<number | null>(null);
  const [resubmitIndex, setResubmitIndex] = useState<number | null>(null);
  const [timeoutIndex, setTimeoutIndex] = useState<number | null>(null);
  const [escalateIndex, setEscalateIndex] = useState<number | null>(null);
  const pendingDeliveryRef = useRef<{ milestoneIndex: number; reference: string } | null>(null);
  const pendingResubmitRef = useRef<{ milestoneIndex: number; reference: string } | null>(null);
  const pendingDisputeRef = useRef<{ milestoneIndex: number; reason: string } | null>(null);

  const {
    writeContract: writeSubmit,
    data: submitTxHash,
    isPending: isSubmitPending,
    error: submitError,
  } = useWriteContract();

  const { isLoading: isSubmitConfirming, isSuccess: isSubmitSuccess } =
    useWaitForTransactionReceipt({
      hash: submitTxHash,
      query: { enabled: !!submitTxHash },
    });

  const {
    writeContract: writeApproveMilestone,
    data: approveMilestoneTxHash,
    isPending: isApproveMilestonePending,
    error: approveMilestoneError,
  } = useWriteContract();

  const { isLoading: isApproveMilestoneConfirming, isSuccess: isApproveMilestoneSuccess } =
    useWaitForTransactionReceipt({
      hash: approveMilestoneTxHash,
      query: { enabled: !!approveMilestoneTxHash },
    });

  const {
    writeContract: writeCancelEscrow,
    data: cancelTxHash,
    isPending: isCancelPending,
    error: cancelError,
  } = useWriteContract();

  const { isLoading: isCancelConfirming, isSuccess: isCancelSuccess } =
    useWaitForTransactionReceipt({
      hash: cancelTxHash,
      query: { enabled: !!cancelTxHash },
    });

  const {
    writeContract: writeClaimAutoApproval,
    data: claimTxHash,
    isPending: isClaimPending,
    error: claimError,
  } = useWriteContract();

  const { isLoading: isClaimConfirming, isSuccess: isClaimSuccess } =
    useWaitForTransactionReceipt({
      hash: claimTxHash,
      query: { enabled: !!claimTxHash },
    });

  const {
    writeContract: writeOpenDispute,
    data: openDisputeTxHash,
    isPending: isOpenDisputePending,
    error: openDisputeError,
  } = useWriteContract();

  const { isLoading: isOpenDisputeConfirming, isSuccess: isOpenDisputeSuccess } =
    useWaitForTransactionReceipt({
      hash: openDisputeTxHash,
      query: { enabled: !!openDisputeTxHash },
    });

  const {
    writeContract: writeResubmit,
    data: resubmitTxHash,
    isPending: isResubmitPending,
    error: resubmitError,
  } = useWriteContract();

  const { isLoading: isResubmitConfirming, isSuccess: isResubmitSuccess } =
    useWaitForTransactionReceipt({
      hash: resubmitTxHash,
      query: { enabled: !!resubmitTxHash },
    });

  const {
    writeContract: writeClaimDisputeTimeout,
    data: disputeTimeoutTxHash,
    isPending: isDisputeTimeoutPending,
    error: disputeTimeoutError,
  } = useWriteContract();

  const { isLoading: isDisputeTimeoutConfirming, isSuccess: isDisputeTimeoutSuccess } =
    useWaitForTransactionReceipt({
      hash: disputeTimeoutTxHash,
      query: { enabled: !!disputeTimeoutTxHash },
    });

  const {
    writeContract: writeAcceptProject,
    data: acceptTxHash,
    isPending: isAcceptPending,
    error: acceptError,
  } = useWriteContract();

  const { isLoading: isAcceptConfirming, isSuccess: isAcceptSuccess } =
    useWaitForTransactionReceipt({
      hash: acceptTxHash,
      query: { enabled: !!acceptTxHash },
    });

  const {
    writeContract: writeRejectProject,
    data: rejectTxHash,
    isPending: isRejectPending,
    error: rejectError,
  } = useWriteContract();

  const { isLoading: isRejectConfirming, isSuccess: isRejectSuccess } =
    useWaitForTransactionReceipt({
      hash: rejectTxHash,
      query: { enabled: !!rejectTxHash },
    });

  const {
    writeContract: writeEscalate,
    data: escalateTxHash,
    isPending: isEscalatePending,
    error: escalateError,
  } = useWriteContract();

  const { isLoading: isEscalateConfirming, isSuccess: isEscalateSuccess } =
    useWaitForTransactionReceipt({
      hash: escalateTxHash,
      query: { enabled: !!escalateTxHash },
    });

  // Refetch sellerAccepted after accept/reject confirms
  useEffect(() => {
    if (isAcceptSuccess) refetchSellerAccepted();
  }, [isAcceptSuccess, refetchSellerAccepted]);

  useEffect(() => {
    if (!isRejectSuccess) return;
    refetchCancelled();
    // Fetch the timeline now and again once the listener has written the rejection
    fetchEvents();
    const timeout = setTimeout(fetchEvents, 4000);
    return () => clearTimeout(timeout);
  }, [isRejectSuccess, refetchCancelled, fetchEvents]);

  // A wallet relay (e.g. MetaMask Smart Transactions) can report an error for a
  // tx that still went through. Re-read the chain so the page shows what happened.
  useEffect(() => {
    if (!acceptError && !rejectError) return;
    const recheck = () => {
      refetchSellerAccepted();
      refetchCancelled();
    };
    recheck();
    const timeout = setTimeout(recheck, 4000);
    return () => clearTimeout(timeout);
  }, [acceptError, rejectError, refetchSellerAccepted, refetchCancelled]);

  // Track escalated milestones for processing spinner
  const lastEscalateIndexRef = useRef<number | null>(null);
  const pendingEscalationRef = useRef<{ milestoneIndex: number; reason: string } | null>(null);

  useEffect(() => {
    if (!isEscalateSuccess || lastEscalateIndexRef.current === null) return;
    setProcessingMilestones((prev) => new Map(prev).set(lastEscalateIndexRef.current!, "ESCALATED"));

    // Save the text only after the tx confirms — the backend checks it against the new on-chain hash
    if (pendingEscalationRef.current) {
      const { milestoneIndex, reason } = pendingEscalationRef.current;
      pendingEscalationRef.current = null;
      if (API_URL) {
        postWithRetry(`${API_URL}/projects/${escrowAddress}/milestones/${milestoneIndex}/escalation-reason`, { escalationReason: reason });
      }
    }
  }, [isEscalateSuccess, escrowAddress]);

  function handleAcceptProject() {
    writeAcceptProject({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "acceptProject",
    });
  }

  function handleRejectProject() {
    writeRejectProject({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "rejectProject",
    });
  }

  function handleEscalate(milestoneIndex: number) {
    const reason = escalationReasons[milestoneIndex]?.trim();
    if (!reason) return;
    lastEscalateIndexRef.current = milestoneIndex;
    setEscalateIndex(milestoneIndex);
    pendingEscalationRef.current = { milestoneIndex, reason };
    writeEscalate({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "sellerEscalate",
      args: [BigInt(milestoneIndex), keccak256(toHex(reason))],
    });
  }

  async function handleSaveSellerResponse(milestoneIndex: number) {
    const text = (sellerResponseDrafts[milestoneIndex] ?? "").trim();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!text || !apiUrl || !walletClient) return;
    setSellerResponseSaving(milestoneIndex);
    setSellerResponseError((prev) => ({ ...prev, [milestoneIndex]: "" }));
    try {
      const res = await authFetch(`${apiUrl}/projects/${escrowAddress}/milestones/${milestoneIndex}/seller-response`, walletClient, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerResponse: text }),
      });
      if (!res.ok) throw new Error();
      setSavedSellerResponses((prev) => ({ ...prev, [milestoneIndex]: text }));
      setSellerResponseExpanded((prev) => ({ ...prev, [milestoneIndex]: false }));
    } catch {
      setSellerResponseError((prev) => ({ ...prev, [milestoneIndex]: "Could not save your response. Please try again." }));
    } finally {
      setSellerResponseSaving(null);
    }
  }


  // When a tx confirms, add that milestone to the processing map (waiting for backend)
  useEffect(() => {
    if (!isApproveMilestoneSuccess || lastApprovedIndexRef.current === null) return;
    const index = lastApprovedIndexRef.current;
    setProcessingMilestones((prev) => new Map(prev).set(index, "PAID"));
    setConfirmedPaids((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }, [isApproveMilestoneSuccess]);

  useEffect(() => {
    if (!isClaimSuccess || lastClaimIndexRef.current === null) return;
    const index = lastClaimIndexRef.current;
    setProcessingMilestones((prev) => new Map(prev).set(index, "PAID"));
    setConfirmedPaids((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }, [isClaimSuccess]);

  useEffect(() => {
    if (!isSubmitSuccess || lastSubmittedIndexRef.current === null) return;
    const index = lastSubmittedIndexRef.current;
    setProcessingMilestones((prev) => new Map(prev).set(index, "SUBMITTED"));
    setConfirmedSubmits((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });

    // Save delivery reference to backend only after tx confirms.
    // The card switches to the submitted layout at this point — once — and
    // stays there while the listener catches up.
    if (pendingDeliveryRef.current) {
      const { milestoneIndex, reference } = pendingDeliveryRef.current;
      pendingDeliveryRef.current = null;
      setOptimisticDeliveries((prev) => ({ ...prev, [milestoneIndex]: reference }));
      if (API_URL) {
        postWithRetry(`${API_URL}/projects/${escrowAddress}/milestones/${milestoneIndex}/delivery`, { deliveryReference: reference }).then((ok) => {
          if (ok) return;
          // Retry exhausted — roll back optimistic state and restore input
          setConfirmedSubmits((prev) => {
            const next = new Set(prev);
            next.delete(milestoneIndex);
            return next;
          });
          setOptimisticDeliveries((prev) => { const next = { ...prev }; delete next[milestoneIndex]; return next; });
          setDeliveryInputs((prev) => ({ ...prev, [milestoneIndex]: reference }));
          setDeliverySaveError((prev) => ({ ...prev, [milestoneIndex]: "Could not save delivery reference. Please try again." }));
        });
      }
    }
  }, [isSubmitSuccess, escrowAddress]);

  useEffect(() => {
    if (!isOpenDisputeSuccess || lastDisputedIndexRef.current === null) return;
    const index = lastDisputedIndexRef.current;
    setProcessingMilestones((prev) => new Map(prev).set(index, "DISPUTED"));
    setConfirmedDisputes((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });

    setDisputeExpanded((prev) => ({ ...prev, [index]: false }));
    setDisputeInputs((prev) => {
      if (!(index in prev)) return prev;
      const next = { ...prev };
      delete next[index];
      return next;
    });

    if (pendingDisputeRef.current) {
      const { milestoneIndex, reason } = pendingDisputeRef.current;
      pendingDisputeRef.current = null;
      setOptimisticDisputes((prev) => ({ ...prev, [milestoneIndex]: reason }));
      if (API_URL) {
        postWithRetry(`${API_URL}/projects/${escrowAddress}/milestones/${milestoneIndex}/dispute`, { disputeReason: reason });
      }
    }
  }, [isOpenDisputeSuccess, escrowAddress]);

  useEffect(() => {
    if (!isResubmitSuccess || lastResubmitIndexRef.current === null) return;
    setProcessingMilestones((prev) => new Map(prev).set(lastResubmitIndexRef.current!, "SUBMITTED"));

    if (pendingResubmitRef.current) {
      const { milestoneIndex, reference } = pendingResubmitRef.current;
      pendingResubmitRef.current = null;
      if (API_URL) {
        postWithRetry(`${API_URL}/projects/${escrowAddress}/milestones/${milestoneIndex}/delivery`, { deliveryReference: reference }).then((ok) => {
          if (ok) return;
          // Retry exhausted — restore input to the frozen value and show error
          setResubmitInputs((prev) => ({ ...prev, [milestoneIndex]: reference }));
          setDeliverySaveError((prev) => ({ ...prev, [milestoneIndex]: "Could not save delivery reference. Please try again." }));
        });
      }
    }
  }, [isResubmitSuccess, escrowAddress]);

  useEffect(() => {
    if (!isDisputeTimeoutSuccess || lastTimeoutIndexRef.current === null) return;
    setProcessingMilestones((prev) => new Map(prev).set(lastTimeoutIndexRef.current!, "REFUNDED"));
  }, [isDisputeTimeoutSuccess]);


  // Poll backend every 2s while any milestone is processing.
  // Also trigger an immediate events fetch so syncSingleEscrow runs.
  // Stop automatically after 30s so the spinner never runs forever.
  useEffect(() => {
    if (processingMilestones.size === 0) return;
    fetchEvents();
    const interval = setInterval(() => { fetchMilestones(); fetchEvents(); }, 2000);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      setProcessingMilestones(new Map());
    }, 30_000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchEvents is stable, adding it causes infinite loops
  }, [processingMilestones.size, fetchMilestones]);

  // When milestones data updates, remove any that reached their expected status
  useEffect(() => {
    if (processingMilestones.size === 0) return;
    const updated = new Map(processingMilestones);
    const syncedSubmits: number[] = [];
    const syncedDisputes: number[] = [];
    const syncedPaids: number[] = [];
    let changed = false;
    for (const [idx, expectedStatus] of processingMilestones) {
      const m = enrichedMilestones.find((m) => m.milestoneIndex === idx);
      if (m && m.status === expectedStatus) {
        updated.delete(idx);
        changed = true;
        if (expectedStatus === "SUBMITTED") syncedSubmits.push(idx);
        if (expectedStatus === "DISPUTED") syncedDisputes.push(idx);
        if (expectedStatus === "PAID") syncedPaids.push(idx);
      }
    }
    if (changed) setProcessingMilestones(updated);
    if (syncedSubmits.length > 0) {
      setConfirmedSubmits((prev) => {
        const next = new Set(prev);
        for (const idx of syncedSubmits) next.delete(idx);
        return next;
      });
    }
    if (syncedDisputes.length > 0) {
      setConfirmedDisputes((prev) => {
        const next = new Set(prev);
        for (const idx of syncedDisputes) next.delete(idx);
        return next;
      });
    }
    if (syncedPaids.length > 0) {
      setConfirmedPaids((prev) => {
        const next = new Set(prev);
        for (const idx of syncedPaids) next.delete(idx);
        return next;
      });
    }
  }, [enrichedMilestones, processingMilestones]);

  function handleApprove() {
    if (!totalAmount) return;
    writeApprove({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "approve",
      args: [escrowAddress, totalAmount as bigint],
    });
  }

  function handleFund() {
    writeFund({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "fund",
    });
  }

  useEffect(() => {
    if (isFundSuccess) {
      fetchMilestones();
      // Re-fetch timeline after a short delay so the listener has time to write fundedAt
      setTimeout(() => fetchEvents(), 4000);
    }
  }, [isFundSuccess, fetchMilestones, fetchEvents]);

  useEffect(() => {
    if (!isCancelSuccess) return;
    refetchCancelled();
    fetchMilestones();
    fetchEvents();
    const timeout = setTimeout(fetchEvents, 4000);
    return () => clearTimeout(timeout);
  }, [isCancelSuccess, refetchCancelled, fetchMilestones, fetchEvents]);

  // Project-level actions change the status at the top of the page — scroll there so the user sees it.
  // Milestone actions are left out on purpose: the user should stay at the milestone they acted on.
  useEffect(() => {
    if (isAcceptSuccess || isRejectSuccess || isFundSuccess || isCancelSuccess) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [isAcceptSuccess, isRejectSuccess, isFundSuccess, isCancelSuccess]);

  const autoApprovalDays =
    autoApprovalDaysOnChain != null
      ? Number(autoApprovalDaysOnChain)
      : escrowMeta?.autoApprovalDays ?? 14;
  const disputeTimeoutDays =
    disputeTimeoutDaysOnChain != null
      ? Number(disputeTimeoutDaysOnChain)
      : escrowMeta?.disputeTimeoutDays ?? 30;
  const correctionWindowDays =
    correctionWindowDaysOnChain != null
      ? Number(correctionWindowDaysOnChain)
      : escrowMeta?.correctionWindowDays ?? 0;

  const now = useNow();
  const dayMs = 24 * 60 * 60 * 1000;
  const autoApprovalMs = autoApprovalDays * dayMs;
  const disputeTimeoutMs = disputeTimeoutDays * dayMs;
  const correctionWindowMs = correctionWindowDays * dayMs;

  function autoReleaseAt(submittedAt: string | null | undefined): Date | null {
    if (!submittedAt || autoApprovalMs <= 0) return null;
    const submitted = new Date(submittedAt);
    if (Number.isNaN(submitted.getTime())) return null;
    return new Date(submitted.getTime() + autoApprovalMs);
  }

  function isDisputeResubmitWindow(disputeOpenedAt: string | null | undefined): boolean {
    if (!disputeOpenedAt || correctionWindowMs <= 0) return false;
    return now - new Date(disputeOpenedAt).getTime() < correctionWindowMs;
  }

  function isDisputeTimeoutReady(disputeOpenedAt: string | null | undefined): boolean {
    if (!disputeOpenedAt || disputeTimeoutMs <= 0) return false;
    return now - new Date(disputeOpenedAt).getTime() >= disputeTimeoutMs;
  }

  function handleClaimAutoApproval(milestoneIndex: number) {
    setClaimIndex(milestoneIndex);
    lastClaimIndexRef.current = milestoneIndex;
    writeClaimAutoApproval({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "claimAutoApproval",
      args: [BigInt(milestoneIndex)],
    });
  }

  function milestoneHeaderStatus(index: number, status: string): string {
    const processing = processingMilestones.get(index);
    if (processing) return processing;
    if (confirmedPaids.has(index) && status !== "REFUNDED" && status !== "RESOLVED") return "PAID";
    if (confirmedSubmits.has(index) && (status === "PENDING" || status === "DISPUTED")) return "SUBMITTED";
    if (confirmedDisputes.has(index) && status === "SUBMITTED") return "DISPUTED";
    return status;
  }

  const isRejected = isRejectSuccess || events.some((e) => e.type === "project_rejected");
  const headerStatus = getDisplayStatus(isRejected ? "SELLER_REJECTED" : "CREATED", {
    sellerAccepted: Boolean(sellerAccepted || isAcceptSuccess),
    funded: Boolean(isFunded || isFundSuccess),
    cancelled: Boolean(isCancelled || isCancelSuccess || isRejectSuccess),
    hasDispute: enrichedMilestones.some((m) => {
      const status = milestoneHeaderStatus(m.milestoneIndex, m.status);
      return status === "DISPUTED" || status === "ESCALATED";
    }),
    allPaid:
      enrichedMilestones.length > 0 &&
      enrichedMilestones.every((m) => {
        const status = milestoneHeaderStatus(m.milestoneIndex, m.status);
        return status === "PAID" || status === "RESOLVED" || status === "REFUNDED";
      }),
    hasSubmitted: enrichedMilestones.some((m) => {
      const status = milestoneHeaderStatus(m.milestoneIndex, m.status);
      return status === "SUBMITTED" || status === "DISPUTED" || status === "ESCALATED" || status === "RESOLVED" || status === "PAID";
    }),
  });
  const headerBadge = statusBadge(headerStatus);

  const allMilestonesPending =
    enrichedMilestones.length > 0 && enrichedMilestones.every((m) => m.status === "PENDING");

  const allMilestonesDone =
    milestones.length > 0 &&
    milestones.every((m) => ["PAID", "REFUNDED", "RESOLVED"].includes(m.status));

  function handleCancelEscrow() {
    writeCancelEscrow({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "cancelEscrow",
    });
  }

  function handleApproveMilestone(milestoneIndex: number) {
    lastApprovedIndexRef.current = milestoneIndex;
    setApproveIndex(milestoneIndex);
    writeApproveMilestone({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "approveMilestone",
      args: [BigInt(milestoneIndex)],
    });
  }

  function handleSubmitDelivery(milestoneIndex: number) {
    lastSubmittedIndexRef.current = milestoneIndex;
    setSubmitIndex(milestoneIndex);
    const ref = deliveryInputs[milestoneIndex]?.trim();
    if (!ref) return;

    // Store reference — shown in the card only after the tx confirms
    pendingDeliveryRef.current = { milestoneIndex, reference: ref };

    const deliveryHash = keccak256(toHex(ref));
    writeSubmit({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "submitMilestone",
      args: [BigInt(milestoneIndex), deliveryHash],
    });
  }

  function handleOpenDispute(milestoneIndex: number) {
    const reason = disputeInputs[milestoneIndex]?.trim();
    if (!reason) return;
    lastDisputedIndexRef.current = milestoneIndex;
    setDisputeIndex(milestoneIndex);
    pendingDisputeRef.current = { milestoneIndex, reason };
    const reasonHash = keccak256(toHex(reason));
    writeOpenDispute({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "openDispute",
      args: [BigInt(milestoneIndex), reasonHash],
    });
  }

  function handleResubmit(milestoneIndex: number) {
    const ref = resubmitInputs[milestoneIndex]?.trim();
    if (!ref) return;
    lastResubmitIndexRef.current = milestoneIndex;
    setResubmitIndex(milestoneIndex);
    // Freeze the reference at sign time — backend save must use this exact value
    pendingResubmitRef.current = { milestoneIndex, reference: ref };
    setDeliverySaveError((prev) => { const next = { ...prev }; delete next[milestoneIndex]; return next; });
    const deliveryHash = keccak256(toHex(ref));
    writeResubmit({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "resubmitDuringDispute",
      args: [BigInt(milestoneIndex), deliveryHash],
    });
  }

  function handleClaimDisputeTimeout(milestoneIndex: number) {
    lastTimeoutIndexRef.current = milestoneIndex;
    setTimeoutIndex(milestoneIndex);
    writeClaimDisputeTimeout({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "claimDisputeTimeout",
      args: [BigInt(milestoneIndex)],
    });
  }

  const sessionPending = !mounted || status === "connecting" || status === "reconnecting";
  const pageReady =
    metaReady &&
    milestonesLoaded &&
    eventsLoaded &&
    isFunded !== undefined &&
    totalAmount !== undefined &&
    seller !== undefined &&
    buyer !== undefined &&
    milestoneCount !== undefined;
  if (!sessionPending && !isConnected) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-lg text-zinc-800">Connect your wallet to view this project</p>
        <ConnectButton />
      </div>
    );
  }
  if (!pageReady) {
    return <div className="min-h-screen bg-zinc-50" />;
  }

  const displayAmount = totalAmount
    ? formatUnits(totalAmount as bigint, 6)
    : "...";

  const hasAccepted = Boolean(sellerAccepted) || isAcceptSuccess;
  const hasFunded = Boolean(isFunded) || isFundSuccess;
  const isClosed = Boolean(isCancelled) || isCancelSuccess || isRejectSuccess;

  const acceptTx: TxAction = { onClick: handleAcceptProject, isPending: isAcceptPending, isConfirming: isAcceptConfirming, error: acceptError };
  const rejectTx: TxAction = { onClick: handleRejectProject, isPending: isRejectPending, isConfirming: isRejectConfirming, error: rejectError };
  const approveTx: TxAction = { onClick: handleApprove, isPending: isApprovePending, isConfirming: isApproveConfirming, error: approveError };
  const fundTx: TxAction = { onClick: handleFund, isPending: isFundPending, isConfirming: isFundConfirming, error: fundError };
  const cancelTx: TxAction = { onClick: handleCancelEscrow, isPending: isCancelPending, isConfirming: isCancelConfirming, error: cancelError };

  return (
    <div className="min-h-screen bg-zinc-50">
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className={`flex items-start justify-between gap-4 ${!metaReady || escrowMeta?.description ? "mb-1" : "mb-6"}`}>
      <div className="min-w-0 flex-1">
      {isEditingTitle ? (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              maxLength={200}
              disabled={titleSaving}
              autoFocus
              className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-lg font-semibold text-zinc-900 outline-none focus:border-zinc-500"
              placeholder="Project name"
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveTitle();
                if (e.key === "Escape") cancelEditTitle();
              }}
            />
            <button
              type="button"
              onClick={() => void saveTitle()}
              disabled={titleSaving}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {titleSaving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={cancelEditTitle}
              disabled={titleSaving}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          {titleError && <p className="mt-2 text-xs text-red-500">{titleError}</p>}
        </div>
      ) : (
        <div className="flex min-h-9 items-center gap-2">
          {metaReady && (
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{displayTitle}</h1>
          )}
          {metaReady && isBuyer && (
            <button
              type="button"
              onClick={startEditTitle}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              aria-label="Rename project"
            >
              <Pencil className="h-3.5 w-3.5" />
              Rename
            </button>
          )}
        </div>
      )}
      </div>
        <button
          onClick={() => router.push("/projects")}
          className="shrink-0 pt-2 text-sm text-zinc-500 hover:text-zinc-900 hover:underline"
        >
          ← Back to Projects
        </button>
      </div>
      {!metaReady ? (
        <div className="mb-6 min-h-5" aria-hidden />
      ) : escrowMeta?.description ? (
        <p className="mb-6 whitespace-pre-line text-sm text-zinc-900">
          {escrowMeta.description}
        </p>
      ) : null}

      <ProjectInfoCard
        escrowAddress={escrowAddress}
        counterpartyRole={isBuyer ? "Seller" : "Buyer"}
        counterpartyAddress={(isBuyer ? seller : buyer) as string}
        counterpartyCompany={isBuyer ? escrowMeta?.sellerCompany : escrowMeta?.buyerCompany}
        status={headerBadge}
        totalAmount={displayAmount}
        milestoneCount={Number(milestoneCount)}
      />

      {isSeller && !hasAccepted && !isClosed && userChecked && !isRegistered && (
        <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <h2 className="mb-2 text-lg font-semibold">Registration Required</h2>
          <p className="mb-4 text-sm text-zinc-800">
            You have been invited to this project. To accept or reject, you must first register your company on StablePay.
          </p>
          <a
            href={`/register?redirect=/projects/${id}`}
            className="inline-block rounded-lg bg-primary px-5 py-2 text-sm text-white transition-colors hover:brightness-110"
          >
            Register Company
          </a>
        </div>
      )}

      {isBuyer && !hasAccepted && !hasFunded && !isClosed && (
        <div className="mb-6 rounded-lg border border-orange-200 bg-orange-50 p-4">
          <p className="text-sm text-orange-700">
            Waiting for the seller to accept this project before you can fund it.
          </p>
        </div>
      )}

      {isSeller && hasAccepted && !hasFunded && !isClosed && (
        <div className="mb-6 rounded-lg border border-orange-200 bg-orange-50 p-4">
          <p className="text-sm text-orange-700">
            You accepted this project. Waiting for the buyer to fund the escrow before you can start work.
          </p>
        </div>
      )}

      {isBuyer && hasAccepted && !hasFunded && !isClosed && (
        <FundProject
          amount={displayAmount}
          isApproved={hasEnoughAllowance || isApproveSuccess}
          approve={approveTx}
          fund={fundTx}
          cancel={cancelTx}
        />
      )}

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-xl border border-zinc-300 bg-zinc-50 p-1">
        {(["overview", "timeline"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium capitalize transition-all ${
              activeTab === tab
                ? "bg-white text-zinc-900 shadow-sm border border-zinc-200"
                : "text-zinc-500 hover:text-zinc-900"
            }`}
          >
            {tab === "overview" ? "Overview" : `Timeline${events.length > 0 ? ` (${events.length})` : ""}`}
          </button>
        ))}
      </div>

      {activeTab === "timeline" && <ProjectTimeline events={events} milestones={milestones} />}

      {activeTab === "overview" && (<>

      {isFunded === false && !isFundSuccess && enrichedMilestones.length > 0 && (
        <div className="mb-6 space-y-3">
          <h2 className="text-lg font-semibold">Milestones</h2>
          {enrichedMilestones.map((m) => {
            const grossBase = BigInt(m.amount);
            const feeBase = calcFeeBase(grossBase, PLATFORM_FEE_BPS);
            const sellerReceives = grossBase - feeBase;
            return (
              <div
                key={m.milestoneIndex}
                className="rounded-xl border border-zinc-300 bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.07)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <MilestoneTitle index={m.milestoneIndex} label={m.label} />
                    <p className="mt-1 text-xs text-zinc-500">
                      Amount {formatUSDC(grossBase)} USDC
                      {!isClosed && ` · platform fee ${formatUSDC(feeBase)} USDC (2.5%)`}
                    </p>
                  </div>
                  {/* A closed project was never funded — no money moved, so no payout to show */}
                  {isClosed ? (
                    <p className="shrink-0 text-xs font-medium text-zinc-500">Not funded</p>
                  ) : (
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-medium text-zinc-500">Seller receives</p>
                      <p className="font-semibold text-emerald-700">{formatUSDC(sellerReceives)} USDC</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isSeller && !hasAccepted && !isClosed && userChecked && isRegistered && (
        <ProjectInvitation accept={acceptTx} reject={rejectTx} />
      )}

      {isBuyer && (isFunded || isFundSuccess) && allMilestonesPending && !isCancelled && !isCancelSuccess && (
        <div className="mb-6 rounded-lg border border-red-200 p-4">
          <p className="mb-2 text-sm text-zinc-800">
            No work has started yet. You can cancel this project and recover all funds.
          </p>
          <button
            onClick={handleCancelEscrow}
            disabled={isCancelPending || isCancelConfirming}
            className="w-full rounded-lg border border-red-400 px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
          >
            {isCancelPending
              ? "Confirm in Wallet..."
              : isCancelConfirming
              ? "Waiting for Confirmation..."
              : "Cancel Project & Refund"}
          </button>
          {cancelError && (
            <p className="mt-2 text-xs text-red-500">{parseContractError(cancelError)}</p>
          )}
        </div>
      )}

      {(isCancelled || isCancelSuccess) && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            {isRejected
              ? "This project was rejected by the seller."
              : isFunded
              ? "This project has been cancelled and all funds have been returned to the buyer."
              : "This project has been cancelled."}
          </p>
        </div>
      )}

      {(isFunded || isFundSuccess) && enrichedMilestones.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Milestones</h2>
          {enrichedMilestones.map((m) => {
            const locallyPaid = confirmedPaids.has(m.milestoneIndex);
            const displayStatus = (isCancelled || isCancelSuccess) && m.status !== "PAID"
              ? "REFUNDED"
              : locallyPaid && m.status !== "REFUNDED" && m.status !== "RESOLVED"
              ? "PAID"
              : m.status;
            const processingAs = processingMilestones.get(m.milestoneIndex);
            const locallySubmitted = confirmedSubmits.has(m.milestoneIndex);
            const locallyDisputed = confirmedDisputes.has(m.milestoneIndex);
            const showProcessingBadge =
              processingAs != null &&
              !(processingAs === "SUBMITTED" && locallySubmitted) &&
              !(processingAs === "DISPUTED" && locallyDisputed) &&
              !(processingAs === "PAID" && locallyPaid);
            const badgeStatus = locallySubmitted && (displayStatus === "PENDING" || displayStatus === "DISPUTED")
              ? "SUBMITTED"
              : locallyDisputed && displayStatus === "SUBMITTED"
              ? "DISPUTED"
              : displayStatus;
            const milestoneBadge = milestoneStatusBadge(badgeStatus, !!m.disputeOpenedAt);
            // Seller's options when the buyer has disputed this milestone
            const sellerCanAnswerDispute =
              isSeller &&
              displayStatus === "DISPUTED" &&
              !processingMilestones.has(m.milestoneIndex) &&
              m.disputeOpenedBy?.toLowerCase() === (buyer as string | undefined)?.toLowerCase();
            const inCorrectionWindow = isDisputeResubmitWindow(m.disputeOpenedAt);
            const approvingThis = approveIndex === m.milestoneIndex;
            return (
            <div
              key={m.milestoneIndex}
              className="rounded-xl border border-zinc-300 bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.07)]"
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <MilestoneTitle index={m.milestoneIndex} label={m.label} />
                {showProcessingBadge ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 border border-orange-200 px-3 py-1 text-xs font-medium text-orange-600">
                    <svg className="h-3 w-3 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Processing...
                  </span>
                ) : (
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${milestoneBadge.color}`}>
                    {milestoneBadge.label}
                  </span>
                )}
              </div>
              <MilestoneHistory
                milestone={m}
                status={displayStatus}
                processingAs={processingAs}
                locallyPaid={locallyPaid}
                locallyDisputed={locallyDisputed}
                deliveryText={m.deliveryReference || optimisticDeliveries[m.milestoneIndex]}
                disputeReason={m.disputeReason ?? optimisticDisputes[m.milestoneIndex]}
                disputeOpenedBy={m.disputeOpenedBy ?? (locallyDisputed ? address : undefined)}
                disputeOpenedAt={m.disputeOpenedAt ?? (locallyDisputed ? new Date().toISOString() : undefined)}
                sellerResponse={savedSellerResponses[m.milestoneIndex] ?? m.sellerResponse}
                escalationReason={m.escalationReason ?? escalationReasons[m.milestoneIndex]}
                sellerAward={m.sellerAward ?? onChainAwards[m.milestoneIndex]}
                buyer={buyer as string | undefined}
                buyerCompany={escrowMeta?.buyerCompany}
                sellerCompany={escrowMeta?.sellerCompany}
              />
              {isBuyer && displayStatus === "SUBMITTED" && !processingMilestones.has(m.milestoneIndex) && !locallyDisputed && !locallyPaid && (
                <BuyerMilestoneActions
                  releaseAt={autoReleaseAt(m.submittedAt)}
                  now={now}
                  approve={{
                    onClick: () => handleApproveMilestone(m.milestoneIndex),
                    isPending: isApproveMilestonePending && approvingThis,
                    isConfirming: isApproveMilestoneConfirming && approvingThis,
                    error: approvingThis ? approveMilestoneError : null,
                  }}
                  approveBusyElsewhere={(isApproveMilestonePending || isApproveMilestoneConfirming) && !approvingThis}
                  dispute={{
                    onClick: () => handleOpenDispute(m.milestoneIndex),
                    isPending: isOpenDisputePending && disputeIndex === m.milestoneIndex,
                    isConfirming: isOpenDisputeConfirming && disputeIndex === m.milestoneIndex,
                    error: disputeIndex === m.milestoneIndex ? openDisputeError : null,
                  }}
                  disputeBusyElsewhere={(isOpenDisputePending || isOpenDisputeConfirming) && disputeIndex !== m.milestoneIndex}
                  disputeOpen={!!disputeExpanded[m.milestoneIndex]}
                  onDisputeOpenChange={(open) => setDisputeExpanded((prev) => ({ ...prev, [m.milestoneIndex]: open }))}
                  disputeReason={disputeInputs[m.milestoneIndex] ?? ""}
                  onDisputeReasonChange={(reason) => setDisputeInputs((prev) => ({ ...prev, [m.milestoneIndex]: reason }))}
                />
              )}
              {isSeller &&
                (displayStatus === "SUBMITTED" || locallySubmitted) &&
                !locallyPaid &&
                (processingAs == null || processingAs === "SUBMITTED") && (
                <SellerAwaitingApproval
                  releaseAt={autoReleaseAt(m.submittedAt)}
                  now={now}
                  autoApprovalDays={autoApprovalDays}
                  claim={{
                    onClick: () => handleClaimAutoApproval(m.milestoneIndex),
                    isPending: isClaimPending && claimIndex === m.milestoneIndex,
                    isConfirming: isClaimConfirming && claimIndex === m.milestoneIndex,
                    error: claimIndex === m.milestoneIndex ? claimError : null,
                  }}
                  claimBusyElsewhere={(isClaimPending || isClaimConfirming) && claimIndex !== m.milestoneIndex}
                />
              )}
              {isSeller && displayStatus === "PENDING" && !processingMilestones.has(m.milestoneIndex) && !locallySubmitted && (
                <DeliveryForm
                  placeholder="Delivery reference (URL, IPFS hash, description...)"
                  buttonLabel="Submit Delivery"
                  value={deliveryInputs[m.milestoneIndex] ?? ""}
                  onChange={(value) => setDeliveryInputs((prev) => ({ ...prev, [m.milestoneIndex]: value }))}
                  send={{
                    onClick: () => handleSubmitDelivery(m.milestoneIndex),
                    isPending: isSubmitPending && submitIndex === m.milestoneIndex,
                    isConfirming: isSubmitConfirming && submitIndex === m.milestoneIndex,
                    error: submitIndex === m.milestoneIndex ? submitError : null,
                  }}
                  busyElsewhere={(isSubmitPending || isSubmitConfirming) && submitIndex !== m.milestoneIndex}
                  saveError={deliverySaveError[m.milestoneIndex]}
                />
              )}
              {sellerCanAnswerDispute && inCorrectionWindow && (
                <>
                  <DeliveryForm
                    intro={`You can resubmit your delivery within the ${dayLabel(correctionWindowDays)} correction window.`}
                    placeholder="New delivery reference (URL, IPFS hash, description...)"
                    buttonLabel="Resubmit Delivery"
                    value={resubmitInputs[m.milestoneIndex] ?? ""}
                    onChange={(value) => setResubmitInputs((prev) => ({ ...prev, [m.milestoneIndex]: value }))}
                    send={{
                      onClick: () => handleResubmit(m.milestoneIndex),
                      isPending: isResubmitPending && resubmitIndex === m.milestoneIndex,
                      isConfirming: isResubmitConfirming && resubmitIndex === m.milestoneIndex,
                      error: resubmitIndex === m.milestoneIndex ? resubmitError : null,
                    }}
                    busyElsewhere={(isResubmitPending || isResubmitConfirming) && resubmitIndex !== m.milestoneIndex}
                    saveError={deliverySaveError[m.milestoneIndex]}
                  />
                  {/* Escalating only skips the correction window, so it is offered only while that window is open */}
                  <EscalateDispute
                    open={!!escalationExpanded[m.milestoneIndex]}
                    onOpenChange={(open) => setEscalationExpanded((prev) => ({ ...prev, [m.milestoneIndex]: open }))}
                    reason={escalationReasons[m.milestoneIndex] ?? ""}
                    onReasonChange={(reason) => setEscalationReasons((prev) => ({ ...prev, [m.milestoneIndex]: reason }))}
                    escalate={{
                      onClick: () => handleEscalate(m.milestoneIndex),
                      isPending: isEscalatePending && escalateIndex === m.milestoneIndex,
                      isConfirming: isEscalateConfirming && escalateIndex === m.milestoneIndex,
                      error: escalateIndex === m.milestoneIndex ? escalateError : null,
                    }}
                    busyElsewhere={(isEscalatePending || isEscalateConfirming) && escalateIndex !== m.milestoneIndex}
                  />
                </>
              )}
              {sellerCanAnswerDispute && !inCorrectionWindow && !isDisputeTimeoutReady(m.disputeOpenedAt) && (
                <DisputeResponseForm
                  correctionWindowDays={correctionWindowDays}
                  savedResponse={savedSellerResponses[m.milestoneIndex] ?? m.sellerResponse}
                  open={!!sellerResponseExpanded[m.milestoneIndex]}
                  onOpen={() => {
                    setSellerResponseDrafts((prev) => ({ ...prev, [m.milestoneIndex]: savedSellerResponses[m.milestoneIndex] ?? m.sellerResponse ?? "" }));
                    setSellerResponseExpanded((prev) => ({ ...prev, [m.milestoneIndex]: true }));
                  }}
                  onCancel={() => setSellerResponseExpanded((prev) => ({ ...prev, [m.milestoneIndex]: false }))}
                  draft={sellerResponseDrafts[m.milestoneIndex] ?? ""}
                  onDraftChange={(draft) => setSellerResponseDrafts((prev) => ({ ...prev, [m.milestoneIndex]: draft }))}
                  saving={sellerResponseSaving === m.milestoneIndex}
                  onSave={() => handleSaveSellerResponse(m.milestoneIndex)}
                  error={sellerResponseError[m.milestoneIndex]}
                />
              )}
              {isPlatform && (displayStatus === "DISPUTED" || displayStatus === "ESCALATED") && !processingMilestones.has(m.milestoneIndex) && (
                <div className="mt-3">
                  <a
                    href={`/dispute-management/${escrowAddress}`}
                    className="flex w-full items-center justify-center rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100"
                  >
                    Handle Dispute →
                  </a>
                </div>
              )}
              {(isBuyer || isSeller) && displayStatus === "DISPUTED" && !processingMilestones.has(m.milestoneIndex) &&
                isDisputeTimeoutReady(m.disputeOpenedAt) && (
                <div className="mt-3">
                  <button
                    onClick={() => handleClaimDisputeTimeout(m.milestoneIndex)}
                    disabled={isDisputeTimeoutPending || isDisputeTimeoutConfirming}
                    className="w-full rounded-lg border border-red-400 px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                  >
                    {isDisputeTimeoutPending && timeoutIndex === m.milestoneIndex
                      ? "Confirm in Wallet..."
                      : isDisputeTimeoutConfirming && timeoutIndex === m.milestoneIndex
                      ? "Waiting for Confirmation..."
                      : isBuyer
                      ? `Claim Timeout Refund (${dayLabel(disputeTimeoutDays)} elapsed)`
                      : "Close Dispute (refund buyer)"}
                  </button>
                  {disputeTimeoutError && timeoutIndex === m.milestoneIndex && (
                    <p className="mt-1 text-xs text-red-500">{parseContractError(disputeTimeoutError)}</p>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {allMilestonesDone && (
        <div className="mt-6 text-center">
          <button
            onClick={() => router.push(`/projects/${escrowAddress}/receipt`)}
            className="rounded-lg bg-zinc-900 px-6 py-2 text-sm text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-black dark:hover:bg-zinc-300"
          >
            View Receipt
          </button>
        </div>
      )}

      </>)}

    </div>
    </div>
  );
}
