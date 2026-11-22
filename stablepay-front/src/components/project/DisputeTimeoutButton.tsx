import { parseContractError } from "@/lib/formatters";
import { txButtonLabel, type TxAction } from "@/lib/tx";

type DisputeTimeoutButtonProps = {
  /** The buyer gets a refund; the seller can close the dispute, which also refunds the buyer. */
  isBuyer: boolean;
  /** Shown to the buyer, e.g. "30 days". */
  timeoutLabel: string;
  close: TxAction;
  /** A timeout is in flight on another milestone. */
  busyElsewhere: boolean;
};

/** After the dispute timeout, either party can close the dispute and refund the buyer. */
export function DisputeTimeoutButton({ isBuyer, timeoutLabel, close, busyElsewhere }: DisputeTimeoutButtonProps) {
  const idleLabel = isBuyer ? `Claim Timeout Refund (${timeoutLabel} elapsed)` : "Close Dispute (refund buyer)";

  return (
    <div className="mt-3">
      <button
        onClick={close.onClick}
        disabled={close.isPending || close.isConfirming || busyElsewhere}
        className="w-full rounded-lg border border-red-400 px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
      >
        {txButtonLabel(close, idleLabel)}
      </button>
      {close.error && <p className="mt-1 text-xs text-red-500">{parseContractError(close.error)}</p>}
    </div>
  );
}
