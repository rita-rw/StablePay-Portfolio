import { createPublicClient, http, decodeEventLog, getAddress } from "viem";
import { baseSepolia } from "viem/chains";
import { MilestoneStatus } from "../generated/prisma/enums";
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
import { seedEscrow } from "./services/escrowService";

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

const FACTORY_DEPLOY_BLOCK = BigInt(process.env.FACTORY_DEPLOY_BLOCK ?? "38641491");
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
      return { title: meta.title, description: meta.description };
    } catch {
      return { title: null, description: null };
    }
  }

  const meta = await prisma.projectMetadata.findUnique({ where: { metadataHash } });
  return {
    title: meta?.title ?? null,
    description: meta?.description ?? null,
  };
}

async function seedEscrowFromCreationLog(
  log: { args: EscrowCreatedArgs; transactionHash: `0x${string}` | null | undefined },
  options: SeedFromCreationLogOptions,
) {
  const { args } = log;
  knownEscrows.add(args.escrow.toLowerCase());

  try {
    const { title, description } = await getMetadataForHash(args.metadataHash, options.claimMetadata);

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

        await prisma.milestone.upsert({
          where: { escrowAddress_milestoneIndex: { escrowAddress: args.escrow, milestoneIndex: i } },
          create: {
            escrowAddress: args.escrow,
            milestoneIndex: i,
            amount: result[0].toString(),
            status: MILESTONE_STATUS_MAP[Number(result[1])] ?? "PENDING",
          },
          update: {
            amount: result[0].toString(),
            status: MILESTONE_STATUS_MAP[Number(result[1])] ?? "PENDING",
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

async function findEscrowCreatedLog(
  factoryAddress: `0x${string}`,
  escrowAddress: `0x${string}`,
) {
  const logs = await backfillClient.getLogs({
    address: factoryAddress,
    event: escrowCreatedEvent,
    args: { escrow: escrowAddress },
    fromBlock: FACTORY_DEPLOY_BLOCK,
    toBlock: "latest",
  });

  return logs.at(-1) ?? null;
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

  const creationLog = await findEscrowCreatedLog(factoryAddress, escrowAddress);
  if (creationLog?.args) {
    await seedEscrowFromCreationLog(
      { args: creationLog.args as EscrowCreatedArgs, transactionHash: creationLog.transactionHash },
      {
        claimMetadata: false,
        notify: false,
        context: "self-heal",
        milestoneReadClient: backfillClient,
      },
    );
    console.log(`[sync] self-seeded missing escrow from EscrowCreated log: ${escrowAddress}`);
    return true;
  }

  const [buyer, seller, token, totalAmount, milestoneCount] = await Promise.all([
    backfillClient.readContract({ address: escrowAddress, abi: escrowReadAbi, functionName: "BUYER" }),
    backfillClient.readContract({ address: escrowAddress, abi: escrowReadAbi, functionName: "SELLER" }),
    backfillClient.readContract({ address: escrowAddress, abi: escrowReadAbi, functionName: "TOKEN" }),
    backfillClient.readContract({ address: escrowAddress, abi: escrowReadAbi, functionName: "totalAmount" }),
    backfillClient.readContract({ address: escrowAddress, abi: escrowReadAbi, functionName: "milestoneCount" }),
  ]);

  const count = Number(milestoneCount);
  const milestoneResults = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      backfillClient.readContract({
        address: escrowAddress,
        abi: escrowReadAbi,
        functionName: "milestones",
        args: [BigInt(index)],
      })
    ),
  );

  await seedEscrow({
    escrowAddress,
    buyer: getAddress(buyer as string),
    seller: getAddress(seller as string),
    token: getAddress(token as string),
    totalAmount: (totalAmount as bigint).toString(),
    milestoneCount: count,
    metadataHash: null,
    title: null,
    description: null,
    txHash: null,
    milestoneAmounts: milestoneResults.map((result) => result[0].toString()),
  });

  knownEscrows.add(escrowAddress.toLowerCase());
  console.log(`[sync] self-seeded missing escrow from direct chain reads: ${escrowAddress}`);
  return true;
}

async function sweepEscrowCreatedGap(
  factoryAddress: `0x${string}`,
  fromBlock: bigint,
  startToken: number,
) {
  console.log(`[listener] sweeping EscrowCreated gap from block ${fromBlock.toString()}`);

  const logs = await backfillClient.getLogs({
    address: factoryAddress,
    event: escrowCreatedEvent,
    fromBlock,
    toBlock: "latest",
  });

  console.log(`[listener] EscrowCreated gap sweep found ${logs.length} logs`);

  for (const log of logs) {
    if (shouldAbortStartup(startToken)) {
      console.warn("[listener] startup gap sweep aborted by restart request");
      return;
    }

    await seedEscrowFromCreationLog(
      { args: log.args as EscrowCreatedArgs, transactionHash: log.transactionHash },
      {
        claimMetadata: false,
        notify: false,
        context: "gap-sweep",
        milestoneReadClient: backfillClient,
      },
    );
  }
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

      const startupBlock = await backfillClient.getBlockNumber();

      if (shouldAbortStartup(startToken)) return;

  // ── BACKFILL: fetch historical EscrowCreated events if DB is empty ──

  // ── CATCH-UP: sync on-chain state for escrows that may have changed while backend was down ──

  // ── WATCHER 1: EscrowCreated (factory) ──
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
            await prisma.milestone.upsert({
              where: { escrowAddress_milestoneIndex: { escrowAddress: args.escrow, milestoneIndex: i } },
              create: {
                escrowAddress: args.escrow,
                milestoneIndex: i,
                amount: result[0].toString(),
                status: MILESTONE_STATUS_MAP[Number(result[1])] ?? "PENDING",
              },
              update: {},
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

  // ── WATCHER 2: Funded (all escrows, single global watcher) ──
      registerWatcher("Funded", (onError) => client.watchEvent({
    event: fundedEvent,
    onError,
    onLogs: async (logs) => {
      for (const log of logs) {
        const escrowAddress = getAddress(log.address);
        if (!knownEscrows.has(escrowAddress.toLowerCase())) continue;

        try {
          const { args } = decodeEventLog({ abi: [fundedEvent], data: log.data, topics: log.topics });
          const { buyer, amount } = args as { buyer: `0x${string}`; amount: bigint };

          console.log("[Funded]", {
            escrow: escrowAddress,
            buyer,
            amount: amount.toString(),
            txHash: log.transactionHash,
          });

          const fundedDate = await blockDate(client, log.blockNumber);
          await prisma.escrow.update({
            where: { id: escrowAddress },
            data: { status: "FUNDED", fundedTxHash: log.transactionHash, fundedAt: fundedDate },
          });
          void sendNotification("PROJECT_FUNDED", escrowAddress);
        } catch (err) {
          console.error("[listener] Funded DB update failed", err);
        }
      }
    },
  }));

  // ── WATCHER 3: MilestoneSubmitted (all escrows) ──
      registerWatcher("MilestoneSubmitted", (onError) => client.watchEvent({
    event: milestoneSubmittedEvent,
    onError,
    onLogs: async (logs) => {
      for (const log of logs) {
        const escrowAddress = getAddress(log.address);
        if (!knownEscrows.has(escrowAddress.toLowerCase())) continue;

        try {
          const { args } = decodeEventLog({ abi: [milestoneSubmittedEvent], data: log.data, topics: log.topics });
          const { milestoneIndex } = args as { milestoneIndex: bigint; deliveryHash: `0x${string}` };

          console.log("[MilestoneSubmitted]", {
            escrow: escrowAddress,
            milestoneIndex: Number(milestoneIndex),
          });

          const submittedDate = await blockDate(client, log.blockNumber);
          await prisma.milestone.update({
            where: { escrowAddress_milestoneIndex: { escrowAddress, milestoneIndex: Number(milestoneIndex) } },
            data: { status: "SUBMITTED", submittedAt: submittedDate },
          });
          void sendNotification("MILESTONE_SUBMITTED", escrowAddress);
        } catch (err) {
          console.error("[listener] MilestoneSubmitted DB update failed", err);
        }
      }
    },
  }));

  // ── WATCHER 4: MilestoneApproved (all escrows) ──
      registerWatcher("MilestoneApproved", (onError) => client.watchEvent({
    event: milestoneApprovedEvent,
    onError,
    onLogs: async (logs) => {
      for (const log of logs) {
        const escrowAddress = getAddress(log.address);
        if (!knownEscrows.has(escrowAddress.toLowerCase())) continue;

        try {
          const { args } = decodeEventLog({ abi: [milestoneApprovedEvent], data: log.data, topics: log.topics });
          const { milestoneIndex } = args as { milestoneIndex: bigint };

          console.log("[MilestoneApproved]", { escrow: escrowAddress, milestoneIndex: Number(milestoneIndex) });

          const approvedDate = await blockDate(client, log.blockNumber);
          await prisma.milestone.update({
            where: { escrowAddress_milestoneIndex: { escrowAddress, milestoneIndex: Number(milestoneIndex) } },
            data: { status: "PAID", paidAt: approvedDate },
          });
          void sendNotification("MILESTONE_APPROVED", escrowAddress);
        } catch (err) {
          console.error("[listener] MilestoneApproved DB update failed", err);
        }
      }
    },
  }));

  // ── WATCHER 5: MilestoneAutoApproved (all escrows) ──
      registerWatcher("MilestoneAutoApproved", (onError) => client.watchEvent({
    event: milestoneAutoApprovedEvent,
    onError,
    onLogs: async (logs) => {
      for (const log of logs) {
        const escrowAddress = getAddress(log.address);
        if (!knownEscrows.has(escrowAddress.toLowerCase())) continue;

        try {
          const { args } = decodeEventLog({ abi: [milestoneAutoApprovedEvent], data: log.data, topics: log.topics });
          const { milestoneIndex } = args as { milestoneIndex: bigint };

          console.log("[MilestoneAutoApproved]", { escrow: escrowAddress, milestoneIndex: Number(milestoneIndex) });

          const autoApprovedDate = await blockDate(client, log.blockNumber);
          await prisma.milestone.update({
            where: { escrowAddress_milestoneIndex: { escrowAddress, milestoneIndex: Number(milestoneIndex) } },
            data: { status: "PAID", paidAt: autoApprovedDate },
          });
          void sendNotification("MILESTONE_APPROVED", escrowAddress);
        } catch (err) {
          console.error("[listener] MilestoneAutoApproved DB update failed", err);
        }
      }
    },
  }));

  // ── WATCHER 6: EscrowCancelled (all escrows) ──
      registerWatcher("EscrowCancelled", (onError) => client.watchEvent({
    event: escrowCancelledEvent,
    onError,
    onLogs: async (logs) => {
      for (const log of logs) {
        const escrowAddress = getAddress(log.address);
        if (!knownEscrows.has(escrowAddress.toLowerCase())) continue;

        console.log("[EscrowCancelled]", { escrow: escrowAddress });

        try {
          const cancelledAt = await blockDate(client, log.blockNumber);
          await prisma.escrow.update({
            where: { id: escrowAddress },
            data: { status: "CANCELLED", cancelledAt },
          });
        } catch (err) {
          console.error("[listener] EscrowCancelled DB update failed", err);
        }
      }
    },
  }));

  // ── WATCHER 7: MilestoneRefunded (all escrows) ──
      registerWatcher("MilestoneRefunded", (onError) => client.watchEvent({
    event: milestoneRefundedEvent,
    onError,
    onLogs: async (logs) => {
      for (const log of logs) {
        const escrowAddress = getAddress(log.address);
        if (!knownEscrows.has(escrowAddress.toLowerCase())) continue;

        try {
          const { args } = decodeEventLog({ abi: [milestoneRefundedEvent], data: log.data, topics: log.topics });
          const { milestoneIndex } = args as { milestoneIndex: bigint; amount: bigint };

          console.log("[MilestoneRefunded]", { escrow: escrowAddress, milestoneIndex: Number(milestoneIndex) });

          await prisma.milestone.update({
            where: { escrowAddress_milestoneIndex: { escrowAddress, milestoneIndex: Number(milestoneIndex) } },
            data: { status: "REFUNDED" },
          });
        } catch (err) {
          console.error("[listener] MilestoneRefunded DB update failed", err);
        }
      }
    },
  }));

  // ── WATCHER 8: DisputeOpened (all escrows) ──
      registerWatcher("DisputeOpened", (onError) => client.watchEvent({
    event: disputeOpenedEvent,
    onError,
    onLogs: async (logs) => {
      for (const log of logs) {
        const escrowAddress = getAddress(log.address);
        if (!knownEscrows.has(escrowAddress.toLowerCase())) continue;

        try {
          const { args } = decodeEventLog({ abi: [disputeOpenedEvent], data: log.data, topics: log.topics });
          const { milestoneIndex, openedBy } = args as { milestoneIndex: bigint; openedBy: `0x${string}`; reason: `0x${string}` };

          console.log("[DisputeOpened]", { escrow: escrowAddress, milestoneIndex: Number(milestoneIndex), openedBy });

          const disputeDate = await blockDate(client, log.blockNumber);
          await prisma.milestone.update({
            where: { escrowAddress_milestoneIndex: { escrowAddress, milestoneIndex: Number(milestoneIndex) } },
            data: {
              status: "DISPUTED",
              disputeOpenedAt: disputeDate,
              disputeOpenedBy: getAddress(openedBy),
            },
          });
          void sendNotification("DISPUTE_OPENED", escrowAddress);
        } catch (err) {
          console.error("[listener] DisputeOpened DB update failed", err);
        }
      }
    },
  }));

  // ── WATCHER 9: MilestoneResubmitted (all escrows) ──
      registerWatcher("MilestoneResubmitted", (onError) => client.watchEvent({
    event: milestoneResubmittedEvent,
    onError,
    onLogs: async (logs) => {
      for (const log of logs) {
        const escrowAddress = getAddress(log.address);
        if (!knownEscrows.has(escrowAddress.toLowerCase())) continue;

        try {
          const { args } = decodeEventLog({ abi: [milestoneResubmittedEvent], data: log.data, topics: log.topics });
          const { milestoneIndex } = args as { milestoneIndex: bigint; deliveryHash: `0x${string}` };

          console.log("[MilestoneResubmitted]", { escrow: escrowAddress, milestoneIndex: Number(milestoneIndex) });

          await prisma.milestone.update({
            where: { escrowAddress_milestoneIndex: { escrowAddress, milestoneIndex: Number(milestoneIndex) } },
            data: { status: "SUBMITTED" },
          });
        } catch (err) {
          console.error("[listener] MilestoneResubmitted DB update failed", err);
        }
      }
    },
  }));

  // ── WATCHER 10: DisputeResolved (all escrows) ──
      registerWatcher("DisputeResolved", (onError) => client.watchEvent({
    event: disputeResolvedEvent,
    onError,
    onLogs: async (logs) => {
      for (const log of logs) {
        const escrowAddress = getAddress(log.address);
        if (!knownEscrows.has(escrowAddress.toLowerCase())) continue;

        try {
          const { args } = decodeEventLog({ abi: [disputeResolvedEvent], data: log.data, topics: log.topics });
          const { milestoneIndex, sellerAward, buyerAward } = args as { milestoneIndex: bigint; sellerAward: bigint; buyerAward: bigint; platformFee: bigint; disputeFee: bigint };

          // Mirror the contract logic: PAID = seller got all, REFUNDED = buyer got all, RESOLVED = split
          const resolvedStatus = buyerAward === 0n ? "PAID" : sellerAward === 0n ? "REFUNDED" : "RESOLVED";

          console.log("[DisputeResolved]", { escrow: escrowAddress, milestoneIndex: Number(milestoneIndex), sellerAward: sellerAward.toString(), buyerAward: buyerAward.toString(), resolvedStatus });

          const resolvedDate = await blockDate(client, log.blockNumber);
          await prisma.milestone.update({
            where: { escrowAddress_milestoneIndex: { escrowAddress, milestoneIndex: Number(milestoneIndex) } },
            data: { status: resolvedStatus, paidAt: resolvedDate, sellerAward: sellerAward.toString(), buyerAward: buyerAward.toString() },
          });
          void sendNotification("DISPUTE_RESOLVED", escrowAddress);
        } catch (err) {
          console.error("[listener] DisputeResolved DB update failed", err);
        }
      }
    },
  }));

  // ── WATCHER 11: DisputeTimeoutClaimed (all escrows) ──
      registerWatcher("DisputeTimeoutClaimed", (onError) => client.watchEvent({
    event: disputeTimeoutClaimedEvent,
    onError,
    onLogs: async (logs) => {
      for (const log of logs) {
        const escrowAddress = getAddress(log.address);
        if (!knownEscrows.has(escrowAddress.toLowerCase())) continue;

        try {
          const { args } = decodeEventLog({ abi: [disputeTimeoutClaimedEvent], data: log.data, topics: log.topics });
          const { milestoneIndex, buyerRefund } = args as { milestoneIndex: bigint; buyerRefund: bigint; disputeFee: bigint };

          console.log("[DisputeTimeoutClaimed]", { escrow: escrowAddress, milestoneIndex: Number(milestoneIndex) });

          const timeoutDate = await blockDate(client, log.blockNumber);
          await prisma.milestone.update({
            where: { escrowAddress_milestoneIndex: { escrowAddress, milestoneIndex: Number(milestoneIndex) } },
            data: {
              status: "REFUNDED",
              paidAt: timeoutDate,
              sellerAward: "0",
              buyerAward: buyerRefund.toString(),
            },
          });
        } catch (err) {
          console.error("[listener] DisputeTimeoutClaimed DB update failed", err);
        }
      }
    },
  }));

  // ── WATCHER 12: ProjectAccepted (all escrows) ──
      registerWatcher("ProjectAccepted", (onError) => client.watchEvent({
    event: projectAcceptedEvent,
    onError,
    onLogs: async (logs) => {
      for (const log of logs) {
        const escrowAddress = getAddress(log.address);
        if (!knownEscrows.has(escrowAddress.toLowerCase())) continue;

        try {
          const { args } = decodeEventLog({ abi: [projectAcceptedEvent], data: log.data, topics: log.topics });
          const { seller } = args as { seller: `0x${string}` };

          console.log("[ProjectAccepted]", { escrow: escrowAddress, seller });

          await prisma.escrow.update({
            where: { id: escrowAddress },
            data: { status: "SELLER_ACCEPTED" },
          });
        } catch (err) {
          console.error("[listener] ProjectAccepted DB update failed", err);
        }
      }
    },
  }));

  // ── WATCHER 13: ProjectRejected (all escrows) ──
      registerWatcher("ProjectRejected", (onError) => client.watchEvent({
    event: projectRejectedEvent,
    onError,
    onLogs: async (logs) => {
      for (const log of logs) {
        const escrowAddress = getAddress(log.address);
        if (!knownEscrows.has(escrowAddress.toLowerCase())) continue;

        try {
          const { args } = decodeEventLog({ abi: [projectRejectedEvent], data: log.data, topics: log.topics });
          const { seller } = args as { seller: `0x${string}` };

          console.log("[ProjectRejected]", { escrow: escrowAddress, seller });

          const cancelledAt = await blockDate(client, log.blockNumber);
          await prisma.escrow.update({
            where: { id: escrowAddress },
            data: { status: "SELLER_REJECTED", cancelledAt },
          });
        } catch (err) {
          console.error("[listener] ProjectRejected DB update failed", err);
        }
      }
    },
  }));

  // ── WATCHER 14: DisputeEscalated (all escrows) ──
      registerWatcher("DisputeEscalated", (onError) => client.watchEvent({
    event: disputeEscalatedEvent,
    onError,
    onLogs: async (logs) => {
      for (const log of logs) {
        const escrowAddress = getAddress(log.address);
        if (!knownEscrows.has(escrowAddress.toLowerCase())) continue;

        try {
          const { args } = decodeEventLog({ abi: [disputeEscalatedEvent], data: log.data, topics: log.topics });
          const { milestoneIndex } = args as { milestoneIndex: bigint; reason: `0x${string}` };

          console.log("[DisputeEscalated]", { escrow: escrowAddress, milestoneIndex: Number(milestoneIndex) });

          const [escalatedAt, seller] = await Promise.all([
            blockDate(client, log.blockNumber),
            client.readContract({
              address: escrowAddress,
              abi: escrowReadAbi,
              functionName: "SELLER",
            }),
          ]);

          await prisma.milestone.update({
            where: { escrowAddress_milestoneIndex: { escrowAddress, milestoneIndex: Number(milestoneIndex) } },
            data: {
              status: "ESCALATED",
              isEscalated: true,
              disputeEscalatedAt: escalatedAt,
              disputeEscalatedBy: getAddress(seller as string),
            },
          });
          void sendNotification("DISPUTE_ESCALATED", escrowAddress);
        } catch (err) {
          console.error("[listener] DisputeEscalated DB update failed", err);
        }
      }
    },
  }));

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

      await sweepEscrowCreatedGap(factoryAddress, startupBlock, startToken);
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
 * Fetch all historical EscrowCreated events from the factory contract and seed the DB.
 * Always runs on startup to catch any escrows missed while the backend was down.
 */
async function backfillFromHistory(factoryAddress: `0x${string}`, startToken: number) {
  console.log("[backfill] Fetching historical EscrowCreated events...");

  try {
    const latestBlock = await backfillClient.getBlockNumber();

    const allLogs = [];
    for (let start = FACTORY_DEPLOY_BLOCK; start <= latestBlock; start += LOG_CHUNK_SIZE) {
      if (shouldAbortStartup(startToken)) {
        console.warn("[backfill] aborted by restart request");
        return;
      }

      const end = start + LOG_CHUNK_SIZE - 1n < latestBlock ? start + LOG_CHUNK_SIZE - 1n : latestBlock;
      // Without the retry a single 429 would throw all the way out to the catch
      // below, skipping the rest of the chunks and seeding nothing that run.
      const chunk = await withRateLimitRetry(
        () =>
          backfillClient.getLogs({
            address: factoryAddress,
            event: escrowCreatedEvent,
            fromBlock: start,
            toBlock: end,
          }),
        `backfill ${start}-${end}`,
      );
      allLogs.push(...chunk);
    }

    const logs = allLogs;
    console.log(`[backfill] found ${logs.length} historical EscrowCreated events`);

    let skipped = 0;

    for (const log of logs) {
      if (shouldAbortStartup(startToken)) {
        console.warn("[backfill] aborted by restart request");
        return;
      }

      const escrowAddress = (log.args as EscrowCreatedArgs).escrow;

      // Already in the DB — catchUpOnChainState() resyncs it right after this
      // function returns, so re-seeding here (with its per-milestone RPC reads)
      // would just repeat work on every restart for no benefit.
      if (knownEscrows.has(escrowAddress.toLowerCase())) {
        skipped++;
        continue;
      }

      await seedEscrowFromCreationLog(
        { args: log.args as EscrowCreatedArgs, transactionHash: log.transactionHash },
        {
          claimMetadata: false,
          notify: false,
          context: "backfill",
          milestoneReadClient: backfillClient,
        },
      );

      console.log(`[backfill] seeded ${escrowAddress}`);
    }

    if (skipped > 0) {
      console.log(`[backfill] skipped ${skipped} already-known escrows (resynced by catch-up instead)`);
    }

    console.log("[backfill] done");
  } catch (err) {
    console.error("[backfill] failed to fetch historical events", err);
  }
}

/**
 * On startup, read on-chain state for every escrow that isn't in a terminal state
 * (CANCELLED) and sync the DB. This catches any events missed while the backend was down.
 */
/**
 * Sync a list of escrows with on-chain state.
 * Called by the API before returning project lists.
 */
/**
 * Sync a single escrow + its milestones with on-chain state.
 * Called lazily by the events endpoint so timeline is always up-to-date,
 * even if the real-time watchers missed events.
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
    // Use public RPC for sync reads to avoid Alchemy rate limits
    const syncClient = backfillClient;

    let sellerAccepted = false;
    try {
      sellerAccepted = await syncClient.readContract({ address, abi: escrowReadAbi, functionName: "sellerAccepted" }) as boolean;
    } catch (e) {
      console.warn(`[sync] sellerAccepted read failed for ${address}:`, (e as Error).message?.slice(0, 100));
    }

    const [funded, cancelled, milestoneCount, correctionWindowDays, autoApprovalDays, disputeTimeoutDays] = await Promise.all([
      syncClient.readContract({ address, abi: escrowReadAbi, functionName: "funded" }),
      syncClient.readContract({ address, abi: escrowReadAbi, functionName: "cancelled" }),
      syncClient.readContract({ address, abi: escrowReadAbi, functionName: "milestoneCount" }),
      syncClient.readContract({ address, abi: escrowReadAbi, functionName: "CORRECTION_WINDOW_DAYS" }).catch(() => null),
      syncClient.readContract({ address, abi: escrowReadAbi, functionName: "AUTO_APPROVAL_DAYS" }).catch(() => null),
      syncClient.readContract({ address, abi: escrowReadAbi, functionName: "DISPUTE_TIMEOUT_DAYS" }).catch(() => null),
    ]) as [boolean, boolean, bigint, bigint | null, bigint | null, bigint | null];

    const onChainStatus = cancelled ? "CANCELLED" : (funded as boolean) ? "FUNDED" : sellerAccepted ? "SELLER_ACCEPTED" : "CREATED";

    // Build update payload
    const updateData: Record<string, unknown> = {};

    // Status change
    if (escrow.status !== onChainStatus) {
      updateData.status = onChainStatus;
    }

    // Sync per-escrow timer values from contract
    if (correctionWindowDays != null && escrow.correctionWindowDays !== Number(correctionWindowDays)) {
      updateData.correctionWindowDays = Number(correctionWindowDays);
    }
    if (autoApprovalDays != null && escrow.autoApprovalDays !== Number(autoApprovalDays)) {
      updateData.autoApprovalDays = Number(autoApprovalDays);
    }
    if (disputeTimeoutDays != null && escrow.disputeTimeoutDays !== Number(disputeTimeoutDays)) {
      updateData.disputeTimeoutDays = Number(disputeTimeoutDays);
    }

    if ((cancelled as boolean) && !escrow.cancelledAt) {
      const cancelledAt = await readCancelledAt(syncClient, address);
      if (cancelledAt) updateData.cancelledAt = cancelledAt;
    }

    // Repair fundedAt if missing
    if (onChainStatus === "FUNDED" && !escrow.fundedAt) {
      let fundedAt: Date = new Date();
      try {
        const logs = await syncClient.getLogs({ address, event: fundedEvent, fromBlock: "earliest", toBlock: "latest" });
        if (logs.length > 0 && logs[0].blockNumber != null) {
          fundedAt = await blockDate(syncClient, logs[0].blockNumber);
        }
      } catch { /* fall back to now */ }
      updateData.fundedAt = fundedAt;
    }

    // Repair sellerAcceptedAt if seller has accepted but timestamp is missing
    if (["SELLER_ACCEPTED", "FUNDED"].includes(onChainStatus) && !escrow.sellerAcceptedAt) {
      updateData.sellerAcceptedAt = new Date();
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.escrow.update({ where: { id: escrow.id }, data: updateData });
      console.log(`[sync] ${address}: updated`, Object.keys(updateData));
    }

    // Sync milestone statuses + timestamps
    const count = Number(milestoneCount);
    for (let i = 0; i < count; i++) {
      let result: readonly [bigint, number, string, bigint, string, bigint, string];
      try {
        result = await syncClient.readContract({
          address,
          abi: escrowReadAbi,
          functionName: "milestones",
          args: [BigInt(i)],
        }) as readonly [bigint, number, string, bigint, string, bigint, string];
      } catch (msErr) {
        console.error(`[sync] milestone ${i} read failed for ${address}:`, (msErr as Error).message?.slice(0, 120));
        continue;
      }
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
      } else {
        const needsStatusUpdate = dbMilestone.status !== onChainMilestoneStatus;
        const needsSubmittedAt = !dbMilestone.submittedAt && submittedAtDate;
        const needsDisputeAt = !dbMilestone.disputeOpenedAt && disputeOpenedAtDate;
        const needsPaidAt = !dbMilestone.paidAt && ["PAID", "RESOLVED", "REFUNDED"].includes(onChainMilestoneStatus);
        const needsAwardBackfill = (!dbMilestone.sellerAward || !dbMilestone.buyerAward)
          && ["PAID", "REFUNDED", "RESOLVED"].includes(onChainMilestoneStatus)
          && (dbMilestone.isEscalated || dbMilestone.disputeOpenedAt != null);

        let sellerAwardValue: string | undefined;
        let buyerAwardValue: string | undefined;
        let correctedStatus: MilestoneStatus | undefined;
        if (needsAwardBackfill) {
          try {
            const allDisputeLogs = await getLogsInChunks(backfillClient, escrow.id as `0x${string}`, disputeResolvedEvent);
            const match = allDisputeLogs.find((l) => {
              const { args } = decodeEventLog({ abi: [disputeResolvedEvent], data: l.data, topics: l.topics });
              return Number((args as { milestoneIndex: bigint }).milestoneIndex) === i;
            });
            if (match) {
              const { args } = decodeEventLog({ abi: [disputeResolvedEvent], data: match.data, topics: match.topics });
              const sa = (args as { sellerAward: bigint }).sellerAward;
              const ba = (args as { buyerAward: bigint }).buyerAward;
              sellerAwardValue = sa.toString();
              buyerAwardValue = ba.toString();
              correctedStatus = ba === 0n ? "PAID" : sa === 0n ? "REFUNDED" : "RESOLVED";
              console.log(`[sync] backfilled awards for ${escrow.id} milestone ${i}: seller=${sellerAwardValue}, buyer=${buyerAwardValue}, status=${correctedStatus}`);
            } else {
              console.warn(`[sync] no DisputeResolved log found for ${escrow.id} milestone ${i}`);
            }
          } catch (err) {
            console.error(`[sync] award backfill failed for ${escrow.id} milestone ${i}:`, err);
          }
        }

        const needsStatusCorrection = correctedStatus && dbMilestone.status !== correctedStatus;

        if (needsStatusUpdate || needsSubmittedAt || needsDisputeAt || needsPaidAt || needsAwardBackfill || needsStatusCorrection) {
          await prisma.milestone.update({
            where: { escrowAddress_milestoneIndex: { escrowAddress: escrow.id, milestoneIndex: i } },
            data: {
              ...(needsStatusUpdate && !needsStatusCorrection ? { status: onChainMilestoneStatus } : {}),
              ...(needsStatusCorrection ? { status: correctedStatus } : {}),
              ...(needsSubmittedAt ? { submittedAt: submittedAtDate } : {}),
              ...(needsPaidAt ? { paidAt: new Date() } : {}),
              ...(needsDisputeAt
                ? { disputeOpenedAt: disputeOpenedAtDate, disputeOpenedBy: getAddress(result[6] as `0x${string}`) }
                : {}),
              ...(sellerAwardValue ? { sellerAward: sellerAwardValue } : {}),
              ...(buyerAwardValue ? { buyerAward: buyerAwardValue } : {}),
            },
          });
        }
      }
    }
  } catch (err) {
    console.error(`[sync] FAILED for ${address}:`, err);
  }
}

async function catchUpOnChainState(startToken: number) {
  const escrows = await prisma.escrow.findMany({
    where: { status: { not: "CANCELLED" } },
    include: { milestones: true },
  });

  if (escrows.length === 0) return;
  console.log(`[catch-up] syncing ${escrows.length} escrows with on-chain state...`);

  const processEscrow = async (escrow: (typeof escrows)[number]) => {
    const address = escrow.id as `0x${string}`;
    try {
      // Use public RPC for bulk catch-up to avoid Alchemy rate limits
      let sellerAccepted = false;
      try {
        sellerAccepted = await backfillClient.readContract({ address, abi: escrowReadAbi, functionName: "sellerAccepted" }) as boolean;
      } catch {
        // Old contract deployed before acceptProject() was added
      }

      const [funded, cancelled, milestoneCount, correctionWindowDays, autoApprovalDays, disputeTimeoutDays] = await Promise.all([
        backfillClient.readContract({ address, abi: escrowReadAbi, functionName: "funded" }),
        backfillClient.readContract({ address, abi: escrowReadAbi, functionName: "cancelled" }),
        backfillClient.readContract({ address, abi: escrowReadAbi, functionName: "milestoneCount" }),
        backfillClient.readContract({ address, abi: escrowReadAbi, functionName: "CORRECTION_WINDOW_DAYS" }).catch(() => null),
        backfillClient.readContract({ address, abi: escrowReadAbi, functionName: "AUTO_APPROVAL_DAYS" }).catch(() => null),
        backfillClient.readContract({ address, abi: escrowReadAbi, functionName: "DISPUTE_TIMEOUT_DAYS" }).catch(() => null),
      ]) as [unknown, unknown, unknown, bigint | null, bigint | null, bigint | null];

      // Sync escrow status
      const onChainStatus = cancelled ? "CANCELLED" : funded ? "FUNDED" : sellerAccepted ? "SELLER_ACCEPTED" : "CREATED";

      // Build update payload
      const updateData: Record<string, unknown> = {};

      if (escrow.status !== onChainStatus) {
        updateData.status = onChainStatus;
      }

      // Sync per-escrow timer values from contract
      if (correctionWindowDays != null && escrow.correctionWindowDays !== Number(correctionWindowDays)) {
        updateData.correctionWindowDays = Number(correctionWindowDays);
      }
      if (autoApprovalDays != null && escrow.autoApprovalDays !== Number(autoApprovalDays)) {
        updateData.autoApprovalDays = Number(autoApprovalDays);
      }
      if (disputeTimeoutDays != null && escrow.disputeTimeoutDays !== Number(disputeTimeoutDays)) {
        updateData.disputeTimeoutDays = Number(disputeTimeoutDays);
      }

      if (onChainStatus === "FUNDED" && !escrow.fundedAt) {
        let fundedAt: Date = new Date();
        try {
          const logs = await backfillClient.getLogs({ address, event: fundedEvent, fromBlock: "earliest", toBlock: "latest" });
          if (logs.length > 0 && logs[0].blockNumber != null) {
            fundedAt = await blockDate(backfillClient, logs[0].blockNumber);
          }
        } catch { /* fall back to now */ }
        updateData.fundedAt = fundedAt;
      }

      if (["SELLER_ACCEPTED", "FUNDED"].includes(onChainStatus) && !escrow.sellerAcceptedAt) {
        updateData.sellerAcceptedAt = new Date();
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.escrow.update({ where: { id: address }, data: updateData });
        console.log(`[catch-up] ${address}: updated`, Object.keys(updateData));
      }

      // Sync milestone statuses
      const count = Number(milestoneCount);
      for (let i = 0; i < count; i++) {
        if (shouldAbortStartup(startToken)) {
          console.warn(`[catch-up] ${address} sync stopped mid-escrow by restart request`);
          return;
        }

        const result = await backfillClient.readContract({
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
              escrowAddress: address,
              milestoneIndex: i,
              amount: result[0].toString(),
              status: rawOnChainStatus,
              ...(submittedAtDate ? { submittedAt: submittedAtDate } : {}),
              ...(disputeOpenedAtDate
                ? { disputeOpenedAt: disputeOpenedAtDate, disputeOpenedBy: getAddress(result[6] as `0x${string}`) }
                : {}),
            },
          });
          console.log(`[catch-up] ${address} milestone ${i}: created with status ${rawOnChainStatus}`);
        } else {
          const needsStatusUpdate = dbMilestone.status !== onChainMilestoneStatus;
          const needsSubmittedAt = !dbMilestone.submittedAt && submittedAtDate;
          const needsDisputeAt = !dbMilestone.disputeOpenedAt && disputeOpenedAtDate;
          const needsPaidAt = !dbMilestone.paidAt && ["PAID", "RESOLVED", "REFUNDED"].includes(onChainMilestoneStatus);
          const needsAwardBackfill = (!dbMilestone.sellerAward || !dbMilestone.buyerAward)
            && ["PAID", "REFUNDED", "RESOLVED"].includes(onChainMilestoneStatus)
            && (dbMilestone.isEscalated || dbMilestone.disputeOpenedAt != null);

          let sellerAwardValue: string | undefined;
          let buyerAwardValue: string | undefined;
          let correctedStatus: MilestoneStatus | undefined;
          if (needsAwardBackfill) {
            try {
              const allDisputeLogs = await getLogsInChunks(backfillClient, address, disputeResolvedEvent);
              const match = allDisputeLogs.find((l) => {
                const { args } = decodeEventLog({ abi: [disputeResolvedEvent], data: l.data, topics: l.topics });
                return Number((args as { milestoneIndex: bigint }).milestoneIndex) === i;
              });
              if (match) {
                const { args } = decodeEventLog({ abi: [disputeResolvedEvent], data: match.data, topics: match.topics });
                const sa = (args as { sellerAward: bigint }).sellerAward;
                const ba = (args as { buyerAward: bigint }).buyerAward;
                sellerAwardValue = sa.toString();
                buyerAwardValue = ba.toString();
                correctedStatus = ba === 0n ? "PAID" : sa === 0n ? "REFUNDED" : "RESOLVED";
                console.log(`[catch-up] backfilled awards for ${address} milestone ${i}: seller=${sellerAwardValue}, buyer=${buyerAwardValue}, status=${correctedStatus}`);
              }
            } catch (err) {
              console.error(`[catch-up] award backfill failed for ${address} milestone ${i}:`, err);
            }
          }

          const needsStatusCorrection = correctedStatus && dbMilestone.status !== correctedStatus;

          if (needsStatusUpdate || needsSubmittedAt || needsDisputeAt || needsPaidAt || needsAwardBackfill || needsStatusCorrection) {
            await prisma.milestone.update({
              where: { escrowAddress_milestoneIndex: { escrowAddress: address, milestoneIndex: i } },
              data: {
                ...(needsStatusUpdate && !needsStatusCorrection ? { status: onChainMilestoneStatus } : {}),
                ...(needsStatusCorrection ? { status: correctedStatus } : {}),
                ...(needsSubmittedAt ? { submittedAt: submittedAtDate } : {}),
                ...(needsPaidAt ? { paidAt: new Date() } : {}),
                ...(needsDisputeAt
                  ? { disputeOpenedAt: disputeOpenedAtDate, disputeOpenedBy: getAddress(result[6] as `0x${string}`) }
                  : {}),
                ...(sellerAwardValue ? { sellerAward: sellerAwardValue } : {}),
                ...(buyerAwardValue ? { buyerAward: buyerAwardValue } : {}),
              },
            });
            if (needsStatusUpdate) console.log(`[catch-up] ${address} milestone ${i}: ${dbMilestone.status} → ${needsStatusCorrection ? correctedStatus : onChainMilestoneStatus}`);
            if (needsSubmittedAt) console.log(`[catch-up] ${address} milestone ${i}: repaired submittedAt`);
            if (needsDisputeAt) console.log(`[catch-up] ${address} milestone ${i}: repaired disputeOpenedAt`);
          }
        }
      }
    } catch (err) {
      // Let the batch-level retry handle transient public-RPC rate limits.
      if (isRateLimitError(err)) throw err;
      console.error(`[catch-up] failed for ${address}`, err);
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
