import { MilestoneTitle } from "@/components/shared/MilestoneTitle";
import { PLATFORM_FEE_BPS } from "@/lib/constants";
import { calcFeeBase, formatUSDC } from "@/lib/formatters";

type UnfundedMilestonesProps = {
  milestones: { milestoneIndex: number; amount: string; label?: string | null }[];
  /** Rejected or cancelled before funding — no money moved, so no fee or payout to show. */
  isClosed: boolean;
};

/** The milestone plan before the buyer has funded: amount, fee and what the seller receives. */
export function UnfundedMilestones({ milestones, isClosed }: UnfundedMilestonesProps) {
  return (
    <div className="mb-6 space-y-3">
      <h2 className="text-lg font-semibold">Milestones</h2>
      {milestones.map((m) => {
        const grossBase = BigInt(m.amount);
        const feeBase = calcFeeBase(grossBase, PLATFORM_FEE_BPS);
        const sellerReceives = grossBase - feeBase;
        return (
          <div
            key={m.milestoneIndex}
            className="rounded-xl border border-zinc-300 bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.07)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <MilestoneTitle index={m.milestoneIndex} label={m.label} />
                <p className="mt-1 text-xs text-zinc-500">
                  Amount {formatUSDC(grossBase)} USDC
                  {!isClosed && ` · platform fee ${formatUSDC(feeBase)} USDC (2.5%)`}
                </p>
              </div>
              {isClosed ? (
                <p className="shrink-0 text-xs font-medium text-zinc-500">Not funded</p>
              ) : (
                <div className="shrink-0 text-right">
                  <p className="text-xs font-medium text-zinc-500">Seller receives</p>
                  <p className="font-semibold text-emerald-700">{formatUSDC(sellerReceives)} USDC</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
