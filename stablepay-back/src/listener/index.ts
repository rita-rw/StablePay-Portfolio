import { getAddress, type AbiEvent, type Address, type Log } from "viem";
import { prisma } from "../prisma";
import { sendNotification } from "../mailer";
import { escrowReadAbi } from "../abi/StablePayEscrow.read.abi";
import {
  escrowCreatedEvent,
  fundedEvent,
  milestoneSubmittedEvent,
  milestoneApprovedEvent,
  milestoneAutoApprovedEvent,
  escrowCancelledEvent,
  milestoneRefundedEvent,
  disputeOpenedEvent,
  milestoneResubmittedEvent,
  disputeResolvedEvent,
  disputeTimeoutClaimedEvent,
  projectAcceptedEvent,
  projectRejectedEvent,
  disputeEscalatedEvent,
} from "../abi/events";
import { milestoneLabelAt, parseMilestoneLabels } from "../services/escrowService";
import { MILESTONE_STATUS_MAP, blockDate, client, knownEscrows, milestoneKey } from "./chain";
import type { EscrowCreatedArgs } from "./seed";
import { clearedDisputeData } from "./sync";
import { backfillFromHistory, catchUpOnChainState, repairMissingCancelledAt } from "./startup";

export { syncSingleEscrow } from "./sync";

const LISTENER_HEARTBEAT_INTERVAL_MS = Number(process.env.LISTENER_HEARTBEAT_INTERVAL_MS ?? "15000");
const LISTENER_STALE_AFTER_MS = Number(process.env.LISTENER_STALE_AFTER_MS ?? "45000");
const LISTENER_RESTART_BASE_MS = Number(process.env.LISTENER_RESTART_BASE_MS ?? "2000");
const LISTENER_RESTART_MAX_MS = Number(process.env.LISTENER_RESTART_MAX_MS ?? "30000");

type ListenerLifecycleState = "idle" | "starting" | "ready" | "restarting";

type ListenerStatusSnapshot = {
  healthy: boolean;
  state: ListenerLifecycleState | "degraded";
  startupComplete: boolean;
  watchersActive: boolean;
  restartCount: number;
  restartScheduled: boolean;
  lastWatcherSuccessAt: string | null;
  lastWatcherErrorAt: string | null;
  reason: string | null;
  staleAfterMs: number;
};

const watcherUnsubscribers: Array<() => void> = [];

let listenersActive = false;
let listenerLifecycleState: ListenerLifecycleState = "idle";
let listenerStartupComplete = false;
let listenerRestartCount = 0;
let listenerRestartAttempt = 0;
let listenerRestartToken = 0;
let listenerRestartScheduled = false;
let listenerStartPromise: Promise<void> | null = null;
let listenerRestartTimer: NodeJS.Timeout | null = null;
let listenerHeartbeatInterval: NodeJS.Timeout | null = null;
let lastWatcherSuccessAt: Date | null = null;
let lastWatcherErrorAt: Date | null = null;
let listenerReason: string | null = null;

export function getListenerStatus(): ListenerStatusSnapshot {
  const now = Date.now();
  const isStale = listenersActive
    && listenerStartupComplete
    && (!lastWatcherSuccessAt || now - lastWatcherSuccessAt.getTime() > LISTENER_STALE_AFTER_MS);
  const healthy = listenerLifecycleState === "ready"
    && listenersActive
    && listenerStartupComplete
    && !listenerRestartScheduled
    && !isStale;

  return {
    healthy,
    state: healthy ? "ready" : isStale ? "degraded" : listenerLifecycleState,
    startupComplete: listenerStartupComplete,
    watchersActive: listenersActive,
    restartCount: listenerRestartCount,
    restartScheduled: listenerRestartScheduled,
    lastWatcherSuccessAt: lastWatcherSuccessAt?.toISOString() ?? null,
    lastWatcherErrorAt: lastWatcherErrorAt?.toISOString() ?? null,
    reason: listenerReason,
    staleAfterMs: LISTENER_STALE_AFTER_MS,
  };
}

function shouldAbortStartup(startToken: number): boolean {
  return startToken !== listenerRestartToken;
}

function stopHeartbeat() {
  if (!listenerHeartbeatInterval) return;
  clearInterval(listenerHeartbeatInterval);
  listenerHeartbeatInterval = null;
}

function stopWatchers() {
  stopHeartbeat();

  while (watcherUnsubscribers.length > 0) {
    const unwatch = watcherUnsubscribers.pop();
    try {
      unwatch?.();
    } catch (err) {
      console.error("[listener] failed to stop watcher", err);
    }
  }

  listenersActive = false;
}

function markWatcherSuccess() {
  lastWatcherSuccessAt = new Date();
}

function startHeartbeat(startToken: number) {
  stopHeartbeat();

  const tick = async () => {
    if (shouldAbortStartup(startToken) || !listenersActive) {
      return;
    }

    try {
      await client.getBlockNumber();
      markWatcherSuccess();
    } catch (err) {
      handleWatcherError("heartbeat", err);
    }
  };

  void tick();
  listenerHeartbeatInterval = setInterval(() => {
    void tick();
  }, LISTENER_HEARTBEAT_INTERVAL_MS);
}

function queueRestartAfterCurrentStart() {
  listenerRestartScheduled = true;
  if (listenerStartPromise) {
    return;
  }

  listenerRestartAttempt += 1;
  listenerRestartCount += 1;
  void startListener();
}

function scheduleListenerRestart(reason: string, error?: unknown) {
  listenerRestartToken += 1;
  listenerLifecycleState = "restarting";
  listenerStartupComplete = false;
  listenerReason = reason;
  if (error) {
    lastWatcherErrorAt = new Date();
  }

  stopWatchers();

  if (listenerRestartTimer) {
    return;
  }

  const delayMs = Math.min(
    LISTENER_RESTART_BASE_MS * (2 ** listenerRestartAttempt),
    LISTENER_RESTART_MAX_MS,
  );

  listenerRestartScheduled = true;
  console.warn(`[listener] scheduling restart in ${delayMs}ms (${reason})`);

  listenerRestartTimer = setTimeout(() => {
    listenerRestartTimer = null;

    if (listenerStartPromise) {
      return;
    }

    listenerRestartAttempt += 1;
    listenerRestartCount += 1;
    void startListener();
  }, delayMs);
}

function handleWatcherError(watcherName: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[listener] watcher error in ${watcherName} (primary RPC)`, error);
  scheduleListenerRestart(`watcher ${watcherName} failed: ${message}`, error);
}

function registerWatcher(name: string, register: (onError: (error: Error) => void) => () => void) {
  const unwatch = register((error) => handleWatcherError(name, error));
  watcherUnsubscribers.push(unwatch);
}

/**
 * Watch one escrow event on every escrow we know about. Each log reaches `handle`
 * with its decoded args; logs from unknown contracts are skipped, and a failing
 * handler is logged without stopping the rest of the batch.
 */
function watchEscrowEvent<const TEvent extends AbiEvent>(
  event: TEvent,
  handle: (escrowAddress: Address, log: Log<bigint, number, false, TEvent, true>) => Promise<void>,
) {
  registerWatcher(event.name, (onError) => client.watchEvent({
    event,
    strict: true,
    onError,
    onLogs: async (logs) => {
      for (const log of logs) {
        const escrowAddress = getAddress(log.address);
        if (!knownEscrows.has(escrowAddress.toLowerCase())) continue;
        try {
          await handle(escrowAddress, log);
        } catch (err) {
          console.error(`[listener] ${event.name} DB update failed`, err);
        }
      }
    },
  }));
}

async function loadKnownEscrowsFromDb() {
  knownEscrows.clear();
  const escrows = await prisma.escrow.findMany({ select: { id: true } });
  for (const escrow of escrows) {
    knownEscrows.add(escrow.id.toLowerCase());
  }
  console.log(`[listener] loaded ${knownEscrows.size} escrows from DB`);
}

export async function startListener() {
  const factoryAddress = process.env.FACTORY_ADDRESS as `0x${string}` | undefined;
  if (!factoryAddress) {
    listenerLifecycleState = "restarting";
    listenerReason = "Missing FACTORY_ADDRESS";
    console.error("[listener] missing FACTORY_ADDRESS");
    return;
  }

  if (listenerStartPromise) {
    return listenerStartPromise;
  }

  const startToken = listenerRestartToken;
  listenerRestartScheduled = false;

  listenerStartPromise = (async () => {
    listenerLifecycleState = "starting";
    listenerStartupComplete = false;
    listenerReason = null;

    const shouldStop = () => shouldAbortStartup(startToken);

    try {
      await loadKnownEscrowsFromDb();

      if (shouldStop()) return;

      // EscrowCreated comes from the factory; the other events from each escrow.
      registerWatcher("EscrowCreated", (onError) => client.watchContractEvent({
        address: factoryAddress,
        abi: [escrowCreatedEvent],
        eventName: "EscrowCreated",
        onError,
        onLogs: async (logs) => {
          for (const log of logs) {
            const args = log.args as unknown as EscrowCreatedArgs;

            knownEscrows.add(args.escrow.toLowerCase());

            console.log("[EscrowCreated]", {
              escrow: args.escrow,
              buyer: args.buyer,
              seller: args.seller,
              token: args.token,
              totalAmount: args.totalAmount.toString(),
              milestoneCount: Number(args.milestoneCount),
              txHash: log.transactionHash,
            });

            // Look up pre-saved metadata and upsert the escrow atomically.
            // If the upsert fails after the metadata delete, the transaction rolls back
            // and the metadata row is preserved — no permanent data loss.
            let milestoneLabels: string[] = [];
            try {
              await prisma.$transaction(async (tx) => {
                let title: string | null = null;
                let description: string | null = null;
                try {
                  const meta = await tx.projectMetadata.delete({
                    where: { metadataHash: args.metadataHash },
                  });
                  title = meta.title;
                  description = meta.description;
                  milestoneLabels = parseMilestoneLabels(meta.milestoneLabels);
                } catch {
                  // Record not found — either never saved or already claimed by a concurrent event
                }

                await tx.escrow.upsert({
                  where: { id: args.escrow },
                  create: {
                    id: args.escrow,
                    buyer: args.buyer,
                    seller: args.seller,
                    token: args.token,
                    totalAmount: args.totalAmount.toString(),
                    milestoneCount: Number(args.milestoneCount),
                    metadataHash: args.metadataHash,
                    title,
                    description,
                    txHash: log.transactionHash,
                  },
                  update: {
                    txHash: log.transactionHash,
                    title: title ?? undefined,
                    description: description ?? undefined,
                  },
                });
              });
            } catch (err) {
              console.error("[listener] EscrowCreated DB write failed", err);
            }
            // Create Milestone rows directly from chain so we don't depend on POST /projects/seed
            const count = Number(args.milestoneCount);
            for (let i = 0; i < count; i++) {
              try {
                const result = await client.readContract({
                  address: args.escrow,
                  abi: escrowReadAbi,
                  functionName: "milestones",
                  args: [BigInt(i)],
                });
                const label = milestoneLabelAt(milestoneLabels, i);
                await prisma.milestone.upsert({
                  where: { escrowAddress_milestoneIndex: { escrowAddress: args.escrow, milestoneIndex: i } },
                  create: {
                    escrowAddress: args.escrow,
                    milestoneIndex: i,
                    amount: result[0].toString(),
                    status: MILESTONE_STATUS_MAP[Number(result[1])] ?? "PENDING",
                    ...(label ? { label } : {}),
                  },
                  update: label ? { label } : {},
                });
              } catch (err) {
                console.error(`[listener] EscrowCreated milestone ${i} create failed`, err);
              }
            }

            // Send email after DB rows exist so the mailer can look up the escrow
            void sendNotification("PROJECT_ASSIGNED", args.escrow);
          }
        },
      }));

      console.log("[listener] watching EscrowCreated on", factoryAddress);

      watchEscrowEvent(fundedEvent, async (escrowAddress, log) => {
        const { buyer, amount } = log.args;
        console.log("[Funded]", { escrow: escrowAddress, buyer, amount: amount.toString(), txHash: log.transactionHash });
        await prisma.escrow.update({
          where: { id: escrowAddress },
          data: { status: "FUNDED", fundedTxHash: log.transactionHash, fundedAt: await blockDate(client, log.blockNumber) },
        });
        void sendNotification("PROJECT_FUNDED", escrowAddress);
      });

      watchEscrowEvent(milestoneSubmittedEvent, async (escrowAddress, log) => {
        const index = Number(log.args.milestoneIndex);
        console.log("[MilestoneSubmitted]", { escrow: escrowAddress, milestoneIndex: index });
        await prisma.milestone.update({
          where: milestoneKey(escrowAddress, index),
          data: { status: "SUBMITTED", submittedAt: await blockDate(client, log.blockNumber) },
        });
        void sendNotification("MILESTONE_SUBMITTED", escrowAddress);
      });

      watchEscrowEvent(milestoneApprovedEvent, async (escrowAddress, log) => {
        const index = Number(log.args.milestoneIndex);
        console.log("[MilestoneApproved]", { escrow: escrowAddress, milestoneIndex: index });
        await prisma.milestone.update({
          where: milestoneKey(escrowAddress, index),
          data: { status: "PAID", paidAt: await blockDate(client, log.blockNumber), autoApproved: false },
        });
        void sendNotification("MILESTONE_APPROVED", escrowAddress);
      });

      watchEscrowEvent(milestoneAutoApprovedEvent, async (escrowAddress, log) => {
        const index = Number(log.args.milestoneIndex);
        console.log("[MilestoneAutoApproved]", { escrow: escrowAddress, milestoneIndex: index });
        await prisma.milestone.update({
          where: milestoneKey(escrowAddress, index),
          data: { status: "PAID", paidAt: await blockDate(client, log.blockNumber), autoApproved: true },
        });
        void sendNotification("MILESTONE_APPROVED", escrowAddress);
      });

      watchEscrowEvent(escrowCancelledEvent, async (escrowAddress, log) => {
        console.log("[EscrowCancelled]", { escrow: escrowAddress });
        await prisma.escrow.update({
          where: { id: escrowAddress },
          data: { status: "CANCELLED", cancelledAt: await blockDate(client, log.blockNumber) },
        });
        void sendNotification("PROJECT_CANCELLED", escrowAddress);
      });

      watchEscrowEvent(milestoneRefundedEvent, async (escrowAddress, log) => {
        const index = Number(log.args.milestoneIndex);
        console.log("[MilestoneRefunded]", { escrow: escrowAddress, milestoneIndex: index });
        await prisma.milestone.update({
          where: milestoneKey(escrowAddress, index),
          data: { status: "REFUNDED" },
        });
      });

      watchEscrowEvent(disputeOpenedEvent, async (escrowAddress, log) => {
        const index = Number(log.args.milestoneIndex);
        const { openedBy } = log.args;
        console.log("[DisputeOpened]", { escrow: escrowAddress, milestoneIndex: index, openedBy });
        await prisma.milestone.update({
          where: milestoneKey(escrowAddress, index),
          data: {
            status: "DISPUTED",
            disputeOpenedAt: await blockDate(client, log.blockNumber),
            disputeOpenedBy: getAddress(openedBy),
          },
        });
        void sendNotification("DISPUTE_OPENED", escrowAddress);
      });

      watchEscrowEvent(milestoneResubmittedEvent, async (escrowAddress, log) => {
        const index = Number(log.args.milestoneIndex);
        console.log("[MilestoneResubmitted]", { escrow: escrowAddress, milestoneIndex: index });
        await prisma.milestone.update({
          where: milestoneKey(escrowAddress, index),
          data: {
            status: "SUBMITTED",
            submittedAt: await blockDate(client, log.blockNumber),
            // Contract resets the dispute. A later buyer approval must be a normal payout.
            ...clearedDisputeData(),
          },
        });
        void sendNotification("MILESTONE_RESUBMITTED", escrowAddress);
      });

      watchEscrowEvent(disputeResolvedEvent, async (escrowAddress, log) => {
        const index = Number(log.args.milestoneIndex);
        const { sellerAward, buyerAward } = log.args;
        // Mirror the contract logic: PAID = seller got all, REFUNDED = buyer got all, RESOLVED = split
        const resolvedStatus = buyerAward === 0n ? "PAID" : sellerAward === 0n ? "REFUNDED" : "RESOLVED";
        console.log("[DisputeResolved]", {
          escrow: escrowAddress,
          milestoneIndex: index,
          sellerAward: sellerAward.toString(),
          buyerAward: buyerAward.toString(),
          resolvedStatus,
        });
        await prisma.milestone.update({
          where: milestoneKey(escrowAddress, index),
          data: {
            status: resolvedStatus,
            paidAt: await blockDate(client, log.blockNumber),
            sellerAward: sellerAward.toString(),
            buyerAward: buyerAward.toString(),
          },
        });
        void sendNotification("DISPUTE_RESOLVED", escrowAddress);
      });

      watchEscrowEvent(disputeTimeoutClaimedEvent, async (escrowAddress, log) => {
        const index = Number(log.args.milestoneIndex);
        console.log("[DisputeTimeoutClaimed]", { escrow: escrowAddress, milestoneIndex: index });
        await prisma.milestone.update({
          where: milestoneKey(escrowAddress, index),
          data: {
            status: "REFUNDED",
            paidAt: await blockDate(client, log.blockNumber),
            sellerAward: "0",
            buyerAward: log.args.buyerRefund.toString(),
          },
        });
      });

      watchEscrowEvent(projectAcceptedEvent, async (escrowAddress, log) => {
        console.log("[ProjectAccepted]", { escrow: escrowAddress, seller: log.args.seller });
        await prisma.escrow.update({
          where: { id: escrowAddress },
          data: { status: "SELLER_ACCEPTED" },
        });
        void sendNotification("PROJECT_ACCEPTED", escrowAddress);
      });

      watchEscrowEvent(projectRejectedEvent, async (escrowAddress, log) => {
        console.log("[ProjectRejected]", { escrow: escrowAddress, seller: log.args.seller });
        await prisma.escrow.update({
          where: { id: escrowAddress },
          data: { status: "SELLER_REJECTED", cancelledAt: await blockDate(client, log.blockNumber) },
        });
        void sendNotification("PROJECT_REJECTED", escrowAddress);
      });

      watchEscrowEvent(disputeEscalatedEvent, async (escrowAddress, log) => {
        const index = Number(log.args.milestoneIndex);
        console.log("[DisputeEscalated]", { escrow: escrowAddress, milestoneIndex: index });
        const [escalatedAt, seller] = await Promise.all([
          blockDate(client, log.blockNumber),
          client.readContract({ address: escrowAddress, abi: escrowReadAbi, functionName: "SELLER" }),
        ]);
        await prisma.milestone.update({
          where: milestoneKey(escrowAddress, index),
          data: {
            status: "ESCALATED",
            isEscalated: true,
            disputeEscalatedAt: escalatedAt,
            disputeEscalatedBy: getAddress(seller as string),
          },
        });
        void sendNotification("DISPUTE_ESCALATED", escrowAddress);
      });

      listenersActive = true;
      markWatcherSuccess();
      startHeartbeat(startToken);
      console.log("[listener] global watchers started (14 total)");

      await backfillFromHistory(factoryAddress, shouldStop);
      if (shouldStop()) return;

      await catchUpOnChainState(shouldStop);
      if (shouldStop()) return;

      await repairMissingCancelledAt(shouldStop);
      if (shouldStop()) return;

      listenerLifecycleState = "ready";
      listenerStartupComplete = true;
      listenerReason = null;
      listenerRestartAttempt = 0;
      console.log("[listener] startup sync finished");
    } catch (err) {
      console.error("[listener] startup failed", err);
      scheduleListenerRestart("startup failed", err);
    } finally {
      listenerStartPromise = null;

      if (listenerRestartScheduled && !listenerRestartTimer) {
        queueRestartAfterCurrentStart();
      }
    }
  })();

  return listenerStartPromise;
}
