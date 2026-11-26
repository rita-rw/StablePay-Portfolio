import { createPublicClient, http, decodeEventLog, getAddress, type AbiEvent, type Address, type Log } from "viem";
import { baseSepolia } from "viem/chains";
import { MilestoneStatus } from "../generated/prisma/enums";
import type { Escrow, Milestone } from "../generated/prisma/client";
import { prisma } from "./prisma";
import { sendNotification } from "./mailer";
import { escrowReadAbi } from "./abi/StablePayEscrow.read.abi";
import { factoryReadAbi } from "./abi/EscrowFactory.read.abi";
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
} from "./abi/events";
import { milestoneLabelAt, parseMilestoneLabels } from "./services/escrowService";

const MILESTONE_STATUS_MAP: Record<number, MilestoneStatus> = {
  0: MilestoneStatus.PENDING,
  1: MilestoneStatus.SUBMITTED,
  2: MilestoneStatus.DISPUTED,
  3: MilestoneStatus.PAID,
  4: MilestoneStatus.REFUNDED,
  5: MilestoneStatus.RESOLVED,
};

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL),
  pollingInterval: 2_000,
});

// Separate client for backfill — uses public RPC with no block-range restrictions
const backfillClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL_FALLBACK),
});

const FACTORY_DEPLOY_BLOCK = BigInt(process.env.FACTORY_DEPLOY_BLOCK ?? "51429061");
const LOG_CHUNK_SIZE = 9_500n;
// How many escrows catchUpOnChainState() syncs at once against the public RPC.
// Higher = faster startup but bigger request bursts against the free/public RPC.
const CATCH_UP_CONCURRENCY = 5;
// Pause between catch-up batches to give the free public RPC room to breathe.
const CATCH_UP_BATCH_DELAY_MS = Number(process.env.CATCH_UP_BATCH_DELAY_MS ?? "500");
const LISTENER_HEARTBEAT_INTERVAL_MS = Number(process.env.LISTENER_HEARTBEAT_INTERVAL_MS ?? "15000");
const LISTENER_STALE_AFTER_MS = Number(process.env.LISTENER_STALE_AFTER_MS ?? "45000");
const LISTENER_RESTART_BASE_MS = Number(process.env.LISTENER_RESTART_BASE_MS ?? "2000");
const LISTENER_RESTART_MAX_MS = Number(process.env.LISTENER_RESTART_MAX_MS ?? "30000");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The free public RPC (RPC_URL_FALLBACK) returns HTTP 429 / JSON-RPC -32016
 * ("over rate limit") under load. viem wraps these several causes deep, so walk
 * the whole error chain looking for the tell-tale status/message.
 */
function isRateLimitError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; current != null && depth < 10; depth++) {
    const e = current as {
      status?: number;
      details?: string;
      shortMessage?: string;
      message?: string;
      cause?: unknown;
    };
    if (e.status === 429) return true;
    const text = `${e.details ?? ""} ${e.shortMessage ?? ""} ${e.message ?? ""}`.toLowerCase();
    if (text.includes("rate limit") || text.includes("-32016")) return true;
    current = e.cause;
  }
  return false;
}

/**
 * Retries `fn` while the public RPC is rate-limiting, backing off
 * 1s, 2s, 4s, 8s, 16s. Non-rate-limit errors are rethrown immediately.
 *
 * `label` should say which startup phase and which unit is being retried
 * (e.g. "catch-up 0x1234…" or "backfill 38641491-38650990"), since it is the
 * only thing distinguishing the retry lines in the log.
 */
async function withRateLimitRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 5): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= maxRetries) throw err;
      const backoffMs = 1000 * 2 ** attempt;
      console.warn(`[rpc] rate limited on ${label}, retry ${attempt + 1}/${maxRetries} in ${backoffMs}ms`);
      await sleep(backoffMs);
    }
  }
}

type EscrowCreatedArgs = {
  escrow: `0x${string}`;
  buyer: `0x${string}`;
  seller: `0x${string}`;
  token: `0x${string}`;
  totalAmount: bigint;
  milestoneCount: bigint;
  metadataHash: `0x${string}`;
};

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

type SeedFromCreationLogOptions = {
  claimMetadata: boolean;
  notify: boolean;
  context: string;
  milestoneReadClient: typeof client;
};

async function getLogsInChunks(
  logClient: typeof backfillClient,
  address: `0x${string}`,
  event: typeof disputeResolvedEvent,
) {
  const latestBlock = await logClient.getBlockNumber();
  const allLogs = [];
  for (let start = FACTORY_DEPLOY_BLOCK; start <= latestBlock; start += LOG_CHUNK_SIZE) {
    const end = start + LOG_CHUNK_SIZE - 1n < latestBlock ? start + LOG_CHUNK_SIZE - 1n : latestBlock;
    const chunk = await logClient.getLogs({ address, event, fromBlock: start, toBlock: end });
    allLogs.push(...chunk);
  }
  return allLogs;
}

// In-memory set of known escrow addresses (lowercase).
// Used to filter global event watchers — no per-escrow watcher needed.
const knownEscrows = new Set<string>();
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

/** Block time of a close event. Null if it is not in the recent window or the RPC refuses the read. */
async function readCancelledAt(
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

/**
 * Cancel and seller-reject used to store only the status, so the Closed list
 * fell back to createdAt. Fill cancelledAt from the chain for those rows.
 */
async function repairMissingCancelledAt(startToken: number) {
  const escrows = await prisma.escrow.findMany({
    where: {
      cancelledAt: null,
      status: { in: ["CANCELLED", "SELLER_REJECTED"] },
    },
    select: { id: true, status: true },
  });
  if (escrows.length === 0) return;

  console.log(`[cancel-repair] reading close time for ${escrows.length} escrows...`);
  for (let i = 0; i < escrows.length; i += CATCH_UP_CONCURRENCY) {
    if (shouldAbortStartup(startToken)) return;
    const batch = escrows.slice(i, i + CATCH_UP_CONCURRENCY);
    await Promise.all(
      batch.map((escrow) =>
        withRateLimitRetry(async () => {
          const events = escrow.status === "SELLER_REJECTED"
            ? [projectRejectedEvent]
            : [escrowCancelledEvent];
          const cancelledAt = await readCancelledAt(backfillClient, escrow.id as `0x${string}`, events);
          if (!cancelledAt) return;
          await prisma.escrow.update({ where: { id: escrow.id }, data: { cancelledAt } });
          console.log(`[cancel-repair] ${escrow.id}: ${cancelledAt.toISOString()}`);
        }, `cancel-repair ${escrow.id}`).catch((err) =>
          console.error(`[cancel-repair] failed for ${escrow.id}`, err),
        ),
      ),
    );
    if (i + CATCH_UP_CONCURRENCY < escrows.length) await sleep(CATCH_UP_BATCH_DELAY_MS);
  }
}

/** Convert a log's block timestamp to a JS Date (falls back to now if fetch fails). */
async function blockDate(blockClient: typeof client, blockNumber: bigint | null | undefined): Promise<Date> {
  if (!blockNumber) return new Date();
  try {
    const block = await blockClient.getBlock({ blockNumber });
    return new Date(Number(block.timestamp) * 1000);
  } catch {
    return new Date();
  }
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

/** The DB key of one milestone. */
function milestoneKey(escrowAddress: string, milestoneIndex: number) {
  return { escrowAddress_milestoneIndex: { escrowAddress, milestoneIndex } };
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

async function getMetadataForHash(metadataHash: `0x${string}`, claimMetadata: boolean) {
  if (claimMetadata) {
    try {
      const meta = await prisma.projectMetadata.delete({ where: { metadataHash } });
      return {
        title: meta.title,
        description: meta.description,
        milestoneLabels: parseMilestoneLabels(meta.milestoneLabels),
      };
    } catch {
      return { title: null, description: null, milestoneLabels: [] as string[] };
    }
  }

  const meta = await prisma.projectMetadata.findUnique({ where: { metadataHash } });
  return {
    title: meta?.title ?? null,
    description: meta?.description ?? null,
    milestoneLabels: parseMilestoneLabels(meta?.milestoneLabels),
  };
}

async function seedEscrowFromCreationLog(
  log: { args: EscrowCreatedArgs; transactionHash: `0x${string}` | null | undefined },
  options: SeedFromCreationLogOptions,
) {
  const { args } = log;
  knownEscrows.add(args.escrow.toLowerCase());

  try {
    const { title, description, milestoneLabels } = await getMetadataForHash(args.metadataHash, options.claimMetadata);

    await prisma.escrow.upsert({
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
        txHash: log.transactionHash ?? null,
      },
      update: {
        txHash: log.transactionHash ?? undefined,
        title: title ?? undefined,
        description: description ?? undefined,
      },
    });

    for (let i = 0; i < Number(args.milestoneCount); i++) {
      try {
        const result = await options.milestoneReadClient.readContract({
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
          update: {
            amount: result[0].toString(),
            status: MILESTONE_STATUS_MAP[Number(result[1])] ?? "PENDING",
            ...(label ? { label } : {}),
          },
        });
      } catch (err) {
        console.error(`[${options.context}] milestone ${i} for ${args.escrow} failed`, err);
      }
    }

    if (options.notify) {
      void sendNotification("PROJECT_ASSIGNED", args.escrow);
    }
  } catch (err) {
    console.error(`[${options.context}] failed to seed ${args.escrow}`, err);
  }
}

async function seedMissingEscrowFromChain(
  factoryAddress: `0x${string}`,
  escrowAddress: `0x${string}`,
) {
  const isValid = await backfillClient.readContract({
    address: factoryAddress,
    abi: factoryReadAbi,
    functionName: "isValidEscrow",
    args: [escrowAddress],
  }) as boolean;

  if (!isValid) {
    console.log(`[sync] escrow ${escrowAddress} is not registered in the factory`);
    return false;
  }

  // Read the same fields the EscrowCreated event carries straight from the
  // contract — the event itself would need eth_getLogs over the factory's whole
  // history, which the public RPC no longer allows (200-block cap).
  const [buyer, seller, token, totalAmount, milestoneCount, metadataHash] = await Promise.all([
    backfillClient.readContract({ address: escrowAddress, abi: escrowReadAbi, functionName: "BUYER" }),
    backfillClient.readContract({ address: escrowAddress, abi: escrowReadAbi, functionName: "SELLER" }),
    backfillClient.readContract({ address: escrowAddress, abi: escrowReadAbi, functionName: "TOKEN" }),
    backfillClient.readContract({ address: escrowAddress, abi: escrowReadAbi, functionName: "totalAmount" }),
    backfillClient.readContract({ address: escrowAddress, abi: escrowReadAbi, functionName: "milestoneCount" }),
    backfillClient.readContract({ address: escrowAddress, abi: escrowReadAbi, functionName: "METADATA_HASH" }),
  ]);

  await seedEscrowFromCreationLog(
    {
      args: {
        escrow: escrowAddress,
        buyer: getAddress(buyer as string),
        seller: getAddress(seller as string),
        token: getAddress(token as string),
        totalAmount: totalAmount as bigint,
        milestoneCount: milestoneCount as bigint,
        metadataHash: metadataHash as `0x${string}`,
      },
      // The creation tx hash only exists in the event; the receipt page hides the link without it.
      transactionHash: null,
    },
    {
      claimMetadata: false,
      notify: false,
      context: "self-heal",
      milestoneReadClient: backfillClient,
    },
  );
  console.log(`[sync] seeded escrow from direct chain reads: ${escrowAddress}`);
  return true;
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

    try {
      await loadKnownEscrowsFromDb();

      if (shouldAbortStartup(startToken)) return;

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

      await backfillFromHistory(factoryAddress, startToken);
      if (shouldAbortStartup(startToken)) return;

      await catchUpOnChainState(startToken);
      if (shouldAbortStartup(startToken)) return;

      await repairMissingCancelledAt(startToken);
      if (shouldAbortStartup(startToken)) return;

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

/**
 * Seed every escrow the factory knows about that isn't in the DB yet.
 * Reads the list straight from the factory instead of scanning EscrowCreated
 * logs — the public RPC caps eth_getLogs at 200 blocks, and the factory's
 * history is millions of blocks long. Runs after the watchers start, so any
 * escrow created later is picked up by the EscrowCreated watcher instead.
 */
async function backfillFromHistory(factoryAddress: `0x${string}`, startToken: number) {
  console.log("[backfill] Reading escrow list from factory...");

  try {
    const allEscrows = await withRateLimitRetry(
      () => backfillClient.readContract({ address: factoryAddress, abi: factoryReadAbi, functionName: "getAllEscrows" }),
      "backfill getAllEscrows",
    );
    // Already-known escrows are resynced by catchUpOnChainState() right after this.
    const missing = allEscrows.filter((address) => !knownEscrows.has(address.toLowerCase()));
    console.log(`[backfill] factory has ${allEscrows.length} escrows, ${missing.length} missing from DB`);

    for (const escrowAddress of missing) {
      if (shouldAbortStartup(startToken)) {
        console.warn("[backfill] aborted by restart request");
        return;
      }
      // One failing escrow must not stop the rest from being seeded.
      try {
        await withRateLimitRetry(
          () => seedMissingEscrowFromChain(factoryAddress, escrowAddress),
          `backfill ${escrowAddress}`,
        );
      } catch (err) {
        console.error(`[backfill] failed to seed ${escrowAddress}`, err);
      }
    }

    console.log("[backfill] done");
  } catch (err) {
    console.error("[backfill] failed to read escrow list", err);
  }
}

/** Dispute fields the contract zeroes in resubmitDuringDispute. */
function clearedDisputeData() {
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

type EscrowWithMilestones = Escrow & { milestones: Milestone[] };

/**
 * Bring one escrow and its milestones in the DB in line with the chain.
 * Shared by the startup catch-up and the per-project sync. Throws on RPC errors,
 * so the caller decides whether to retry (catch-up) or only log (sync).
 *
 * `label` prefixes the log lines; `shouldStop` lets a listener restart cut it short.
 */
async function syncEscrowState(
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

/**
 * On startup, sync every escrow that isn't cancelled, to catch events missed
 * while the backend was down. Runs in small batches against the public RPC.
 */
async function catchUpOnChainState(startToken: number) {
  const escrows = await prisma.escrow.findMany({
    where: { status: { not: "CANCELLED" } },
    include: { milestones: true },
  });

  if (escrows.length === 0) return;
  console.log(`[catch-up] syncing ${escrows.length} escrows with on-chain state...`);

  const processEscrow = async (escrow: EscrowWithMilestones) => {
    try {
      await syncEscrowState(escrow, "catch-up", () => shouldAbortStartup(startToken));
    } catch (err) {
      // Let the batch-level retry handle transient public-RPC rate limits.
      if (isRateLimitError(err)) throw err;
      console.error(`[catch-up] failed for ${escrow.id}`, err);
    }
  };

  for (let i = 0; i < escrows.length; i += CATCH_UP_CONCURRENCY) {
    if (shouldAbortStartup(startToken)) {
      console.warn("[catch-up] aborted by restart request");
      return;
    }

    const batch = escrows.slice(i, i + CATCH_UP_CONCURRENCY);
    await Promise.all(
      batch.map((escrow) =>
        withRateLimitRetry(() => processEscrow(escrow), `catch-up ${escrow.id}`).catch((err) =>
          console.error(`[catch-up] failed for ${escrow.id}`, err),
        ),
      ),
    );

    if (i + CATCH_UP_CONCURRENCY < escrows.length) {
      await sleep(CATCH_UP_BATCH_DELAY_MS);
    }
  }

  console.log("[catch-up] done");
}
