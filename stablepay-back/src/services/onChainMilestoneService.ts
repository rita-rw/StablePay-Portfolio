import { getAddress, keccak256, toHex } from "viem";
import { publicClient } from "../utils/viemClient";
import { escrowReadAbi } from "../abi/StablePayEscrow.read.abi";

type HashField = "deliveryHash" | "disputeReason";

/**
 * True if keccak256(text) equals the hash the contract stored for this milestone.
 * Only the party allowed by the contract can set these hashes, so a match proves
 * the text came from that party — no wallet signature needed.
 */
export async function matchesOnChainHash(
  escrowAddress: string,
  milestoneIndex: number,
  field: HashField,
  text: string,
): Promise<boolean> {
  const [, , deliveryHash, , disputeReason] = await publicClient.readContract({
    address: getAddress(escrowAddress),
    abi: escrowReadAbi,
    functionName: "milestones",
    args: [BigInt(milestoneIndex)],
  });
  const onChain = field === "deliveryHash" ? deliveryHash : disputeReason;
  return onChain.toLowerCase() === keccak256(toHex(text)).toLowerCase();
}
