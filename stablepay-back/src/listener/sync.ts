import { decodeEventLog, getAddress } from "viem";
import { MilestoneStatus } from "../../generated/prisma/enums";
import type { Escrow, Milestone } from "../../generated/prisma/client";
import { prisma } from "../prisma";
import { escrowReadAbi } from "../abi/StablePayEscrow.read.abi";
import { disputeResolvedEvent, escrowCancelledEvent, fundedEvent, projectRejectedEvent } from "../abi/events";
import { MILESTONE_STATUS_MAP, backfillClient, blockDate, getLogsInChunks, milestoneKey } from "./chain";
import { seedMissingEscrowFromChain } from "./seed";

/** Block time of a close event. Null if it is not in the recent window or the RPC refuses the read. */
export async function readCancelledAt(
  logClient: typeof backfillClient,
  address: `0x${string}`,
  events: Array<typeof escrowCancelledEvent | typeof projectRejectedEvent> = [escrowCancelledEvent, projectRejectedEvent],
): Promise<Date | null> {
  // Public Base Sepolia RPC rejects eth_getLogs ranges above 1,000 blocks.
  // ~30k blocks is about 16 hours, enough for a cancel made during this session.
  const CHUNK = 999n;
  const MAX_LOOKBACK_BLOCKS = 30_000n;
  let latest: bigint;
  try {
    latest = await logClient.getBlockNumber();
  } catch {
    return null;
  }
  const floor = latest > MAX_LOOKBACK_BLOCKS ? latest - MAX_LOOKBACK_BLOCKS : 0n;
  let end = latest;

  while (end >= floor) {
    const start = end - CHUNK > floor ? end - CHUNK : floor;
    for (const event of events) {
      try {
        const logs = await logClient.getLogs({ address, event, fromBlock: start, toBlock: end });
        const blockNumber = logs[0]?.blockNumber;
        if (blockNumber != null) return await blockDate(logClient, blockNumber);
      } catch {
        // Keep searching older windows.
      }
    }
    if (start <= floor) break;
    end = start - 1n;
  }
  return null;
}

/** Dispute fields the contract zeroes in resubmitDuringDispute. */
export function clearedDisputeData() {
  return {
    disputeOpenedAt: null,
    disputeOpenedBy: null,
    disputeReason: null,
    isEscalated: false,
    disputeEscalatedAt: null,
    disputeEscalatedBy: null,
    escalationReason: null,
    sellerResponse: null,
  };
}

function disputeFieldsAreStale(
  dbMilestone: {
    disputeOpenedAt: Date | null;
    disputeOpenedBy: string | null;
    disputeReason: string | null;
    isEscalated: boolean;
    disputeEscalatedAt: Date | null;
    escalationReason: string | null;
    sellerResponse: string | null;
  },
  disputeOpenedAtTs: number,
): boolean {
  if (disputeOpenedAtTs !== 0) return false;
  return dbMilestone.disputeOpenedAt != null
    || dbMilestone.disputeOpenedBy != null
    || dbMilestone.disputeReason != null
    || dbMilestone.isEscalated
    || dbMilestone.disputeEscalatedAt != null
    || dbMilestone.escalationReason != null
    || dbMilestone.sellerResponse != null;
}

function submittedAtNeedsUpdate(existing: Date | null, chain: Date | null): boolean {
  if (!chain) return false;
  if (!existing) return true;
  return Math.abs(existing.getTime() - chain.getTime()) > 1000;
}

export type EscrowWithMilestones = Escrow & { milestones: Milestone[] };

/**
 * Bring one escrow and its milestones in the DB in line with the chain.
 * Shared by the startup catch-up and the per-project sync. Throws on RPC errors,
 * so the caller decides whether to retry (catch-up) or only log (sync).
 *
 * `label` prefixes the log lines; `shouldStop` lets a listener restart cut it short.
 */
export async function syncEscrowState(
  escrow: EscrowWithMilestones,
  label: string,
  shouldStop: () => boolean = () => false,
) {
  const address = escrow.id as `0x${string}`;
  // The public RPC, so these bulk reads don't eat the watchers' Alchemy rate limit
  const rpc = backfillClient;

  let sellerAccepted = false;
  try {
    sellerAccepted = await rpc.readContract({ address, abi: escrowReadAbi, functionName: "sellerAccepted" }) as boolean;
  } catch {
    // Old contract deployed before acceptProject() was added
  }

  const [funded, cancelled, milestoneCount, correctionWindowDays, autoApprovalDays, disputeTimeoutDays] = await Promise.all([
    rpc.readContract({ address, abi: escrowReadAbi, functionName: "funded" }),
    rpc.readContract({ address, abi: escrowReadAbi, functionName: "cancelled" }),
    rpc.readContract({ address, abi: escrowReadAbi, functionName: "milestoneCount" }),
    rpc.readContract({ address, abi: escrowReadAbi, functionName: "CORRECTION_WINDOW_DAYS" }).catch(() => null),
    rpc.readContract({ address, abi: escrowReadAbi, functionName: "AUTO_APPROVAL_DAYS" }).catch(() => null),
    rpc.readContract({ address, abi: escrowReadAbi, functionName: "DISPUTE_TIMEOUT_DAYS" }).catch(() => null),
  ]) as [boolean, boolean, bigint, bigint | null, bigint | null, bigint | null];

  // The contract only stores `cancelled`, not who cancelled — keep SELLER_REJECTED set by the listener
  const onChainStatus = cancelled
    ? (escrow.status === "SELLER_REJECTED" ? "SELLER_REJECTED" : "CANCELLED")
    : funded ? "FUNDED" : sellerAccepted ? "SELLER_ACCEPTED" : "CREATED";

  const updateData: Record<string, unknown> = {};
  if (escrow.status !== onChainStatus) {
    updateData.status = onChainStatus;
  }

  // Per-escrow timer values from the contract
  if (correctionWindowDays != null && escrow.correctionWindowDays !== Number(correctionWindowDays)) {
    updateData.correctionWindowDays = Number(correctionWindowDays);
  }
  if (autoApprovalDays != null && escrow.autoApprovalDays !== Number(autoApprovalDays)) {
    updateData.autoApprovalDays = Number(autoApprovalDays);
  }
  if (disputeTimeoutDays != null && escrow.disputeTimeoutDays !== Number(disputeTimeoutDays)) {
    updateData.disputeTimeoutDays = Number(disputeTimeoutDays);
  }

  if (cancelled && !escrow.cancelledAt) {
    const cancelledAt = await readCancelledAt(rpc, address);
    if (cancelledAt) updateData.cancelledAt = cancelledAt;
  }

  if (onChainStatus === "FUNDED" && !escrow.fundedAt) {
    let fundedAt: Date = new Date();
    try {
      const logs = await rpc.getLogs({ address, event: fundedEvent, fromBlock: "earliest", toBlock: "latest" });
      if (logs.length > 0 && logs[0].blockNumber != null) {
        fundedAt = await blockDate(rpc, logs[0].blockNumber);
      }
    } catch { /* fall back to now */ }
    updateData.fundedAt = fundedAt;
  }

  if (["SELLER_ACCEPTED", "FUNDED"].includes(onChainStatus) && !escrow.sellerAcceptedAt) {
    updateData.sellerAcceptedAt = new Date();
  }

  if (Object.keys(updateData).length > 0) {
    // Only write if the status is unchanged since we read it. If the listener
    // wrote e.g. SELLER_REJECTED meanwhile, skip — the next sync retries.
    const { count: updated } = await prisma.escrow.updateMany({ where: { id: escrow.id, status: escrow.status }, data: updateData });
    if (updated > 0) console.log(`[${label}] ${address}: updated`, Object.keys(updateData));
  }

  for (let i = 0; i < Number(milestoneCount); i++) {
    if (shouldStop()) {
      console.warn(`[${label}] ${address} sync stopped mid-escrow by restart request`);
      return;
    }

    const result = await rpc.readContract({
      address,
      abi: escrowReadAbi,
      functionName: "milestones",
      args: [BigInt(i)],
    });
    const rawOnChainStatus = MILESTONE_STATUS_MAP[Number(result[1])] ?? "PENDING";
    const dbMilestone = escrow.milestones.find((m) => m.milestoneIndex === i);

    // On-chain has no ESCALATED enum — preserve it when the DB flag is set
    const onChainMilestoneStatus =
      dbMilestone?.isEscalated && rawOnChainStatus === "DISPUTED"
        ? "ESCALATED" as const
        : rawOnChainStatus;

    const submittedAtTs = Number(result[3]);
    const disputeOpenedAtTs = Number(result[5]);
    const submittedAtDate = submittedAtTs > 0 ? new Date(submittedAtTs * 1000) : null;
    const disputeOpenedAtDate = disputeOpenedAtTs > 0 ? new Date(disputeOpenedAtTs * 1000) : null;

    if (!dbMilestone) {
      await prisma.milestone.create({
        data: {
          escrowAddress: escrow.id,
          milestoneIndex: i,
          amount: result[0].toString(),
          status: rawOnChainStatus,
          ...(submittedAtDate ? { submittedAt: submittedAtDate } : {}),
          ...(disputeOpenedAtDate
            ? { disputeOpenedAt: disputeOpenedAtDate, disputeOpenedBy: getAddress(result[6] as `0x${string}`) }
            : {}),
        },
      });
      console.log(`[${label}] ${address} milestone ${i}: created with status ${rawOnChainStatus}`);
      continue;
    }

    const needsStatusUpdate = dbMilestone.status !== onChainMilestoneStatus;
    const needsSubmittedAt = submittedAtNeedsUpdate(dbMilestone.submittedAt, submittedAtDate);
    const needsDisputeAt = !dbMilestone.disputeOpenedAt && disputeOpenedAtDate;
    const needsDisputeClear = disputeFieldsAreStale(dbMilestone, disputeOpenedAtTs);
    const needsPaidAt = !dbMilestone.paidAt && ["PAID", "RESOLVED", "REFUNDED"].includes(onChainMilestoneStatus);
    const needsAwardBackfill = (!dbMilestone.sellerAward || !dbMilestone.buyerAward)
      && ["PAID", "REFUNDED", "RESOLVED"].includes(onChainMilestoneStatus)
      && (dbMilestone.isEscalated || dbMilestone.disputeOpenedAt != null)
      && !needsDisputeClear;

    let sellerAwardValue: string | undefined;
    let buyerAwardValue: string | undefined;
    let correctedStatus: MilestoneStatus | undefined;
    if (needsAwardBackfill) {
      try {
        const allDisputeLogs = await getLogsInChunks(rpc, address, disputeResolvedEvent);
        const decoded = allDisputeLogs.map((l) =>
          decodeEventLog({ abi: [disputeResolvedEvent], data: l.data, topics: l.topics }).args,
        );
        const match = decoded.find((args) => Number(args.milestoneIndex) === i);
        if (match) {
          const { sellerAward, buyerAward } = match;
          sellerAwardValue = sellerAward.toString();
          buyerAwardValue = buyerAward.toString();
          correctedStatus = buyerAward === 0n ? "PAID" : sellerAward === 0n ? "REFUNDED" : "RESOLVED";
          console.log(`[${label}] backfilled awards for ${address} milestone ${i}: seller=${sellerAwardValue}, buyer=${buyerAwardValue}, status=${correctedStatus}`);
        } else {
          console.warn(`[${label}] no DisputeResolved log found for ${address} milestone ${i}`);
        }
      } catch (err) {
        console.error(`[${label}] award backfill failed for ${address} milestone ${i}:`, err);
      }
    }

    const needsStatusCorrection = correctedStatus && dbMilestone.status !== correctedStatus;

    if (needsStatusUpdate || needsSubmittedAt || needsDisputeAt || needsDisputeClear || needsPaidAt || needsAwardBackfill || needsStatusCorrection) {
      await prisma.milestone.update({
        where: milestoneKey(escrow.id, i),
        data: {
          ...(needsStatusUpdate && !needsStatusCorrection ? { status: onChainMilestoneStatus } : {}),
          ...(needsStatusCorrection ? { status: correctedStatus } : {}),
          ...(needsSubmittedAt ? { submittedAt: submittedAtDate } : {}),
          ...(needsPaidAt ? { paidAt: new Date() } : {}),
          ...(needsDisputeAt
            ? { disputeOpenedAt: disputeOpenedAtDate, disputeOpenedBy: getAddress(result[6] as `0x${string}`) }
            : {}),
          ...(needsDisputeClear ? clearedDisputeData() : {}),
          ...(sellerAwardValue ? { sellerAward: sellerAwardValue } : {}),
          ...(buyerAwardValue ? { buyerAward: buyerAwardValue } : {}),
        },
      });
      if (needsStatusUpdate) console.log(`[${label}] ${address} milestone ${i}: ${dbMilestone.status} → ${needsStatusCorrection ? correctedStatus : onChainMilestoneStatus}`);
      if (needsSubmittedAt) console.log(`[${label}] ${address} milestone ${i}: repaired submittedAt`);
      if (needsDisputeAt) console.log(`[${label}] ${address} milestone ${i}: repaired disputeOpenedAt`);
      if (needsDisputeClear) console.log(`[${label}] ${address} milestone ${i}: cleared dispute after resubmit`);
    }
  }
}

/**
 * Sync one escrow with the chain. Called by the API before it answers
 * (events, milestones, admin), so the page is right even if a watcher missed
 * an event. Seeds the escrow first if the DB has never seen it.
 */
export async function syncSingleEscrow(escrowId: string) {
  const address = escrowId as `0x${string}`;

  let escrow = await prisma.escrow.findFirst({
    where: { id: { equals: address, mode: "insensitive" } },
    include: { milestones: true },
  });
  if (!escrow) {
    const factoryAddress = process.env.FACTORY_ADDRESS as `0x${string}` | undefined;
    if (!factoryAddress) {
      console.error("[sync] FACTORY_ADDRESS not configured for self-heal");
      return;
    }

    try {
      const seeded = await seedMissingEscrowFromChain(factoryAddress, address);
      if (!seeded) {
        console.log(`[sync] escrow not found: ${address}`);
        return;
      }
    } catch (err) {
      console.error(`[sync] failed to self-seed missing escrow ${address}`, err);
      return;
    }

    escrow = await prisma.escrow.findFirst({
      where: { id: { equals: address, mode: "insensitive" } },
      include: { milestones: true },
    });

    if (!escrow) {
      console.error(`[sync] self-seed reported success but escrow is still missing: ${address}`);
      return;
    }
  }

  try {
    await syncEscrowState(escrow, "sync");
  } catch (err) {
    console.error(`[sync] FAILED for ${address}:`, err);
  }
}
