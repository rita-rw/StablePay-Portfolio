/** Everything a button needs to drive one contract transaction. */
export type TxAction = {
  onClick: () => void;
  isPending: boolean;
  isConfirming: boolean;
  error: Error | null;
};

/** Button text that follows a transaction: wallet prompt → waiting for block → idle label. */
export function txButtonLabel(
  tx: TxAction,
  idleLabel: string,
  confirmingLabel = "Waiting for Confirmation...",
): string {
  if (tx.isPending) return "Confirm in Wallet...";
  if (tx.isConfirming) return confirmingLabel;
  return idleLabel;
}
