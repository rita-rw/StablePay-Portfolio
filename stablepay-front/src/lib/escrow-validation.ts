import type { MilestoneInput } from "@/types/escrow";

export { type MilestoneInput };

export const MAX_MILESTONES = 50;
export const FEE_BUFFER_BPS = BigInt(50);

export interface MilestoneValidationResult {
  valid: boolean;
  error: string | null;
  /** Parsed amounts (only the ones > 0) in USDC base units are NOT here — this is UI-level check */
}

export function validateMilestones(milestones: MilestoneInput[]): MilestoneValidationResult {
  const nonEmpty = milestones.filter((m) => m.amount.trim() !== "");

  if (nonEmpty.length === 0) {
    return { valid: false, error: "At least one milestone with a valid amount is required." };
  }

  if (nonEmpty.length > MAX_MILESTONES) {
    return { valid: false, error: `Maximum ${MAX_MILESTONES} milestones allowed.` };
  }

  for (let i = 0; i < milestones.length; i++) {
    const raw = milestones[i].amount.trim();
    if (raw === "") continue;

    const val = parseFloat(raw);
    if (isNaN(val) || val <= 0) {
      return { valid: false, error: `Milestone ${i + 1} has an invalid amount (must be > 0).` };
    }
  }

  return { valid: true, error: null };
}

/**
 * Computes a safe maxFeeBps value.
 * Rule: min(platformFeeBps + 50, MAX_FEE_BPS) — protects buyer from
 * front-running if the platform raises its fee between page load and tx mining.
 */
export function computeMaxFeeBps(platformFeeBps: bigint, maxFeeBps: bigint): bigint {
  const withBuffer = platformFeeBps + FEE_BUFFER_BPS;
  return withBuffer < maxFeeBps ? withBuffer : maxFeeBps;
}
