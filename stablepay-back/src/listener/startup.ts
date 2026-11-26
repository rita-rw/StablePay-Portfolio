import { prisma } from "../prisma";
import { factoryReadAbi } from "../abi/EscrowFactory.read.abi";
import { escrowCancelledEvent, projectRejectedEvent } from "../abi/events";
import {
  CATCH_UP_BATCH_DELAY_MS,
  CATCH_UP_CONCURRENCY,
  backfillClient,
  isRateLimitError,
  knownEscrows,
  sleep,
  withRateLimitRetry,
} from "./chain";
import { seedMissingEscrowFromChain } from "./seed";
import { type EscrowWithMilestones, readCancelledAt, syncEscrowState } from "./sync";

// Startup work after the watchers are running. Each step takes `shouldStop`,
// so a listener restart can cut it short.

/**
 * Seed every escrow the factory knows about that isn't in the DB yet.
 * Reads the list straight from the factory instead of scanning EscrowCreated
 * logs — the public RPC caps eth_getLogs at 200 blocks, and the factory's
 * history is millions of blocks long. Runs after the watchers start, so any
 * escrow created later is picked up by the EscrowCreated watcher instead.
 */
export async function backfillFromHistory(factoryAddress: `0x${string}`, shouldStop: () => boolean) {
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
      if (shouldStop()) {
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

/**
 * On startup, sync every escrow that isn't cancelled, to catch events missed
 * while the backend was down. Runs in small batches against the public RPC.
 */
export async function catchUpOnChainState(shouldStop: () => boolean) {
  const escrows = await prisma.escrow.findMany({
    where: { status: { not: "CANCELLED" } },
    include: { milestones: true },
  });

  if (escrows.length === 0) return;
  console.log(`[catch-up] syncing ${escrows.length} escrows with on-chain state...`);

  const processEscrow = async (escrow: EscrowWithMilestones) => {
    try {
      await syncEscrowState(escrow, "catch-up", shouldStop);
    } catch (err) {
      // Let the batch-level retry handle transient public-RPC rate limits.
      if (isRateLimitError(err)) throw err;
      console.error(`[catch-up] failed for ${escrow.id}`, err);
    }
  };

  for (let i = 0; i < escrows.length; i += CATCH_UP_CONCURRENCY) {
    if (shouldStop()) {
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

/**
 * Cancel and seller-reject used to store only the status, so the Closed list
 * fell back to createdAt. Fill cancelledAt from the chain for those rows.
 */
export async function repairMissingCancelledAt(shouldStop: () => boolean) {
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
    if (shouldStop()) return;
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
