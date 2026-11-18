"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import type { Abi } from "viem";
import StablePayEscrowABI from "@/abi/StablePayEscrow.json";
import { getMilestoneStatus } from "@/lib/formatters";

const abi = StablePayEscrowABI.abi as Abi;

/** One milestone as stored in the escrow contract. */
export type OnChainMilestone = {
  status: string; // "PENDING", "SUBMITTED", "PAID", …
  amount: bigint; // USDC base units (6 decimals)
  disputeOpenedAt: number; // unix seconds, 0 = never disputed
};

/** On-chain state of one escrow. */
export type EscrowStatus = {
  sellerAccepted: boolean;
  funded: boolean;
  cancelled: boolean;
  /** Position i = milestone i. undefined if that read failed. */
  milestones: (OnChainMilestone | undefined)[];
};

// What milestones(i) returns — same order as the Milestone struct in StablePayEscrow.sol:
// amount, status, deliveryHash, submittedAt, disputeReason, disputeOpenedAt, disputeOpenedBy
type MilestoneTuple = readonly [bigint, number, string, bigint, string, bigint, string];

type Call = { address: `0x${string}`; abi: Abi; functionName: string; args?: readonly [bigint] };

/**
 * Reads sellerAccepted/funded/cancelled and every milestone for a list of
 * escrows in one multicall. `statuses` is undefined until the first answer,
 * then a map keyed by lowercase escrow address.
 */
export function useEscrowStatuses(escrows: readonly { id: string; milestoneCount: number }[]) {
  // Step 1: the questions
  const contracts = useMemo(() => {
    const calls: Call[] = [];
    for (const e of escrows) {
      const address = e.id as `0x${string}`;
      calls.push({ address, abi, functionName: "sellerAccepted" });
      calls.push({ address, abi, functionName: "funded" });
      calls.push({ address, abi, functionName: "cancelled" });
      for (let i = 0; i < e.milestoneCount; i++) {
        calls.push({ address, abi, functionName: "milestones", args: [BigInt(i)] });
      }
    }
    return calls;
  }, [escrows]);

  const { data, isError } = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0 },
  });

  // Step 2: the answers, in the same order as the questions — the only place that counts positions
  const statuses = useMemo(() => {
    if (!data || data.length === 0) return undefined;
    const map = new Map<string, EscrowStatus>();
    let idx = 0;
    for (const e of escrows) {
      const sellerAccepted = Boolean(data[idx++]?.result);
      const funded = Boolean(data[idx++]?.result);
      const cancelled = Boolean(data[idx++]?.result);
      const milestones: (OnChainMilestone | undefined)[] = [];
      for (let i = 0; i < e.milestoneCount; i++) {
        const r = data[idx++]?.result as MilestoneTuple | undefined;
        milestones.push(
          r && { status: getMilestoneStatus(Number(r[1])), amount: r[0], disputeOpenedAt: Number(r[5]) }
        );
      }
      map.set(e.id.toLowerCase(), { sellerAccepted, funded, cancelled, milestones });
    }
    return map;
  }, [data, escrows]);

  return { statuses, isError };
}
