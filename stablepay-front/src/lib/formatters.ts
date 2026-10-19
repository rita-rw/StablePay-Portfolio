import { MILESTONE_STATUS_MAP } from "./constants";

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)} ... ${addr.slice(-4)}`;
}

/**
 * Formats a USDC amount given in base units (6 decimals) as a decimal string,
 * showing as many decimals as needed to be exact (up to 6), never fewer than 2.
 * Avoids the float-rounding drift of `parseFloat(formatUnits(...)).toFixed(2)`,
 * which silently drops the sub-cent remainder USDC's 6 decimals can carry.
 */
export function formatUSDC(baseUnits: bigint): string {
  const negative = baseUnits < 0n;
  const abs = negative ? -baseUnits : baseUnits;
  const whole = abs / 1_000_000n;
  let frac = (abs % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** Mirrors the contract's integer fee math: floor(amount * feeBps / 10000). */
export function calcFeeBase(amountBase: bigint, feeBps: bigint): bigint {
  return (amountBase * feeBps) / 10_000n;
}

export function decodeTitle(title: string): string {
  return title
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function parseContractError(error: Error | null): string | null {
  if (!error) return null;
  const msg = error.message;
  if (/user rejected/i.test(msg)) return "Transaction cancelled";
  const revertMatch = msg.match(/reverted.*?reason[:\s"]+([^\n"\\]+)/i);
  if (revertMatch) {
    const reason = revertMatch[1].trim();
    const knownReasons: Record<string, string> = {
      "Wrong status": "This action is not allowed in the current state",
      "Only buyer": "Only the buyer can perform this action",
      "Only seller": "Only the seller can perform this action",
      "Only platform": "Only the platform can perform this action",
      "Not party": "Only the buyer or seller can perform this action",
      "Not funded": "The escrow has not been funded yet",
      "Dispute timeout not elapsed": "The dispute timeout period has not elapsed yet",
      "Too high": "The awarded amount exceeds the milestone value",
      "Correction window active": "The correction window has not passed yet",
    };
    return knownReasons[reason] ?? reason.slice(0, 100);
  }
  return msg.slice(0, 120);
}

export function parseFactoryError(error: Error | null): string | null {
  if (!error) return null;
  const msg = error.message;
  if (/user rejected/i.test(msg)) return "Transaction cancelled";
  const customErrorMap: Record<string, string> = {
    BuyerSellerSame: "The seller address cannot be your own wallet address",
    InvalidSeller: "The seller address is invalid",
    TokenNotApproved: "This token is not approved for use on StablePay",
    NoMilestones: "At least one milestone is required",
    TooManyMilestones: "Too many milestones — reduce the number and try again",
    FeeTooHigh: "The platform fee has changed — please refresh the page and try again",
    InvalidMilestoneAmount: "Milestone amounts must be greater than zero",
  };
  for (const [name, message] of Object.entries(customErrorMap)) {
    if (msg.includes(name)) return message;
  }
  if (msg.includes("exceeds max") || msg.includes("-32603")) {
    return "Transaction failed — check your inputs and try again";
  }
  return msg.slice(0, 120);
}

export function deriveProjectStatus(
  funded: boolean,
  cancelled: boolean,
  sellerAccepted: boolean,
  milestoneStatuses: string[],
): string {
  if (cancelled) return "CANCELLED";
  const allPaid = milestoneStatuses.length > 0 && milestoneStatuses.every((s) => s === "PAID" || s === "RESOLVED" || s === "REFUNDED");
  if (allPaid) return "COMPLETED";
  const hasActive = milestoneStatuses.some(
    (s) => s === "SUBMITTED" || s === "DISPUTED" || s === "RESOLVED" || s === "PAID",
  );
  if (hasActive) return "IN_PROGRESS";
  if (funded) return "FUNDED";
  if (sellerAccepted) return "SELLER_ACCEPTED";
  return "CREATED";
}

function settledMilestone(status: string): boolean {
  return status === "PAID" || status === "RESOLVED" || status === "REFUNDED";
}

export function getDisplayStatus(
  dbStatus: string,
  onChain?: {
    sellerAccepted: boolean;
    funded: boolean;
    cancelled: boolean;
    hasDispute: boolean;
    allPaid: boolean;
    hasSubmitted: boolean;
  },
  milestones?: { status: string }[],
  milestoneCount?: number,
): string {
  if (onChain) {
    if (onChain.cancelled) return "CANCELLED";
    if (onChain.allPaid) return "COMPLETED"; // allPaid includes RESOLVED milestones
    if (onChain.hasSubmitted) return "IN_PROGRESS";
    if (onChain.funded) return "FUNDED";
    if (onChain.sellerAccepted) return "SELLER_ACCEPTED";
    return "CREATED";
  }
  // Escrow.status stays FUNDED after the work is done. Use milestone rows so
  // the list does not flash those projects on Active before the chain read.
  if (dbStatus === "CANCELLED" || dbStatus === "SELLER_REJECTED") return dbStatus;
  const rows = milestones ?? [];
  const complete = milestoneCount == null || milestoneCount === 0 || rows.length >= milestoneCount;
  if (complete && rows.length > 0) {
    if (rows.every((m) => settledMilestone(m.status))) return "COMPLETED";
    if (rows.some((m) => m.status === "SUBMITTED" || m.status === "DISPUTED" || m.status === "RESOLVED" || m.status === "PAID")) {
      return "IN_PROGRESS";
    }
  }
  return dbStatus;
}

export function statusBadge(status: string): { label: string; color: string } {
  const label =
    status === "CREATED" ? "AWAITING ACCEPTANCE"
    : status === "SELLER_ACCEPTED" ? "ACCEPTED — AWAITING FUNDING"
    : status === "SELLER_REJECTED" ? "REJECTED"
    : status === "COMPLETED" ? "COMPLETED"
    : status === "IN_PROGRESS" || status === "FUNDED" ? "IN PROGRESS"
    : status;

  const color =
    status === "CANCELLED" || status === "SELLER_REJECTED"
      ? "bg-red-50 border border-red-200 text-red-700"
      : status === "COMPLETED"
      ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
      : status === "IN_PROGRESS" || status === "FUNDED"
      ? "bg-amber-50 border border-amber-200 text-amber-700"
      : status === "SELLER_ACCEPTED"
      ? "bg-blue-50 border border-blue-200 text-blue-700"
      : status === "CREATED"
      ? "bg-zinc-50 border border-zinc-200 text-zinc-600"
      : "bg-amber-50 border border-amber-200 text-amber-700";

  return { label, color };
}

export function milestoneStatusBadge(status: string, hadDispute = false): { label: string; color: string } {
  const disputeRefunded = status === "REFUNDED" && hadDispute;
  const resolvedPaid = status === "RESOLVED" || (status === "PAID" && hadDispute);
  const label = disputeRefunded
    ? "DISPUTE REFUNDED"
    : resolvedPaid
    ? "RESOLVED & PAID"
    : status;

  const color = disputeRefunded
    ? "bg-red-50 border-red-200 text-red-700"
    : status === "PAID" || status === "RESOLVED"
    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
    : status === "SUBMITTED"
    ? "bg-blue-50 border-blue-200 text-blue-700"
    : status === "DISPUTED"
    ? "bg-red-50 border-red-200 text-red-700"
    : status === "ESCALATED"
    ? "bg-orange-50 border-orange-200 text-orange-700"
    : status === "REFUNDED"
    ? "bg-zinc-50 border-zinc-300 text-zinc-600"
    : "bg-zinc-50 border-zinc-200 text-zinc-500";

  return { label, color };
}

export function getMilestoneStatus(statusCode: number): string {
  return MILESTONE_STATUS_MAP[statusCode] ?? "PENDING";
}
