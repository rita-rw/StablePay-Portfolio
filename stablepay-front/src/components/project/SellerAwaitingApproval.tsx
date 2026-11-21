import { parseContractError, formatDateTime, dayLabel } from "@/lib/formatters";
import { txButtonLabel, type TxAction } from "@/lib/tx";

type SellerAwaitingApprovalProps = {
  /** When the seller may claim the payment if the buyer does nothing. */
  releaseAt: Date | null;
  now: number;
  autoApprovalDays: number;
  claim: TxAction;
  /** A claim is in flight on another milestone. */
  claimBusyElsewhere: boolean;
};

const PRIMARY_BUTTON_STYLE = {
  background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)",
  boxShadow: "0 2px 8px hsl(217 91% 30% / 0.35)",
};

/** Seller's view of a submitted milestone: waiting for the buyer, then the option to claim. */
export function SellerAwaitingApproval({
  releaseAt,
  now,
  autoApprovalDays,
  claim,
  claimBusyElsewhere,
}: SellerAwaitingApprovalProps) {
  const approvalWindowEnded = releaseAt != null && releaseAt.getTime() <= now;

  return (
    <div className="mt-3 space-y-2">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
        <p className="text-sm font-medium text-blue-800">Delivery submitted</p>
        <p className="text-xs text-blue-600">
          {!releaseAt
            ? `Waiting for buyer approval — auto-approval available in ${dayLabel(autoApprovalDays)}`
            : approvalWindowEnded
              ? "The approval window has ended. You can release this payment."
              : `Waiting for buyer approval. You can release this payment automatically on ${formatDateTime(releaseAt)}.`}
        </p>
      </div>
      {approvalWindowEnded && (
        <button
          onClick={claim.onClick}
          disabled={claim.isPending || claim.isConfirming || claimBusyElsewhere}
          className="w-full rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
          style={PRIMARY_BUTTON_STYLE}
        >
          {txButtonLabel(claim, "Claim Payment (Auto-approved)")}
        </button>
      )}
      {claim.error && <p className="mt-1 text-xs text-red-500">{parseContractError(claim.error)}</p>}
    </div>
  );
}
