import { parseContractError, formatDateTime } from "@/lib/formatters";
import { txButtonLabel, type TxAction } from "@/lib/tx";

type BuyerMilestoneActionsProps = {
  /** When the payment is released automatically if the buyer does nothing. */
  releaseAt: Date | null;
  now: number;
  approve: TxAction;
  /** Another milestone is being approved — hide this button meanwhile. */
  approveBusyElsewhere: boolean;
  dispute: TxAction;
  /** A dispute tx is in flight on another milestone. */
  disputeBusyElsewhere: boolean;
  disputeOpen: boolean;
  onDisputeOpenChange: (open: boolean) => void;
  disputeReason: string;
  onDisputeReasonChange: (reason: string) => void;
};

/** Buyer's options on a submitted milestone: approve and pay, or open a dispute. */
export function BuyerMilestoneActions({
  releaseAt,
  now,
  approve,
  approveBusyElsewhere,
  dispute,
  disputeBusyElsewhere,
  disputeOpen,
  onDisputeOpenChange,
  disputeReason,
  onDisputeReasonChange,
}: BuyerMilestoneActionsProps) {
  const approvalWindowEnded = releaseAt != null && releaseAt.getTime() <= now;
  const disputing = dispute.isPending || dispute.isConfirming;

  return (
    <div className="mt-3 space-y-2">
      {releaseAt && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {approvalWindowEnded
            ? "The approval window has ended. The seller can now claim this payment."
            : `If you don't approve or dispute, this payment will be released to the seller automatically on ${formatDateTime(releaseAt)}.`}
        </p>
      )}
      {!approvalWindowEnded && (
        <>
          {!approveBusyElsewhere && (
            <button
              onClick={approve.onClick}
              disabled={approve.isPending || approve.isConfirming}
              className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm text-white transition-colors hover:bg-green-500 disabled:opacity-50"
            >
              {txButtonLabel(approve, "Approve & Release Payment")}
            </button>
          )}
          {approve.error && (
            <p className="text-xs text-red-500">{parseContractError(approve.error)}</p>
          )}
          <div className="space-y-2">
            {!disputeOpen ? (
              <button
                onClick={() => onDisputeOpenChange(true)}
                className="w-full rounded-lg border border-red-400 px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
              >
                Open Dispute
              </button>
            ) : (
              <div className="rounded-lg border border-red-500 bg-white p-3 space-y-2">
                <p className="text-xs font-semibold text-red-600 uppercase tracking-wider">Open Dispute</p>
                <textarea
                  value={disputeReason}
                  onChange={(e) => onDisputeReasonChange(e.target.value)}
                  placeholder="Dispute reason (e.g. work not delivered as agreed)"
                  maxLength={500}
                  rows={3}
                  disabled={disputing}
                  className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200 resize-none disabled:opacity-60"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => onDisputeOpenChange(false)}
                    disabled={disputing}
                    className="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={dispute.onClick}
                    disabled={!disputeReason.trim() || disputing || disputeBusyElsewhere}
                    className="flex-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {txButtonLabel(dispute, "Confirm Dispute", "Waiting...")}
                  </button>
                </div>
              </div>
            )}
            {dispute.error && (
              <p className="text-xs text-red-500">{parseContractError(dispute.error)}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
