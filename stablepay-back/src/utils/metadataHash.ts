import { encodeAbiParameters, keccak256 } from "viem";

/**
 * Hash of a project's off-chain metadata — passed to createEscrow and stored on-chain.
 * ABI encoding keeps the fields apart, so text can't be moved between title and description.
 * Must match computeMetadataHash in stablepay-front/src/lib/metadataHash.ts.
 */
export function computeMetadataHash(title: string, description: string, milestoneLabels: string[]): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "string[]" }],
      [title, description, milestoneLabels],
    ),
  );
}
