import { PLATFORM_FEE_BPS, DISPUTE_FEE_BPS } from "@/lib/constants";
import { formatUSDC, calcFeeBase } from "@/lib/formatters";

type MilestonePaymentProps = {
  /** Milestone amount in USDC base units (6 decimals). */
  amount: string;
  /** PAID, REFUNDED or RESOLVED. */
  status: string;
  hadDispute: boolean;
  /** Gross amount the platform awarded the seller in a dispute, before the platform fee. */
  sellerAward?: string | null;
};

/** Fee and payout breakdown for a settled milestone (paid, refunded or resolved). */
export function MilestonePayment({ amount, status, hadDispute, sellerAward }: MilestonePaymentProps) {
  const grossBase = BigInt(amount);
  const isDisputeResolved = status === "RESOLVED";
  const isDisputePaid = status === "PAID" && hadDispute;
  const isDisputeRefunded = status === "REFUNDED" && hadDispute;
  const isDisputeOutcome = isDisputeResolved || isDisputePaid || isDisputeRefunded;
  const isPaid = status === "PAID";

  // Same integer math as the contract, in USDC base units — avoids float
  // rounding drift (e.g. 0.97 instead of the real 0.975).
  const disputeFeeBase = isDisputeOutcome ? calcFeeBase(grossBase, DISPUTE_FEE_BPS) : 0n;
  let platformFeeBase = 0n;
  let netBase = 0n;
  let buyerRefundBase: bigint | null = null;

  if (isDisputeRefunded) {
    // Buyer wins entirely: no platform fee, seller gets 0
    buyerRefundBase = grossBase - disputeFeeBase;
  } else if ((isDisputePaid || isDisputeResolved) && sellerAward) {
    const sellerGrossBase = BigInt(sellerAward);
    platformFeeBase = calcFeeBase(sellerGrossBase, PLATFORM_FEE_BPS);
    netBase = sellerGrossBase - platformFeeBase;
    if (isDisputeResolved) {
      const refund = grossBase - sellerGrossBase - disputeFeeBase;
      buyerRefundBase = refund > 0n ? refund : 0n;
    }
  } else if (isDisputeOutcome && !sellerAward) {
    return <div className="mt-3 text-xs text-zinc-400 italic">Loading settlement details…</div>;
  } else if (status === "REFUNDED") {
    // Plain cancellation (no dispute): buyer gets the full amount back, seller nothing
    buyerRefundBase = grossBase;
  } else {
    // Normal PAID (approved/auto-approved)
    platformFeeBase = calcFeeBase(grossBase, PLATFORM_FEE_BPS);
    netBase = grossBase - platformFeeBase;
  }

  return (
    <div className="mt-3 rounded-lg border border-zinc-900 bg-white p-3 text-xs">
      <p className="mb-2 font-semibold text-zinc-500 uppercase tracking-wider text-[10px]">
        {isDisputeOutcome ? "Settlement" : "Payment"}
      </p>
      <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
        <span className="text-zinc-500">Amount</span>
        <span className="text-zinc-800">{formatUSDC(grossBase)} USDC</span>
        {isDisputeOutcome && (
          <>
            <span className="text-zinc-500">Dispute fee</span>
            <span className="text-zinc-700">{formatUSDC(disputeFeeBase)} USDC <span className="text-zinc-400">(1%)</span></span>
          </>
        )}
        {platformFeeBase > 0n && (
          <>
            <span className="text-zinc-500">Platform fee</span>
            <span className="text-zinc-700">{formatUSDC(platformFeeBase)} USDC <span className="text-zinc-400">{isDisputeOutcome ? "(2.5% of seller's share)" : "(2.5%)"}</span></span>
          </>
        )}
        {buyerRefundBase !== null && buyerRefundBase > 0n && (
          <>
            <span className="text-zinc-500">Refunded</span>
            <span className="text-zinc-700">{formatUSDC(buyerRefundBase)} USDC</span>
          </>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-zinc-200 pt-2">
        <span className="font-medium text-zinc-700">{isPaid ? "Paid to seller" : "Seller receives"}</span>
        <span className="font-bold text-sm text-zinc-900">
          {formatUSDC(netBase)} USDC
        </span>
      </div>
    </div>
  );
}
