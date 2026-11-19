import { parseContractError } from "@/lib/formatters";
import { txButtonLabel, type TxAction } from "@/lib/tx";

type ProjectInvitationProps = {
  accept: TxAction;
  reject: TxAction;
};

/** Shown to an invited (registered) seller: accept or reject the project. */
export function ProjectInvitation({ accept, reject }: ProjectInvitationProps) {
  return (
    <div className="mb-6 rounded-lg border border-orange-200 bg-orange-50 p-4">
      <h2 className="mb-2 text-lg font-semibold">Project Invitation</h2>
      <p className="mb-4 text-sm text-zinc-800">
        You have been invited to this project. Accept to allow the buyer to fund the escrow, or reject to cancel.
      </p>
      <div className="flex gap-3">
        <button
          onClick={accept.onClick}
          disabled={accept.isPending || accept.isConfirming}
          className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm text-white transition-colors hover:bg-green-500 disabled:opacity-50"
        >
          {txButtonLabel(accept, "Accept Project")}
        </button>
        <button
          onClick={reject.onClick}
          disabled={reject.isPending || reject.isConfirming}
          className="flex-1 rounded-lg border border-red-400 px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
        >
          {txButtonLabel(reject, "Reject Project")}
        </button>
      </div>
      {accept.error && (
        <p className="mt-2 text-xs text-red-500">{parseContractError(accept.error)}</p>
      )}
      {reject.error && (
        <p className="mt-2 text-xs text-red-500">{parseContractError(reject.error)}</p>
      )}
    </div>
  );
}
