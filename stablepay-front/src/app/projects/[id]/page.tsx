"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAccount, useReadContract, useReadContracts, useWalletClient } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { erc20Abi, formatUnits, keccak256, toHex, type Abi } from "viem";
import { Pencil } from "lucide-react";
import StablePayEscrowABI from "@/abi/StablePayEscrow.json";
import { useUser } from "@/hooks/useUser";
import { useNow } from "@/hooks/useNow";
import { useMounted } from "@/hooks/useMounted";
import { useTx } from "@/hooks/useTx";
import { USDC_ADDRESS, PLATFORM_ADDRESS, API_URL, PLATFORM_FEE_BPS } from "@/lib/constants";
import { parseContractError, getMilestoneStatus, getDisplayStatus, statusBadge, formatUSDC, calcFeeBase, dayLabel } from "@/lib/formatters";
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
import { MilestoneStatusBadge } from "@/components/project/MilestoneStatusBadge";
import { DisputeTimeoutButton } from "@/components/project/DisputeTimeoutButton";
import { setWith, setWithout, omitKeys } from "@/lib/collections";
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

/** Escrow values read on load. The order here is the order they are unpacked in below. */
const ESCROW_READS = [
  "totalAmount",
  "funded",
  "cancelled",
  "BUYER",
  "SELLER",
  "milestoneCount",
  "AUTO_APPROVAL_DAYS",
  "DISPUTE_TIMEOUT_DAYS",
  "CORRECTION_WINDOW_DAYS",
  "sellerAccepted",
] as const;

type EscrowMeta = {
  title?: string | null;
  description?: string | null;
  buyerCompany?: string | null;
  sellerCompany?: string | null;
  correctionWindowDays?: number | null;
  autoApprovalDays?: number | null;
  disputeTimeoutDays?: number | null;
};

/** The public and the signed-in detail calls both land here. Keeps what the other one already set. */
function mergeMeta(prev: EscrowMeta | null, data: EscrowMeta): EscrowMeta {
  return {
    title: data.title ?? prev?.title ?? null,
    description: data.description ?? prev?.description ?? null,
    buyerCompany: data.buyerCompany ?? prev?.buyerCompany ?? null,
    sellerCompany: data.sellerCompany ?? prev?.sellerCompany ?? null,
    correctionWindowDays: data.correctionWindowDays ?? prev?.correctionWindowDays ?? null,
    autoApprovalDays: data.autoApprovalDays ?? prev?.autoApprovalDays ?? null,
    disputeTimeoutDays: data.disputeTimeoutDays ?? prev?.disputeTimeoutDays ?? null,
  };
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { address, isConnected, status } = useAccount();
  const { data: walletClient } = useWalletClient();
  const router = useRouter();
  const { isRegistered, checked: userChecked } = useUser();
  const mounted = useMounted();
  const [activeTab, setActiveTab] = useState<"overview" | "timeline">("overview");
  const [escrowMeta, setEscrowMeta] = useState<EscrowMeta | null>(null);
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

    // Kept off walletClient on purpose. A signature must not cancel this read,
    // or the page paints Untitled Project from the chain data alone.
    fetch(`${apiUrl}/projects/detail/${escrowAddress}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setEscrowMeta((prev) => mergeMeta(prev, data));
        setMetaReady(true);
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
        setEscrowMeta((prev) => mergeMeta(prev, data));
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

  // All escrow-level values in one multicall. refetchEscrow re-reads them all (one RPC call).
  const escrowReadContracts = useMemo(
    () =>
      ESCROW_READS.map((functionName) => ({
        address: escrowAddress,
        abi: StablePayEscrowABI.abi as Abi,
        functionName,
      })),
    [escrowAddress],
  );
  const { data: escrowReads, refetch: refetchEscrow } = useReadContracts({ contracts: escrowReadContracts });
  // Read straight off the hook data (not via .map) so React Compiler knows the values are not mutated
  const totalAmount = escrowReads?.[0]?.result;
  const isFunded = escrowReads?.[1]?.result;
  const isCancelled = escrowReads?.[2]?.result;
  const buyer = escrowReads?.[3]?.result;
  const seller = escrowReads?.[4]?.result;
  const milestoneCount = escrowReads?.[5]?.result;
  const autoApprovalDaysOnChain = escrowReads?.[6]?.result;
  const disputeTimeoutDaysOnChain = escrowReads?.[7]?.result;
  const correctionWindowDaysOnChain = escrowReads?.[8]?.result;
  const sellerAccepted = escrowReads?.[9]?.result;

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

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && escrowAddress ? [address, escrowAddress] : undefined,
  });

  const approveUsdcTx = useTx();
  const fundTx = useTx();

  useEffect(() => {
    if (approveUsdcTx.isSuccess) {
      refetchAllowance();
    }
  }, [approveUsdcTx.isSuccess, refetchAllowance]);

  const hasEnoughAllowance =
    allowance !== undefined &&
    totalAmount !== undefined &&
    (allowance as bigint) >= (totalAmount as bigint);

  const isBuyer =
    !!(address && buyer && address.toLowerCase() === (buyer as string).toLowerCase());
  const isSeller =
    !!(address && seller && address.toLowerCase() === (seller as string).toLowerCase());
  const isPlatform = !!(address && PLATFORM_ADDRESS && address.toLowerCase() === PLATFORM_ADDRESS.toLowerCase());

  const displayTitle = escrowMeta?.title || "Untitled Project";

  const startEditTitle = () => {
    setTitleDraft(escrowMeta?.title || "");
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
    // A missing key reads as closed (!!disputeExpanded[i]), so removing it closes the form
    setDisputeExpanded((prev) => omitKeys(prev, toClear));
    setDisputeInputs((prev) => omitKeys(prev, toClear));
    setOptimisticDisputes((prev) => omitKeys(prev, toClear));
    setConfirmedDisputes((prev) => setWithout(prev, toClear));
  }, [enrichedMilestones]);

  // Tracks which milestones are waiting for backend to confirm the new status.
  // Map<milestoneIndex, expectedStatus> e.g. Map(0 → "PAID")
  const [processingMilestones, setProcessingMilestones] = useState<Map<number, string>>(new Map());
  const pendingDeliveryRef = useRef<{ milestoneIndex: number; reference: string } | null>(null);
  const pendingResubmitRef = useRef<{ milestoneIndex: number; reference: string } | null>(null);
  const pendingDisputeRef = useRef<{ milestoneIndex: number; reason: string } | null>(null);
  const pendingEscalationRef = useRef<{ milestoneIndex: number; reason: string } | null>(null);

  // A confirmed milestone tx: show the card as processing until the backend has the new status
  const markProcessing = (index: number, expectedStatus: string) =>
    setProcessingMilestones((prev) => new Map(prev).set(index, expectedStatus));

  const approveMilestoneTx = useTx((index) => {
    markProcessing(index, "PAID");
    setConfirmedPaids((prev) => setWith(prev, index));
  });

  const claimTx = useTx((index) => {
    markProcessing(index, "PAID");
    setConfirmedPaids((prev) => setWith(prev, index));
  });

  const submitTx = useTx((index) => {
    markProcessing(index, "SUBMITTED");
    setConfirmedSubmits((prev) => setWith(prev, index));

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
          setConfirmedSubmits((prev) => setWithout(prev, [milestoneIndex]));
          setOptimisticDeliveries((prev) => omitKeys(prev, [milestoneIndex]));
          setDeliveryInputs((prev) => ({ ...prev, [milestoneIndex]: reference }));
          setDeliverySaveError((prev) => ({ ...prev, [milestoneIndex]: "Could not save delivery reference. Please try again." }));
        });
      }
    }
  });

  const openDisputeTx = useTx((index) => {
    markProcessing(index, "DISPUTED");
    setConfirmedDisputes((prev) => setWith(prev, index));
    setDisputeExpanded((prev) => ({ ...prev, [index]: false }));
    setDisputeInputs((prev) => omitKeys(prev, [index]));

    if (pendingDisputeRef.current) {
      const { milestoneIndex, reason } = pendingDisputeRef.current;
      pendingDisputeRef.current = null;
      setOptimisticDisputes((prev) => ({ ...prev, [milestoneIndex]: reason }));
      if (API_URL) {
        postWithRetry(`${API_URL}/projects/${escrowAddress}/milestones/${milestoneIndex}/dispute`, { disputeReason: reason });
      }
    }
  });

  const resubmitTx = useTx((index) => {
    markProcessing(index, "SUBMITTED");

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
  });

  const escalateTx = useTx((index) => {
    markProcessing(index, "ESCALATED");

    // Save the text only after the tx confirms — the backend checks it against the new on-chain hash
    if (pendingEscalationRef.current) {
      const { milestoneIndex, reason } = pendingEscalationRef.current;
      pendingEscalationRef.current = null;
      if (API_URL) {
        postWithRetry(`${API_URL}/projects/${escrowAddress}/milestones/${milestoneIndex}/escalation-reason`, { escalationReason: reason });
      }
    }
  });

  const disputeTimeoutTx = useTx((index) => markProcessing(index, "REFUNDED"));
  const cancelTx = useTx();
  const acceptTx = useTx();
  const rejectTx = useTx();

  // Refetch sellerAccepted after accept/reject confirms
  useEffect(() => {
    if (acceptTx.isSuccess) refetchEscrow();
  }, [acceptTx.isSuccess, refetchEscrow]);

  useEffect(() => {
    if (!rejectTx.isSuccess) return;
    refetchEscrow();
    // Fetch the timeline now and again once the listener has written the rejection
    fetchEvents();
    const timeout = setTimeout(fetchEvents, 4000);
    return () => clearTimeout(timeout);
  }, [rejectTx.isSuccess, refetchEscrow, fetchEvents]);

  // A wallet relay (e.g. MetaMask Smart Transactions) can report an error for a
  // tx that still went through. Re-read the chain so the page shows what happened.
  useEffect(() => {
    if (!acceptTx.error && !rejectTx.error) return;
    refetchEscrow();
    const timeout = setTimeout(refetchEscrow, 4000);
    return () => clearTimeout(timeout);
  }, [acceptTx.error, rejectTx.error, refetchEscrow]);

  function handleAcceptProject() {
    acceptTx.write({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "acceptProject",
    });
  }

  function handleRejectProject() {
    rejectTx.write({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "rejectProject",
    });
  }

  function handleEscalate(milestoneIndex: number) {
    const reason = escalationReasons[milestoneIndex]?.trim();
    if (!reason) return;
    pendingEscalationRef.current = { milestoneIndex, reason };
    escalateTx.write({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "sellerEscalate",
      args: [BigInt(milestoneIndex), keccak256(toHex(reason))],
    }, milestoneIndex);
  }

  async function handleSaveSellerResponse(milestoneIndex: number) {
    const text = (sellerResponseDrafts[milestoneIndex] ?? "").trim();
    if (!text || !API_URL || !walletClient) return;
    setSellerResponseSaving(milestoneIndex);
    setSellerResponseError((prev) => ({ ...prev, [milestoneIndex]: "" }));
    try {
      const res = await authFetch(`${API_URL}/projects/${escrowAddress}/milestones/${milestoneIndex}/seller-response`, walletClient, {
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
  }, [processingMilestones.size, fetchMilestones, fetchEvents]);

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
    setConfirmedSubmits((prev) => setWithout(prev, syncedSubmits));
    setConfirmedDisputes((prev) => setWithout(prev, syncedDisputes));
    setConfirmedPaids((prev) => setWithout(prev, syncedPaids));
  }, [enrichedMilestones, processingMilestones]);

  function handleApprove() {
    if (!totalAmount) return;
    approveUsdcTx.write({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "approve",
      args: [escrowAddress, totalAmount as bigint],
    });
  }

  function handleFund() {
    fundTx.write({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "fund",
    });
  }

  useEffect(() => {
    if (fundTx.isSuccess) {
      fetchMilestones();
      // Re-fetch timeline after a short delay so the listener has time to write fundedAt
      setTimeout(() => fetchEvents(), 4000);
    }
  }, [fundTx.isSuccess, fetchMilestones, fetchEvents]);

  useEffect(() => {
    if (!cancelTx.isSuccess) return;
    refetchEscrow();
    fetchMilestones();
    fetchEvents();
    const timeout = setTimeout(fetchEvents, 4000);
    return () => clearTimeout(timeout);
  }, [cancelTx.isSuccess, refetchEscrow, fetchMilestones, fetchEvents]);

  // Project-level actions change the status at the top of the page — scroll there so the user sees it.
  // Milestone actions are left out on purpose: the user should stay at the milestone they acted on.
  useEffect(() => {
    if (acceptTx.isSuccess || rejectTx.isSuccess || fundTx.isSuccess || cancelTx.isSuccess) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [acceptTx.isSuccess, rejectTx.isSuccess, fundTx.isSuccess, cancelTx.isSuccess]);

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
    claimTx.write({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "claimAutoApproval",
      args: [BigInt(milestoneIndex)],
    }, milestoneIndex);
  }

  function milestoneHeaderStatus(index: number, status: string): string {
    const processing = processingMilestones.get(index);
    if (processing) return processing;
    if (confirmedPaids.has(index) && status !== "REFUNDED" && status !== "RESOLVED") return "PAID";
    if (confirmedSubmits.has(index) && (status === "PENDING" || status === "DISPUTED")) return "SUBMITTED";
    if (confirmedDisputes.has(index) && status === "SUBMITTED") return "DISPUTED";
    return status;
  }

  const isRejected = rejectTx.isSuccess || events.some((e) => e.type === "project_rejected");
  const headerStatus = getDisplayStatus(isRejected ? "SELLER_REJECTED" : "CREATED", {
    sellerAccepted: Boolean(sellerAccepted || acceptTx.isSuccess),
    funded: Boolean(isFunded || fundTx.isSuccess),
    cancelled: Boolean(isCancelled || cancelTx.isSuccess || rejectTx.isSuccess),
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
    cancelTx.write({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "cancelEscrow",
    });
  }

  function handleApproveMilestone(milestoneIndex: number) {
    approveMilestoneTx.write({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "approveMilestone",
      args: [BigInt(milestoneIndex)],
    }, milestoneIndex);
  }

  function handleSubmitDelivery(milestoneIndex: number) {
    const ref = deliveryInputs[milestoneIndex]?.trim();
    if (!ref) return;

    // Store reference — shown in the card only after the tx confirms
    pendingDeliveryRef.current = { milestoneIndex, reference: ref };

    const deliveryHash = keccak256(toHex(ref));
    submitTx.write({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "submitMilestone",
      args: [BigInt(milestoneIndex), deliveryHash],
    }, milestoneIndex);
  }

  function handleOpenDispute(milestoneIndex: number) {
    const reason = disputeInputs[milestoneIndex]?.trim();
    if (!reason) return;
    pendingDisputeRef.current = { milestoneIndex, reason };
    const reasonHash = keccak256(toHex(reason));
    openDisputeTx.write({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "openDispute",
      args: [BigInt(milestoneIndex), reasonHash],
    }, milestoneIndex);
  }

  function handleResubmit(milestoneIndex: number) {
    const ref = resubmitInputs[milestoneIndex]?.trim();
    if (!ref) return;
    // Freeze the reference at sign time — backend save must use this exact value
    pendingResubmitRef.current = { milestoneIndex, reference: ref };
    setDeliverySaveError((prev) => omitKeys(prev, [milestoneIndex]));
    const deliveryHash = keccak256(toHex(ref));
    resubmitTx.write({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "resubmitDuringDispute",
      args: [BigInt(milestoneIndex), deliveryHash],
    }, milestoneIndex);
  }

  function handleClaimDisputeTimeout(milestoneIndex: number) {
    disputeTimeoutTx.write({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "claimDisputeTimeout",
      args: [BigInt(milestoneIndex)],
    }, milestoneIndex);
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

  // pageReady guarantees totalAmount is loaded
  const displayAmount = formatUnits(totalAmount as bigint, 6);

  // The contract takes the fee per milestone and rounds down, so sum each fee
  // instead of taking 2.5% of the total — otherwise the last decimal can differ.
  const grossTotal = enrichedMilestones.reduce((sum, m) => sum + BigInt(m.amount), 0n);
  const feeTotal = enrichedMilestones.reduce(
    (sum, m) => sum + calcFeeBase(BigInt(m.amount), PLATFORM_FEE_BPS),
    0n,
  );
  const sellerTotal = grossTotal - feeTotal;

  const hasAccepted = Boolean(sellerAccepted) || acceptTx.isSuccess;
  const hasFunded = Boolean(isFunded) || fundTx.isSuccess;
  const isClosed = Boolean(isCancelled) || cancelTx.isSuccess || rejectTx.isSuccess;


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
        fee={
          !isClosed && enrichedMilestones.length > 0
            ? { amount: formatUSDC(feeTotal), sellerReceives: formatUSDC(sellerTotal) }
            : undefined
        }
        milestoneCount={Number(milestoneCount)}
      />

      {isSeller && !hasAccepted && !isClosed && userChecked && !isRegistered && (
        <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <h2 className="mb-2 text-lg font-semibold">Registration Required</h2>
          <p className="mb-4 text-sm text-zinc-800">
            You have been invited to this project. To accept or reject, you must first register your company on StablePay.
          </p>
          <Link
            href={`/register?redirect=/projects/${id}`}
            className="inline-block rounded-lg bg-primary px-5 py-2 text-sm text-white transition-colors hover:brightness-110"
          >
            Register Company
          </Link>
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
          isApproved={hasEnoughAllowance || approveUsdcTx.isSuccess}
          approve={{ ...approveUsdcTx.status, onClick: handleApprove }}
          fund={{ ...fundTx.status, onClick: handleFund }}
          cancel={{ ...cancelTx.status, onClick: handleCancelEscrow }}
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

      {!hasFunded && enrichedMilestones.length > 0 && (
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
        <ProjectInvitation
          accept={{ ...acceptTx.status, onClick: handleAcceptProject }}
          reject={{ ...rejectTx.status, onClick: handleRejectProject }}
        />
      )}

      {isBuyer && hasFunded && allMilestonesPending && !isCancelled && !cancelTx.isSuccess && (
        <div className="mb-6 rounded-lg border border-red-200 p-4">
          <p className="mb-2 text-sm text-zinc-800">
            No work has started yet. You can cancel this project and recover all funds.
          </p>
          <button
            onClick={handleCancelEscrow}
            disabled={cancelTx.isPending || cancelTx.isConfirming}
            className="w-full rounded-lg border border-red-400 px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
          >
            {cancelTx.isPending
              ? "Confirm in Wallet..."
              : cancelTx.isConfirming
              ? "Waiting for Confirmation..."
              : "Cancel Project & Refund"}
          </button>
          {cancelTx.error && (
            <p className="mt-2 text-xs text-red-500">{parseContractError(cancelTx.error)}</p>
          )}
        </div>
      )}

      {(isCancelled || cancelTx.isSuccess) && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            {isRejected
              ? "This project was rejected by the seller."
              : hasFunded
              ? "This project has been cancelled and all funds have been returned to the buyer."
              : "This project has been cancelled."}
          </p>
        </div>
      )}

      {hasFunded && enrichedMilestones.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Milestones</h2>
          {enrichedMilestones.map((m) => {
            const locallyPaid = confirmedPaids.has(m.milestoneIndex);
            const displayStatus = (isCancelled || cancelTx.isSuccess) && m.status !== "PAID"
              ? "REFUNDED"
              : locallyPaid && m.status !== "REFUNDED" && m.status !== "RESOLVED"
              ? "PAID"
              : m.status;
            const processingAs = processingMilestones.get(m.milestoneIndex);
            const isProcessing = processingAs != null;
            const locallySubmitted = confirmedSubmits.has(m.milestoneIndex);
            const locallyDisputed = confirmedDisputes.has(m.milestoneIndex);
            const showProcessingBadge =
              isProcessing &&
              !(processingAs === "SUBMITTED" && locallySubmitted) &&
              !(processingAs === "DISPUTED" && locallyDisputed) &&
              !(processingAs === "PAID" && locallyPaid);
            const badgeStatus = locallySubmitted && (displayStatus === "PENDING" || displayStatus === "DISPUTED")
              ? "SUBMITTED"
              : locallyDisputed && displayStatus === "SUBMITTED"
              ? "DISPUTED"
              : displayStatus;
            // Seller's options when the buyer has disputed this milestone
            const sellerCanAnswerDispute =
              isSeller &&
              displayStatus === "DISPUTED" &&
              !isProcessing &&
              m.disputeOpenedBy?.toLowerCase() === (buyer as string | undefined)?.toLowerCase();
            const inCorrectionWindow = isDisputeResubmitWindow(m.disputeOpenedAt);
            return (
            <div
              key={m.milestoneIndex}
              className="rounded-xl border border-zinc-300 bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.07)]"
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <MilestoneTitle index={m.milestoneIndex} label={m.label} />
                <MilestoneStatusBadge status={badgeStatus} hadDispute={!!m.disputeOpenedAt} processing={showProcessingBadge} />
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
                sellerAward={m.sellerAward}
                buyer={buyer as string | undefined}
                buyerCompany={escrowMeta?.buyerCompany}
                sellerCompany={escrowMeta?.sellerCompany}
              />
              {isBuyer && displayStatus === "SUBMITTED" && !isProcessing && !locallyDisputed && !locallyPaid && (
                <BuyerMilestoneActions
                  releaseAt={autoReleaseAt(m.submittedAt)}
                  now={now}
                  approve={{ ...approveMilestoneTx.forIndex(m.milestoneIndex), onClick: () => handleApproveMilestone(m.milestoneIndex) }}
                  approveBusyElsewhere={approveMilestoneTx.busyElsewhere(m.milestoneIndex)}
                  dispute={{ ...openDisputeTx.forIndex(m.milestoneIndex), onClick: () => handleOpenDispute(m.milestoneIndex) }}
                  disputeBusyElsewhere={openDisputeTx.busyElsewhere(m.milestoneIndex)}
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
                  claim={{ ...claimTx.forIndex(m.milestoneIndex), onClick: () => handleClaimAutoApproval(m.milestoneIndex) }}
                  claimBusyElsewhere={claimTx.busyElsewhere(m.milestoneIndex)}
                />
              )}
              {isSeller && displayStatus === "PENDING" && !isProcessing && !locallySubmitted && (
                <DeliveryForm
                  placeholder="Delivery reference (URL, IPFS hash, description...)"
                  buttonLabel="Submit Delivery"
                  value={deliveryInputs[m.milestoneIndex] ?? ""}
                  onChange={(value) => setDeliveryInputs((prev) => ({ ...prev, [m.milestoneIndex]: value }))}
                  send={{ ...submitTx.forIndex(m.milestoneIndex), onClick: () => handleSubmitDelivery(m.milestoneIndex) }}
                  busyElsewhere={submitTx.busyElsewhere(m.milestoneIndex)}
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
                    send={{ ...resubmitTx.forIndex(m.milestoneIndex), onClick: () => handleResubmit(m.milestoneIndex) }}
                    busyElsewhere={resubmitTx.busyElsewhere(m.milestoneIndex)}
                    saveError={deliverySaveError[m.milestoneIndex]}
                  />
                  {/* Escalating only skips the correction window, so it is offered only while that window is open */}
                  <EscalateDispute
                    open={!!escalationExpanded[m.milestoneIndex]}
                    onOpenChange={(open) => setEscalationExpanded((prev) => ({ ...prev, [m.milestoneIndex]: open }))}
                    reason={escalationReasons[m.milestoneIndex] ?? ""}
                    onReasonChange={(reason) => setEscalationReasons((prev) => ({ ...prev, [m.milestoneIndex]: reason }))}
                    escalate={{ ...escalateTx.forIndex(m.milestoneIndex), onClick: () => handleEscalate(m.milestoneIndex) }}
                    busyElsewhere={escalateTx.busyElsewhere(m.milestoneIndex)}
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
              {isPlatform && (displayStatus === "DISPUTED" || displayStatus === "ESCALATED") && !isProcessing && (
                <div className="mt-3">
                  <Link
                    href={`/dispute-management/${escrowAddress}`}
                    className="flex w-full items-center justify-center rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100"
                  >
                    Handle Dispute →
                  </Link>
                </div>
              )}
              {(isBuyer || isSeller) && displayStatus === "DISPUTED" && !isProcessing &&
                isDisputeTimeoutReady(m.disputeOpenedAt) && (
                <DisputeTimeoutButton
                  isBuyer={isBuyer}
                  timeoutLabel={dayLabel(disputeTimeoutDays)}
                  close={{ ...disputeTimeoutTx.forIndex(m.milestoneIndex), onClick: () => handleClaimDisputeTimeout(m.milestoneIndex) }}
                  busyElsewhere={disputeTimeoutTx.busyElsewhere(m.milestoneIndex)}
                />
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
