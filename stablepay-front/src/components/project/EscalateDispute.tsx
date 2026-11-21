import { parseContractError } from "@/lib/formatters";
import { txButtonLabel, type TxAction } from "@/lib/tx";

type EscalateDisputeProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason: string;
  onReasonChange: (reason: string) => void;
  escalate: TxAction;
  /** An escalation is in flight on another milestone. */
  busyElsewhere: boolean;
};

/** Seller skips the correction window and sends the dispute straight to the platform. */
export function EscalateDispute({
  open,
  onOpenChange,
  reason,
  onReasonChange,
  escalate,
  busyElsewhere,
}: EscalateDisputeProps) {
  return (
    <div className="mt-3">
      {!open ? (
        <button
          onClick={() => onOpenChange(true)}
          className="w-full rounded-lg border border-orange-400 px-4 py-2 text-sm text-orange-600 transition-colors hover:bg-orange-50"
        >
          Escalate to Admin
        </button>
      ) : (
        <div className="rounded-lg border border-red-500 bg-white p-3 space-y-2">
          <p className="text-xs font-semibold text-red-600 uppercase tracking-wider">Escalate to Admin</p>
          <textarea
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder="Explain why you're escalating this to the platform…"
            maxLength={500}
            rows={3}
            className="w-full resize-none rounded-md border border-red-500 bg-white px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-400"
          />
          <div className="flex gap-2">
            <button
              onClick={() => onOpenChange(false)}
              className="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100"
            >
              Cancel
            </button>
            <button
              onClick={escalate.onClick}
              disabled={!reason.trim() || escalate.isPending || escalate.isConfirming || busyElsewhere}
              className="flex-1 rounded-md bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
            >
              {txButtonLabel(escalate, "Confirm Escalation", "Waiting...")}
            </button>
          </div>
        </div>
      )}
      <p className="mt-1 text-xs text-zinc-500">
        Skip the correction window and let the platform resolve this dispute directly.
      </p>
      {escalate.error && <p className="mt-1 text-xs text-red-500">{parseContractError(escalate.error)}</p>}
    </div>
  );
}
