import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { MilestoneStatus } from "../../generated/prisma/enums";
import type { disputeResolvedEvent } from "../abi/events";

export const MILESTONE_STATUS_MAP: Record<number, MilestoneStatus> = {
  0: MilestoneStatus.PENDING,
  1: MilestoneStatus.SUBMITTED,
  2: MilestoneStatus.DISPUTED,
  3: MilestoneStatus.PAID,
  4: MilestoneStatus.REFUNDED,
  5: MilestoneStatus.RESOLVED,
};

export const client = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL),
  pollingInterval: 2_000,
});

// Separate client for backfill — uses public RPC with no block-range restrictions
export const backfillClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL_FALLBACK),
});

const FACTORY_DEPLOY_BLOCK = BigInt(process.env.FACTORY_DEPLOY_BLOCK ?? "51429061");
const LOG_CHUNK_SIZE = 9_500n;
// How many escrows catchUpOnChainState() syncs at once against the public RPC.
// Higher = faster startup but bigger request bursts against the free/public RPC.
export const CATCH_UP_CONCURRENCY = 5;
// Pause between catch-up batches to give the free public RPC room to breathe.
export const CATCH_UP_BATCH_DELAY_MS = Number(process.env.CATCH_UP_BATCH_DELAY_MS ?? "500");

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The free public RPC (RPC_URL_FALLBACK) returns HTTP 429 / JSON-RPC -32016
 * ("over rate limit") under load. viem wraps these several causes deep, so walk
 * the whole error chain looking for the tell-tale status/message.
 */
export function isRateLimitError(err: unknown): boolean {
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
export async function withRateLimitRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 5): Promise<T> {
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

export async function getLogsInChunks(
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

/** Convert a log's block timestamp to a JS Date (falls back to now if fetch fails). */
export async function blockDate(blockClient: typeof client, blockNumber: bigint | null | undefined): Promise<Date> {
  if (!blockNumber) return new Date();
  try {
    const block = await blockClient.getBlock({ blockNumber });
    return new Date(Number(block.timestamp) * 1000);
  } catch {
    return new Date();
  }
}

/** The DB key of one milestone. */
export function milestoneKey(escrowAddress: string, milestoneIndex: number) {
  return { escrowAddress_milestoneIndex: { escrowAddress, milestoneIndex } };
}

// In-memory set of known escrow addresses (lowercase).
// Used to filter global event watchers — no per-escrow watcher needed.
export const knownEscrows = new Set<string>();
