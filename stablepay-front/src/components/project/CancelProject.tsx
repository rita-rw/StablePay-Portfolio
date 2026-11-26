import { parseContractError } from "@/lib/formatters";
import { txButtonLabel, type TxAction } from "@/lib/tx";

type CancelProjectProps = {
  cancel: TxAction;
};

/** Buyer can cancel a funded project and get everything back while no work has started. */
export function CancelProject({ cancel }: CancelProjectProps) {
  return (
    <div className="mb-6 rounded-lg border border-red-200 p-4">
      <p className="mb-2 text-sm text-zinc-800">
        No work has started yet. You can cancel this project and recover all funds.
      </p>
      <button
        onClick={cancel.onClick}
        disabled={cancel.isPending || cancel.isConfirming}
        className="w-full rounded-lg border border-red-400 px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
      >
        {txButtonLabel(cancel, "Cancel Project & Refund")}
      </button>
      {cancel.error && <p className="mt-2 text-xs text-red-500">{parseContractError(cancel.error)}</p>}
    </div>
  );
}
