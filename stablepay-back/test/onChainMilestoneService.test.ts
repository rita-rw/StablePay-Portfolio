import { describe, it, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex, zeroHash } from "viem";
import { publicClient } from "../src/utils/viemClient";
import { matchesOnChainHash } from "../src/services/onChainMilestoneService";

const ESCROW = "0x51f0011be8abcc57b9948c03c84f28068564a77d";
const DELIVERY = "Final designs uploaded to the shared Figma folder.";
const DISPUTE = "Only two of the five agreed screens were delivered.";

/** Fakes the contract's milestones(i) read so no RPC call is made. */
function fakeMilestone(deliveryHash: `0x${string}`, disputeReason: `0x${string}`) {
  // Same tuple order as milestones(i): amount, status, deliveryHash, submittedAt, disputeReason, ...
  mock.method(publicClient, "readContract", async () => [0n, 1, deliveryHash, 0n, disputeReason, 0n, ""]);
}

describe("matchesOnChainHash", () => {
  afterEach(() => mock.restoreAll());

  it("accepts the exact text whose hash is stored on-chain", async () => {
    fakeMilestone(keccak256(toHex(DELIVERY)), zeroHash);

    assert.equal(await matchesOnChainHash(ESCROW, 0, "deliveryHash", DELIVERY), true);
  });

  it("rejects different text — the backend can't be fed a fake delivery", async () => {
    fakeMilestone(keccak256(toHex(DELIVERY)), zeroHash);

    assert.equal(await matchesOnChainHash(ESCROW, 0, "deliveryHash", "Something else"), false);
  });

  it("rejects text that only differs by whitespace (no trimming before hashing)", async () => {
    fakeMilestone(keccak256(toHex(DELIVERY)), zeroHash);

    assert.equal(await matchesOnChainHash(ESCROW, 0, "deliveryHash", ` ${DELIVERY} `), false);
  });

  it("checks the dispute reason field, not the delivery field", async () => {
    fakeMilestone(keccak256(toHex(DELIVERY)), keccak256(toHex(DISPUTE)));

    assert.equal(await matchesOnChainHash(ESCROW, 0, "disputeReason", DISPUTE), true);
    assert.equal(await matchesOnChainHash(ESCROW, 0, "disputeReason", DELIVERY), false);
  });
});
