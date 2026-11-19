import { parseContractError } from "@/lib/formatters";
import { txButtonLabel, type TxAction } from "@/lib/tx";

type FundProjectProps = {
  amount: string;
  isApproved: boolean;
  approve: TxAction;
  fund: TxAction;
  cancel: TxAction;
};

const PRIMARY_BUTTON_STYLE = {
  background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)",
  boxShadow: "0 2px 8px hsl(217 91% 30% / 0.35)",
};

/** Buyer's two-step funding (approve USDC, then deposit) plus the option to cancel. */
export function FundProject({ amount, isApproved, approve, fund, cancel }: FundProjectProps) {
  return (
    <div className="mb-6 space-y-4">
      <h2 className="text-lg font-semibold">Fund this Project</h2>
      <p className="text-sm text-zinc-800">
        Funding requires two transactions: first you approve USDC transfer,
        then you deposit funds into the escrow contract.
      </p>

      <div className="space-y-3">
        <div className="rounded-xl border border-zinc-300 bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-medium">Step 1: Approve USDC</p>
            {isApproved && <span className="text-sm text-emerald-600">✓ Approved</span>}
          </div>
          <p className="mb-3 text-xs text-zinc-700">
            Allow the escrow contract to transfer {amount} USDC from your wallet.
          </p>
          {!isApproved && (
            <button
              onClick={approve.onClick}
              disabled={approve.isPending || approve.isConfirming}
              className="w-full rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
              style={PRIMARY_BUTTON_STYLE}
            >
              {txButtonLabel(approve, `Approve ${amount} USDC`)}
            </button>
          )}
          {approve.error && (
            <p className="mt-2 text-xs text-red-500">{parseContractError(approve.error)}</p>
          )}
        </div>

        <div className="rounded-xl border border-zinc-300 bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
          <p className="mb-2 font-medium">Step 2: Fund Escrow</p>
          <p className="mb-3 text-xs text-zinc-700">
            Deposit {amount} USDC into the escrow contract. Funds are
            locked until milestones are approved.
          </p>
          <button
            onClick={fund.onClick}
            disabled={fund.isPending || fund.isConfirming || !isApproved}
            className="w-full rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
            style={PRIMARY_BUTTON_STYLE}
          >
            {txButtonLabel(fund, `Fund ${amount} USDC`)}
          </button>
          {fund.error && (
            <p className="mt-2 text-xs text-red-500">{parseContractError(fund.error)}</p>
          )}
        </div>
      </div>

      <div className="mt-4 text-center">
        <button
          onClick={cancel.onClick}
          disabled={cancel.isPending || cancel.isConfirming}
          className="text-sm text-zinc-500 underline transition-colors hover:text-red-500 disabled:opacity-50"
        >
          {txButtonLabel(cancel, "Cancel this project", "Cancelling...")}
        </button>
        {cancel.error && (
          <p className="mt-1 text-xs text-red-500">{parseContractError(cancel.error)}</p>
        )}
      </div>
    </div>
  );
}
