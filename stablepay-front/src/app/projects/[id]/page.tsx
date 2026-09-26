"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useWalletClient, usePublicClient } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { formatUnits, keccak256, toHex } from "viem";
import { Pencil, Copy, Check } from "lucide-react";
import StablePayEscrowABI from "@/abi/StablePayEscrow.json";
import { useUser } from "@/hooks/useUser";
import { USDC_ADDRESS, PLATFORM_ADDRESS, API_URL, BASESCAN_URL } from "@/lib/constants";
import { parseContractError, getMilestoneStatus, getDisplayStatus, statusBadge, milestoneStatusBadge, decodeTitle, formatUSDC, calcFeeBase } from "@/lib/formatters";
import { MilestoneTitle } from "@/components/shared/MilestoneTitle";
import { authFetch } from "@/lib/authFetch";
import { renameProjectTitle } from "@/services/projects";

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

type ProjectEvent = {
  type: string;
  timestamp: string;
  milestoneIndex: number | null;
};

function getEventLabel(type: string, milestoneIndex: number | null): string {
  const n = milestoneIndex !== null ? milestoneIndex + 1 : "";
  const labels: Record<string, string> = {
    project_created: "Project Created",
    seller_accepted: "Seller Accepted",
    project_funded: "Project Funded",
    project_cancelled: "Project Cancelled",
    project_rejected: "Project Rejected",
    milestone_submitted: `Milestone ${n} Submitted`,
    dispute_opened: `Dispute Opened by Buyer on Milestone ${n}`,
    dispute_escalated: `Escalated to Admin on Milestone ${n}`,
    milestone_approved: `Milestone ${n} Paid`,
    milestone_refunded: `Milestone ${n} Refunded`,
    dispute_resolved: `Dispute Resolved on Milestone ${n}`,
    dispute_resolved_platform: `Dispute on Milestone ${n} Resolved by StablePay`,
  };
  return labels[type] ?? type;
}


export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { address, isConnected, status } = useAccount();
  const { data: walletClient } = useWalletClient();
  const router = useRouter();
  const { isRegistered, checked: userChecked } = useUser();
  const [mounted, setMounted] = useState(false);
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
    escalationReason?: string | null;
    sellerAward?: string | null;
    paidAt?: string | null;
  }[]>([]);
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [escrowCopied, setEscrowCopied] = useState(false);
  useEffect(() => setMounted(true), []);
  const escrowAddress = id as `0x${string}`;

  const copyEscrowAddress = async () => {
    try {
      await navigator.clipboard.writeText(escrowAddress);
      setEscrowCopied(true);
      window.setTimeout(() => setEscrowCopied(false), 1500);
    } catch {
      // Clipboard denied — address is still selectable in the UI
    }
  };

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
          disputeReason: m.disputeReason ?? old.disputeReason,
        };
      });
    });
    setMilestonesLoaded(true);
  }, []);

  const fetchMilestones = useCallback(() => {
    const apiUrl = API_URL;
    if (!apiUrl || !escrowAddress) return;
    fetch(`${apiUrl}/projects/${escrowAddress}/milestones`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => applyMilestones(data))
      .catch(() => {});
    if (walletClient) {
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
      fetchMilestones();
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
      const isEscalated = m.isEscalated || onChainIsEscalated;
      const rawOnChainStatus = getMilestoneStatus(Number(result[1]));
      const terminalOnChain = rawOnChainStatus === "PAID" || rawOnChainStatus === "REFUNDED" || rawOnChainStatus === "RESOLVED";
      const onChainStatus = (isEscalated && !terminalOnChain) ? "ESCALATED" : (rawOnChainStatus ?? m.status);
      return {
        ...m,
        isEscalated,
        status: onChainStatus,
        submittedAt: onChainSubmittedAt > 0 ? new Date(onChainSubmittedAt * 1000).toISOString() : m.submittedAt,
        disputeOpenedAt: onChainDisputeOpenedAt > 0 ? new Date(onChainDisputeOpenedAt * 1000).toISOString() : m.disputeOpenedAt,
        disputeOpenedBy: onChainDisputeOpenedBy && onChainDisputeOpenedBy !== zeroAddr ? onChainDisputeOpenedBy : m.disputeOpenedBy,
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
        abi: StablePayEscrowABI.abi,
        eventName: "DisputeResolved",
        fromBlock,
      });
    })
      .then((logs) => {
        const awards: Record<number, string> = {};
        for (const log of logs) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const args = (log as any).args as { milestoneIndex?: bigint; sellerAward?: bigint };
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
    abi: ERC20_ABI,
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
  const [disputeExpanded, setDisputeExpanded] = useState<Record<number, boolean>>({});

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
    if (isRejectSuccess) refetchCancelled();
  }, [isRejectSuccess, refetchCancelled]);

  // Track escalated milestones for processing spinner
  const lastEscalateIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isEscalateSuccess || lastEscalateIndexRef.current === null) return;
    setProcessingMilestones((prev) => new Map(prev).set(lastEscalateIndexRef.current!, "ESCALATED"));
  }, [isEscalateSuccess]);

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
    lastEscalateIndexRef.current = milestoneIndex;
    setEscalateIndex(milestoneIndex);
    const reason = keccak256(toHex("Seller escalation"));
    writeEscalate({
      address: escrowAddress,
      abi: StablePayEscrowABI.abi,
      functionName: "sellerEscalate",
      args: [BigInt(milestoneIndex), reason],
    });
    const text = (escalationReasons[milestoneIndex] ?? "").trim();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (text && apiUrl && walletClient) {
      authFetch(`${apiUrl}/projects/${escrowAddress}/milestones/${milestoneIndex}/escalation-reason`, walletClient, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ escalationReason: text }),
      }).catch(() => {});
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
      const apiUrl = API_URL;
      if (apiUrl && walletClient) {
        const saveWithRetry = async (attempts: number) => {
          for (let i = 0; i < attempts; i++) {
            try {
              const res = await authFetch(`${apiUrl}/projects/${escrowAddress}/milestones/${milestoneIndex}/delivery`, walletClient, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deliveryReference: reference }),
              });
              if (res.ok) return;
            } catch { /* retry */ }
            if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000));
          }
          // Retry exhausted — roll back optimistic state and restore input
          setConfirmedSubmits((prev) => {
            const next = new Set(prev);
            next.delete(milestoneIndex);
            return next;
          });
          setOptimisticDeliveries((prev) => { const next = { ...prev }; delete next[milestoneIndex]; return next; });
          setDeliveryInputs((prev) => ({ ...prev, [milestoneIndex]: reference }));
          setDeliverySaveError((prev) => ({ ...prev, [milestoneIndex]: "Could not save delivery reference. Please try again." }));
        };
        saveWithRetry(3);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- walletClient is stable ref, don't re-fire on change
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

    if (pendingDisputeRef.current) {
      const { milestoneIndex, reason } = pendingDisputeRef.current;
      pendingDisputeRef.current = null;
      setOptimisticDisputes((prev) => ({ ...prev, [milestoneIndex]: reason }));
      const apiUrl = API_URL;
      if (apiUrl && walletClient) {
        authFetch(`${apiUrl}/projects/${escrowAddress}/milestones/${milestoneIndex}/dispute`, walletClient, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ disputeReason: reason }),
        }).catch(() => {});
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- walletClient is stable ref, don't re-fire on change
  }, [isOpenDisputeSuccess, escrowAddress]);

  useEffect(() => {
    if (!isResubmitSuccess || lastResubmitIndexRef.current === null) return;
    setProcessingMilestones((prev) => new Map(prev).set(lastResubmitIndexRef.current!, "SUBMITTED"));

    if (pendingResubmitRef.current) {
      const { milestoneIndex, reference } = pendingResubmitRef.current;
      pendingResubmitRef.current = null;
      const apiUrl = API_URL;
      if (apiUrl && walletClient) {
        const saveWithRetry = async (attempts: number) => {
          for (let i = 0; i < attempts; i++) {
            try {
              const res = await authFetch(`${apiUrl}/projects/${escrowAddress}/milestones/${milestoneIndex}/delivery`, walletClient, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deliveryReference: reference }),
              });
              if (res.ok) return;
            } catch { /* retry */ }
            if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000));
          }
          // Retry exhausted — restore input to the frozen value and show error
          setResubmitInputs((prev) => ({ ...prev, [milestoneIndex]: reference }));
          setDeliverySaveError((prev) => ({ ...prev, [milestoneIndex]: "Could not save delivery reference. Please try again." }));
        };
        saveWithRetry(3);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- walletClient is stable ref, don't re-fire on change
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
      abi: ERC20_ABI,
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
    if (isCancelSuccess) {
      refetchCancelled();
      fetchMilestones();
    }
  }, [isCancelSuccess, refetchCancelled, fetchMilestones]);

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

  const dayMs = 24 * 60 * 60 * 1000;
  const autoApprovalMs = autoApprovalDays * dayMs;
  const disputeTimeoutMs = disputeTimeoutDays * dayMs;
  const correctionWindowMs = correctionWindowDays * dayMs;

  function dayLabel(days: number): string {
    return `${days} day${days === 1 ? "" : "s"}`;
  }

  function isAutoApprovalReady(submittedAt: string | null | undefined): boolean {
    if (!submittedAt || autoApprovalMs <= 0) return false;
    return Date.now() - new Date(submittedAt).getTime() >= autoApprovalMs;
  }

  function autoReleaseAt(submittedAt: string | null | undefined): Date | null {
    if (!submittedAt || autoApprovalMs <= 0) return null;
    const submitted = new Date(submittedAt);
    if (Number.isNaN(submitted.getTime())) return null;
    return new Date(submitted.getTime() + autoApprovalMs);
  }

  function formatAutoRelease(date: Date): string {
    return date.toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" });
  }

  function isDisputeResubmitWindow(disputeOpenedAt: string | null | undefined): boolean {
    if (!disputeOpenedAt || correctionWindowMs <= 0) return false;
    return Date.now() - new Date(disputeOpenedAt).getTime() < correctionWindowMs;
  }

  function isDisputeTimeoutReady(disputeOpenedAt: string | null | undefined): boolean {
    if (!disputeOpenedAt || disputeTimeoutMs <= 0) return false;
    return Date.now() - new Date(disputeOpenedAt).getTime() >= disputeTimeoutMs;
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

  const headerStatus = getDisplayStatus("CREATED", {
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
        <p className="mb-6 text-sm text-zinc-900">
          {escrowMeta.description}
        </p>
      ) : null}

      <div className="mb-6 rounded-2xl border border-zinc-300 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-xs font-medium text-zinc-500 mb-1">{isBuyer ? "Counterparty (Seller)" : "Counterparty (Buyer)"}</p>
            <p className="text-sm font-medium text-zinc-900">
              {(() => {
                const addr = isBuyer ? (seller as string) : (buyer as string);
                const company = isBuyer ? escrowMeta?.sellerCompany : escrowMeta?.buyerCompany;
                if (!addr) return "...";
                const short = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
                return company ? <>{company} <span className="font-mono text-xs text-zinc-400">{short}</span></> : <span className="font-mono">{short}</span>;
              })()}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-500 mb-1">Status</p>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border ${headerBadge.color}`}>
              {headerBadge.label}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-zinc-100">
          <div>
            <p className="text-xs font-medium text-zinc-500 mb-1">Total Amount</p>
            <p className="text-xl font-bold text-zinc-900">{displayAmount} <span className="text-xl font-bold text-zinc-900">USDC</span></p>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-500 mb-1">Milestones</p>
            <p className="text-xl font-bold text-zinc-900">{milestoneCount?.toString() ?? "..."}</p>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-zinc-100">
          <p className="text-xs font-medium text-zinc-500 mb-1">Escrow Address</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="font-mono text-xs text-zinc-700">{escrowAddress}</p>
            <button
              type="button"
              onClick={() => void copyEscrowAddress()}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              aria-label="Copy escrow address"
            >
              {escrowCopied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {escrowCopied ? "Copied" : "Copy"}
            </button>
            <a
              href={`${BASESCAN_URL}/address/${escrowAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900"
            >
              View on Basescan ↗
            </a>
          </div>
        </div>
      </div>

      {isSeller && !sellerAccepted && !isAcceptSuccess && !isCancelled && !isCancelSuccess && !isRejectSuccess && userChecked && !isRegistered && (
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

      {isSeller && !sellerAccepted && !isAcceptSuccess && !isCancelled && !isCancelSuccess && !isRejectSuccess && userChecked && isRegistered && (
        <div className="mb-6 rounded-lg border border-orange-200 bg-orange-50 p-4">
          <h2 className="mb-2 text-lg font-semibold">Project Invitation</h2>
          <p className="mb-4 text-sm text-zinc-800">
            You have been invited to this project. Accept to allow the buyer to fund the escrow, or reject to cancel.
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleAcceptProject}
              disabled={isAcceptPending || isAcceptConfirming}
              className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm text-white transition-colors hover:bg-green-500 disabled:opacity-50"
            >
              {isAcceptPending
                ? "Confirm in Wallet..."
                : isAcceptConfirming
                ? "Waiting for Confirmation..."
                : "Accept Project"}
            </button>
            <button
              onClick={handleRejectProject}
              disabled={isRejectPending || isRejectConfirming}
              className="flex-1 rounded-lg border border-red-400 px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              {isRejectPending
                ? "Confirm in Wallet..."
                : isRejectConfirming
                ? "Waiting for Confirmation..."
                : "Reject Project"}
            </button>
          </div>
          {acceptError && (
            <p className="mt-2 text-xs text-red-500">{parseContractError(acceptError)}</p>
          )}
          {rejectError && (
            <p className="mt-2 text-xs text-red-500">{parseContractError(rejectError)}</p>
          )}
        </div>
      )}

      {isBuyer && !sellerAccepted && !isAcceptSuccess && !isFunded && !isFundSuccess && !isCancelled && !isCancelSuccess && !isRejectSuccess && (
        <div className="mb-6 rounded-lg border border-orange-200 bg-orange-50 p-4">
          <p className="text-sm text-orange-700">
            Waiting for the seller to accept this project before you can fund it.
          </p>
        </div>
      )}

      {isSeller && (sellerAccepted || isAcceptSuccess) && !isFunded && !isFundSuccess && !isCancelled && !isCancelSuccess && !isRejectSuccess && (
        <div className="mb-6 rounded-lg border border-orange-200 bg-orange-50 p-4">
          <p className="text-sm text-orange-700">
            You accepted this project. Waiting for the buyer to fund the escrow before you can start work.
          </p>
        </div>
      )}

      {isBuyer && (sellerAccepted || isAcceptSuccess) && !isFunded && !isFundSuccess && !isCancelled && !isCancelSuccess && (
        <div className="mb-6 space-y-4">
          <h2 className="text-lg font-semibold">Fund this Project</h2>
          <p className="text-sm text-zinc-800">
            Funding requires two transactions: first you approve USDC transfer,
            then you deposit funds into the escrow contract.
          </p>

          <div className="space-y-3">
            <div className="rounded-xl border border-zinc-300 bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-medium">Step 1: Approve USDC</p>
                {(hasEnoughAllowance || isApproveSuccess) && (
                  <span className="text-sm text-emerald-600">✓ Approved</span>
                )}
              </div>
              <p className="mb-3 text-xs text-zinc-700">
                Allow the escrow contract to transfer {displayAmount} USDC from
                your wallet.
              </p>
              {!hasEnoughAllowance && !isApproveSuccess && (
                <button
                  onClick={handleApprove}
                  disabled={isApprovePending || isApproveConfirming}
                  className="w-full rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40" style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 8px hsl(217 91% 30% / 0.35)" }}
                >
                  {isApprovePending
                    ? "Confirm in Wallet..."
                    : isApproveConfirming
                      ? "Waiting for Confirmation..."
                      : `Approve ${displayAmount} USDC`}
                </button>
              )}
              {approveError && (
                <p className="mt-2 text-xs text-red-500">
                  {parseContractError(approveError)}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-zinc-300 bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
              <p className="mb-2 font-medium">Step 2: Fund Escrow</p>
              <p className="mb-3 text-xs text-zinc-700">
                Deposit {displayAmount} USDC into the escrow contract. Funds are
                locked until milestones are approved.
              </p>
              <button
                onClick={handleFund}
                disabled={
                  isFundPending ||
                  isFundConfirming ||
                  (!hasEnoughAllowance && !isApproveSuccess)
                }
                className="w-full rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40" style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 8px hsl(217 91% 30% / 0.35)" }}
              >
                {isFundPending
                  ? "Confirm in Wallet..."
                  : isFundConfirming
                    ? "Waiting for Confirmation..."
                    : `Fund ${displayAmount} USDC`}
              </button>
              {fundError && (
                <p className="mt-2 text-xs text-red-500">
                  {parseContractError(fundError)}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 text-center">
            <button
              onClick={handleCancelEscrow}
              disabled={isCancelPending || isCancelConfirming}
              className="text-sm text-zinc-500 underline transition-colors hover:text-red-500 disabled:opacity-50"
            >
              {isCancelPending
                ? "Confirm in Wallet..."
                : isCancelConfirming
                ? "Cancelling..."
                : "Cancel this project"}
            </button>
            {cancelError && (
              <p className="mt-1 text-xs text-red-500">{parseContractError(cancelError)}</p>
            )}
          </div>
        </div>
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

      {activeTab === "timeline" && events.length > 0 && (
        <div className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-500 mb-6">Project Timeline</h2>
          <ol className="relative">
            {(() => {
              const isProjectComplete =
                milestones.length > 0 &&
                milestones.every((m) => ["PAID", "RESOLVED", "REFUNDED"].includes(m.status));
              return (
                <>
                  {events.map((event, i) => {
                    const isLast = i === events.length - 1 && !isProjectComplete;
                    const milestoneDescription = event.milestoneIndex === null
                      ? ""
                      : milestones.find((m) => m.milestoneIndex === event.milestoneIndex)?.label?.trim() ?? "";
                    return (
                      <li key={i} className="flex gap-4 relative">
                        {!isLast && (
                          <div className="absolute left-[9px] top-5 bottom-0 w-px bg-zinc-200" />
                        )}
                        <div className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center z-10 ${
                          event.type === "created" ? "border-zinc-300 bg-white"
                          : event.type === "cancelled" || event.type === "project_cancelled" || event.type === "project_rejected" || event.type === "disputed" ? "border-red-300 bg-red-50"
                          : "border-primary bg-primary/10"
                        }`}>
                          <div className={`h-2 w-2 rounded-full ${
                            event.type === "created" ? "bg-zinc-300"
                            : event.type === "cancelled" || event.type === "project_cancelled" || event.type === "project_rejected" || event.type === "disputed" ? "bg-red-400"
                            : "bg-primary"
                          }`} />
                        </div>
                        <div className={`pb-6 ${isLast ? "pb-0" : ""}`}>
                          <p className="text-sm font-semibold text-zinc-900 leading-tight">
                            {getEventLabel(event.type, event.milestoneIndex)}
                          </p>
                          {milestoneDescription && (
                            <p className="text-xs text-zinc-600 mt-0.5">
                              {milestoneDescription}
                            </p>
                          )}
                          <p className="text-xs text-zinc-500 mt-0.5">
                            {new Date(event.timestamp).toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" })}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                  {isProjectComplete && (
                    <li className="flex gap-4 relative">
                      <div className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-emerald-400 bg-emerald-50 flex items-center justify-center z-10">
                        <div className="h-2 w-2 rounded-full bg-emerald-500" />
                      </div>
                      <div className="pb-0">
                        <p className="text-sm font-semibold text-emerald-700 leading-tight">Project Completed</p>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          {new Date(events[events.length - 1].timestamp).toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" })}
                        </p>
                      </div>
                    </li>
                  )}
                </>
              );
            })()}
          </ol>
        </div>
      )}

      {activeTab === "overview" && (<>

      {isFunded === false && !isFundSuccess && enrichedMilestones.length > 0 && (
        <div className="mb-6 space-y-3">
          <h2 className="text-lg font-semibold">Milestones</h2>
          {enrichedMilestones.map((m) => {
            const grossBase = BigInt(m.amount);
            const feeBase = calcFeeBase(grossBase, 250n);
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
                      Amount {formatUSDC(grossBase)} USDC · platform fee {formatUSDC(feeBase)} USDC (2.5%)
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-medium text-zinc-500">Seller receives</p>
                    <p className="font-semibold text-emerald-700">{formatUSDC(sellerReceives)} USDC</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
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
            {isFunded
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
            const submittingThis =
              (isSubmitPending || isSubmitConfirming) && submitIndex === m.milestoneIndex;
            const disputingThis =
              (isOpenDisputePending || isOpenDisputeConfirming) && disputeIndex === m.milestoneIndex;
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
              {(() => {
                const grossBase = BigInt(m.amount);
                const hadDispute = !!m.disputeOpenedAt;
                const isDisputeResolved = displayStatus === "RESOLVED";
                const isDisputePaid = displayStatus === "PAID" && hadDispute;
                const isDisputeRefunded = displayStatus === "REFUNDED" && hadDispute;
                const isDisputeOutcome = isDisputeResolved || isDisputePaid || isDisputeRefunded;
                const isPaid = displayStatus === "PAID";

                const sellerAwardValue = m.sellerAward ?? onChainAwards[m.milestoneIndex];

                // Compute fee amounts based on actual dispute outcome, in USDC base
                // units (6 decimals) using the same integer math as the contract —
                // avoids float rounding drift (e.g. 1.00 USDC showing "0.03 USDC (2.5%)"
                // and "0.97" instead of the real 0.025 / 0.975 split).
                const disputeFeeBase = isDisputeOutcome ? calcFeeBase(grossBase, 100n) : 0n;
                let platformFeeBase = 0n;
                let netBase = 0n;
                let buyerRefundBase: bigint | null = null;
                let loadingAward = false;

                if (isDisputeRefunded) {
                  // Buyer wins entirely: no platform fee, seller gets 0
                  platformFeeBase = 0n;
                  netBase = 0n;
                  buyerRefundBase = grossBase - disputeFeeBase;
                } else if ((isDisputePaid || isDisputeResolved) && sellerAwardValue) {
                  // sellerAward = gross allocated to seller before 2.5% platform fee
                  const sellerGrossBase = BigInt(sellerAwardValue);
                  platformFeeBase = calcFeeBase(sellerGrossBase, 250n);
                  netBase = sellerGrossBase - platformFeeBase;
                  if (isDisputeResolved) {
                    const refund = grossBase - sellerGrossBase - disputeFeeBase;
                    buyerRefundBase = refund > 0n ? refund : 0n;
                  }
                } else if (isDisputeOutcome && !sellerAwardValue) {
                  loadingAward = true;
                } else if (displayStatus === "REFUNDED") {
                  // Plain cancellation (cancelEscrow, no dispute involved): buyer gets
                  // the full milestone amount back, no platform fee, seller gets nothing.
                  platformFeeBase = 0n;
                  netBase = 0n;
                  buyerRefundBase = grossBase;
                } else {
                  // Normal PAID (approved/auto-approved)
                  platformFeeBase = calcFeeBase(grossBase, 250n);
                  netBase = grossBase - platformFeeBase;
                }

                const paymentBreakdown = loadingAward ? (
                  <div className="mt-3 text-xs text-zinc-400 italic">Loading settlement details…</div>
                ) : (
                  <div className="mt-3 rounded-lg border border-zinc-900 bg-white p-3 text-xs">
                    <p className="mb-2 font-semibold text-zinc-500 uppercase tracking-wider text-[10px]">
                      {isDisputeOutcome ? "Settlement" : "Payment"}
                    </p>
                    <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
                      <span className="text-zinc-500">Amount</span>
                      <span className="text-zinc-800">{formatUSDC(grossBase)} USDC</span>
                      {isDisputeOutcome && (
                        <>
                          <span className="text-zinc-500">Dispute fee</span>
                          <span className="text-zinc-700">{formatUSDC(disputeFeeBase)} USDC <span className="text-zinc-400">(1%)</span></span>
                        </>
                      )}
                      {platformFeeBase > 0n && (
                        <>
                          <span className="text-zinc-500">Platform fee</span>
                          <span className="text-zinc-700">{formatUSDC(platformFeeBase)} USDC <span className="text-zinc-400">(2.5%)</span></span>
                        </>
                      )}
                      {buyerRefundBase !== null && buyerRefundBase > 0n && (
                        <>
                          <span className="text-zinc-500">Refunded</span>
                          <span className="text-zinc-700">{formatUSDC(buyerRefundBase)} USDC</span>
                        </>
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between border-t border-zinc-200 pt-2">
                      <span className="font-medium text-zinc-700">{isPaid ? "Paid to seller" : "Seller receives"}</span>
                      <span className="font-bold text-sm text-zinc-900">
                        {formatUSDC(netBase)} USDC
                      </span>
                    </div>
                  </div>
                );

                const disputeReason = m.disputeReason ?? optimisticDisputes[m.milestoneIndex];
                const disputeOpenedBy = m.disputeOpenedBy ?? (locallyDisputed ? address : undefined);
                const disputeOpenedAt = m.disputeOpenedAt ?? (locallyDisputed ? new Date().toISOString() : undefined);
                const showDisputeBox =
                  (displayStatus === "DISPUTED" || isDisputeOutcome || locallyDisputed) &&
                  (processingAs == null || processingAs === "DISPUTED");
                const disputeBox = showDisputeBox ? (
                  <div className="mt-3 border-l-2 border-red-500 bg-zinc-50 px-3 py-2 text-xs rounded-r-md">
                    <p className="mb-1.5 font-semibold text-red-600 uppercase tracking-wider text-[10px]">Dispute</p>
                    {disputeOpenedBy && (() => {
                      const isByBuyer = disputeOpenedBy.toLowerCase() === (buyer as string | undefined)?.toLowerCase();
                      const role = isByBuyer ? "Buyer" : "Seller";
                      const company = isByBuyer ? escrowMeta?.buyerCompany : escrowMeta?.sellerCompany;
                      return (
                        <p className="mb-1 text-zinc-700">
                          <span className="font-medium text-zinc-600">Opened by ({role}):</span>{" "}
                          {company ?? `${disputeOpenedBy.slice(0, 6)}...${disputeOpenedBy.slice(-4)}`}
                        </p>
                      );
                    })()}
                    {disputeReason && (
                      <p className="mb-1 text-zinc-800">
                        <span className="font-medium text-zinc-600">Reason:</span> {disputeReason}
                      </p>
                    )}
                    {disputeOpenedAt && (
                      <p className="text-zinc-700">
                        <span className="font-medium text-zinc-600">Opened:</span>{" "}
                        {new Date(disputeOpenedAt).toLocaleDateString()}
                      </p>
                    )}
                    {isDisputeOutcome && m.paidAt && (
                      <p className="mt-1 text-zinc-700">
                        <span className="font-medium text-zinc-600">Settled:</span>{" "}
                        {new Date(m.paidAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                ) : null;


                return (
                  <>
                    {(m.deliveryReference || optimisticDeliveries[m.milestoneIndex]) && (
                      <div className="mt-3 rounded-lg border border-zinc-900 bg-zinc-50 p-3 text-xs">
                        <p className="mb-1 font-semibold text-zinc-500 uppercase tracking-wider text-[10px]">Seller delivery message</p>
                        <p className="text-zinc-800">{m.deliveryReference ?? optimisticDeliveries[m.milestoneIndex]}</p>
                      </div>
                    )}
                    {(displayStatus === "ESCALATED" || processingMilestones.get(m.milestoneIndex) === "ESCALATED") && (
                      <div className="mt-3 border-l-2 border-red-500 bg-zinc-50 px-3 py-2 text-xs rounded-r-md space-y-1">
                        <p className="mb-1.5 font-semibold text-red-600 uppercase tracking-wider text-[10px]">Escalated</p>
                        <p className="text-zinc-700">
                          <span className="font-medium text-zinc-600">Buyer opened dispute:</span>{" "}
                          {escrowMeta?.buyerCompany
                            ?? (buyer
                              ? `${(buyer as string).slice(0, 6)}...${(buyer as string).slice(-4)}`
                              : "Buyer")}
                          {m.disputeOpenedAt && <span className="text-zinc-400"> · {new Date(m.disputeOpenedAt).toLocaleDateString()}</span>}
                        </p>
                        {(m.disputeReason ?? optimisticDisputes[m.milestoneIndex]) && (
                          <p className="text-zinc-800">
                            <span className="font-medium text-zinc-600">Dispute reason:</span> {m.disputeReason ?? optimisticDisputes[m.milestoneIndex]}
                          </p>
                        )}
                        <p className="text-zinc-700">
                          <span className="font-medium text-zinc-600">Seller escalated to admin</span>
                          {m.disputeOpenedAt && <span className="text-zinc-400"> · {new Date(m.disputeOpenedAt).toLocaleDateString()}</span>}
                        </p>
                        {(m.escalationReason ?? escalationReasons[m.milestoneIndex]) && (
                          <p className="text-zinc-800">
                            <span className="font-medium text-zinc-600">Escalation reason:</span>{" "}
                            {m.escalationReason ?? escalationReasons[m.milestoneIndex]}
                          </p>
                        )}
                        <p className="text-zinc-500 italic">The platform is reviewing and will resolve this dispute.</p>
                      </div>
                    )}
                    {disputeBox}
                    {displayStatus === "PAID" && !hadDispute && (locallyPaid || !processingMilestones.has(m.milestoneIndex)) && (
                      <div className="mt-3 border-l-2 border-blue-500 bg-zinc-50 px-3 py-2 text-xs rounded-r-md">
                        <p className="font-semibold text-zinc-500 uppercase tracking-wider text-[10px] mb-1">Approval</p>
                        <p className="text-zinc-800">Buyer accepted delivery and released payment.</p>
                      </div>
                    )}
                    {["PAID", "REFUNDED", "RESOLVED"].includes(displayStatus) && paymentBreakdown}
                  </>
                );
              })()}
              {isBuyer && displayStatus === "SUBMITTED" && !processingMilestones.has(m.milestoneIndex) && !locallyDisputed && !locallyPaid && (
                <div className="mt-3 space-y-2">
                  {(() => {
                    const releaseAt = autoReleaseAt(m.submittedAt);
                    if (!releaseAt) return null;
                    const ready = releaseAt.getTime() <= Date.now();
                    return (
                      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        {ready
                          ? "The approval window has ended. This payment will be released to the seller automatically if you don't approve or dispute."
                          : `If you don't approve or dispute, this payment will be released to the seller automatically on ${formatAutoRelease(releaseAt)}.`}
                      </p>
                    );
                  })()}
                  {(() => {
                    const isThisMilestone = approveIndex === m.milestoneIndex;
                    const isBusy = isApproveMilestonePending || isApproveMilestoneConfirming;
                    // Hide button on other milestones while one is being approved
                    if (isBusy && !isThisMilestone) return null;
                    return (
                      <button
                        onClick={() => handleApproveMilestone(m.milestoneIndex)}
                        disabled={isBusy}
                        className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm text-white transition-colors hover:bg-green-500 disabled:opacity-50"
                      >
                        {isApproveMilestonePending && isThisMilestone
                          ? "Confirm in Wallet..."
                          : isApproveMilestoneConfirming && isThisMilestone
                          ? "Waiting for Confirmation..."
                          : "Approve & Release Payment"}
                      </button>
                    );
                  })()}
                  {approveMilestoneError && (
                    <p className="text-xs text-red-500">{parseContractError(approveMilestoneError)}</p>
                  )}
                  <div className="space-y-2">
                    {!disputeExpanded[m.milestoneIndex] ? (
                      <button
                        onClick={() => setDisputeExpanded((prev) => ({ ...prev, [m.milestoneIndex]: true }))}
                        className="w-full rounded-lg border border-red-400 px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
                      >
                        Open Dispute
                      </button>
                    ) : (
                      <div className="rounded-lg border border-red-500 bg-white p-3 space-y-2">
                        <p className="text-xs font-semibold text-red-600 uppercase tracking-wider">Open Dispute</p>
                        <textarea
                          value={disputeInputs[m.milestoneIndex] ?? ""}
                          onChange={(e) =>
                            setDisputeInputs((prev) => ({ ...prev, [m.milestoneIndex]: e.target.value }))
                          }
                          placeholder="Dispute reason (e.g. work not delivered as agreed)"
                          maxLength={500}
                          rows={3}
                          disabled={disputingThis}
                          className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200 resize-none disabled:opacity-60"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => setDisputeExpanded((prev) => ({ ...prev, [m.milestoneIndex]: false }))}
                            disabled={disputingThis}
                            className="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleOpenDispute(m.milestoneIndex)}
                            disabled={!disputeInputs[m.milestoneIndex]?.trim() || isOpenDisputePending || isOpenDisputeConfirming}
                            className="flex-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {isOpenDisputePending && disputeIndex === m.milestoneIndex
                              ? "Confirm in Wallet..."
                              : isOpenDisputeConfirming && disputeIndex === m.milestoneIndex
                              ? "Waiting..."
                              : "Confirm Dispute"}
                          </button>
                        </div>
                      </div>
                    )}
                    {openDisputeError && (
                      <p className="text-xs text-red-500">{parseContractError(openDisputeError)}</p>
                    )}
                  </div>
                </div>
              )}
              {isSeller &&
                (displayStatus === "SUBMITTED" || locallySubmitted) &&
                !locallyPaid &&
                (processingAs == null || processingAs === "SUBMITTED") && (
                <div className="mt-3 space-y-2">
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <p className="text-sm font-medium text-blue-800">Delivery submitted</p>
                    <p className="text-xs text-blue-600">
                      {(() => {
                        const releaseAt = autoReleaseAt(m.submittedAt);
                        if (!releaseAt) {
                          return `Waiting for buyer approval — auto-approval available in ${dayLabel(autoApprovalDays)}`;
                        }
                        if (releaseAt.getTime() <= Date.now()) {
                          return "The approval window has ended. You can release this payment.";
                        }
                        return `Waiting for buyer approval. You can release this payment automatically on ${formatAutoRelease(releaseAt)}.`;
                      })()}
                    </p>
                  </div>
                  {isAutoApprovalReady(m.submittedAt) && (
                    <button
                      onClick={() => handleClaimAutoApproval(m.milestoneIndex)}
                      disabled={isClaimPending || isClaimConfirming}
                      className="w-full rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40" style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 8px hsl(217 91% 30% / 0.35)" }}
                    >
                      {isClaimPending && claimIndex === m.milestoneIndex
                        ? "Confirm in Wallet..."
                        : isClaimConfirming && claimIndex === m.milestoneIndex
                        ? "Waiting for Confirmation..."
                        : "Claim Payment (Auto-approved)"}
                    </button>
                  )}
                  {claimError && (
                    <p className="mt-1 text-xs text-red-500">{parseContractError(claimError)}</p>
                  )}
                </div>
              )}
              {isSeller && displayStatus === "PENDING" && !processingMilestones.has(m.milestoneIndex) && !locallySubmitted && (
                <div className="mt-3 space-y-2">
                  <input
                    type="text"
                    placeholder="Delivery reference (URL, IPFS hash, description...)"
                    value={deliveryInputs[m.milestoneIndex] ?? ""}
                    onChange={(e) =>
                      setDeliveryInputs((prev) => ({ ...prev, [m.milestoneIndex]: e.target.value }))
                    }
                    maxLength={500}
                    disabled={submittingThis}
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                  />
                  <button
                    onClick={() => handleSubmitDelivery(m.milestoneIndex)}
                    disabled={!deliveryInputs[m.milestoneIndex]?.trim() || isSubmitPending || isSubmitConfirming}
                    className="w-full rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
                    style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 8px hsl(217 91% 30% / 0.35)" }}
                  >
                    {isSubmitPending && submitIndex === m.milestoneIndex
                      ? "Confirm in Wallet..."
                      : isSubmitConfirming && submitIndex === m.milestoneIndex
                      ? "Waiting for Confirmation..."
                      : "Submit Delivery"}
                  </button>
                  {submitError && (
                    <p className="text-xs text-red-500">{parseContractError(submitError)}</p>
                  )}
                  {deliverySaveError[m.milestoneIndex] && (
                    <p className="text-xs text-red-500">{deliverySaveError[m.milestoneIndex]}</p>
                  )}
                </div>
              )}
              {isSeller && displayStatus === "DISPUTED" && !processingMilestones.has(m.milestoneIndex) &&
                m.disputeOpenedBy?.toLowerCase() === (buyer as string | undefined)?.toLowerCase() &&
                isDisputeResubmitWindow(m.disputeOpenedAt) && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-zinc-700">You can resubmit your delivery within the {dayLabel(correctionWindowDays)} correction window.</p>
                  <input
                    type="text"
                    placeholder="New delivery reference (URL, IPFS hash, description...)"
                    value={resubmitInputs[m.milestoneIndex] ?? ""}
                    onChange={(e) =>
                      setResubmitInputs((prev) => ({ ...prev, [m.milestoneIndex]: e.target.value }))
                    }
                    maxLength={500}
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    onClick={() => handleResubmit(m.milestoneIndex)}
                    disabled={!resubmitInputs[m.milestoneIndex]?.trim() || isResubmitPending || isResubmitConfirming}
                    className="w-full rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40" style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 8px hsl(217 91% 30% / 0.35)" }}
                  >
                    {isResubmitPending && resubmitIndex === m.milestoneIndex
                      ? "Confirm in Wallet..."
                      : isResubmitConfirming && resubmitIndex === m.milestoneIndex
                      ? "Waiting for Confirmation..."
                      : "Resubmit Delivery"}
                  </button>
                  {resubmitError && (
                    <p className="text-xs text-red-500">{parseContractError(resubmitError)}</p>
                  )}
                  {deliverySaveError[m.milestoneIndex] && (
                    <p className="text-xs text-red-500">{deliverySaveError[m.milestoneIndex]}</p>
                  )}
                </div>
              )}
              {isSeller && displayStatus === "DISPUTED" && !processingMilestones.has(m.milestoneIndex) &&
                m.disputeOpenedBy?.toLowerCase() === (buyer as string | undefined)?.toLowerCase() && (
                <div className="mt-3">
                  {!escalationExpanded[m.milestoneIndex] ? (
                    <button
                      onClick={() => setEscalationExpanded((prev) => ({ ...prev, [m.milestoneIndex]: true }))}
                      className="w-full rounded-lg border border-orange-400 px-4 py-2 text-sm text-orange-600 transition-colors hover:bg-orange-50"
                    >
                      Escalate to Admin
                    </button>
                  ) : (
                    <div className="rounded-lg border border-red-500 bg-white p-3 space-y-2">
                      <p className="text-xs font-semibold text-red-600 uppercase tracking-wider">Escalate to Admin</p>
                      <textarea
                        value={escalationReasons[m.milestoneIndex] ?? ""}
                        onChange={(e) => setEscalationReasons((prev) => ({ ...prev, [m.milestoneIndex]: e.target.value }))}
                        placeholder="Explain why you're escalating this to the platform…"
                        maxLength={500}
                        rows={3}
                        className="w-full resize-none rounded-md border border-red-500 bg-white px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-400"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEscalationExpanded((prev) => ({ ...prev, [m.milestoneIndex]: false }))}
                          className="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleEscalate(m.milestoneIndex)}
                          disabled={isEscalatePending || isEscalateConfirming}
                          className="flex-1 rounded-md bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
                        >
                          {isEscalatePending && escalateIndex === m.milestoneIndex
                            ? "Confirm in Wallet..."
                            : isEscalateConfirming && escalateIndex === m.milestoneIndex
                            ? "Waiting..."
                            : "Confirm Escalation"}
                        </button>
                      </div>
                    </div>
                  )}
                  <p className="mt-1 text-xs text-zinc-500">
                    Skip the correction window and let the platform resolve this dispute directly.
                  </p>
                  {escalateError && (
                    <p className="mt-1 text-xs text-red-500">{parseContractError(escalateError)}</p>
                  )}
                </div>
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
                      : `Claim Timeout Refund (${dayLabel(disputeTimeoutDays)} elapsed)`}
                  </button>
                  {disputeTimeoutError && (
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
