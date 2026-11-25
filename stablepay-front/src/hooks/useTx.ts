import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { useWaitForTransactionReceipt } from "wagmi";
import { useWriteContractOnce } from "@/hooks/useWriteContractOnce";
import { type TxAction } from "@/lib/tx";

type WriteVariables = Parameters<ReturnType<typeof useWriteContractOnce>["writeContract"]>[0];
type TxStatus = Omit<TxAction, "onClick">;

/**
 * One contract transaction: the wallet prompt (write) plus waiting for the block (receipt).
 *
 * Milestone actions pass the milestone index to `write`. Then:
 * - each card asks `forIndex(i)` for its own button state, so only the card that
 *   started the tx shows "Confirm in Wallet…" or the error (`busyElsewhere` for the rest);
 * - `onConfirmed(index)` runs once when that tx is in a block.
 */
export function useTx(onConfirmed?: (milestoneIndex: number) => void) {
  const { writeContract, data: hash, isPending, error } = useWriteContractOnce();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: !!hash },
  });

  // State drives rendering. The ref is read when the tx confirms — reading state
  // there would hand over the index of a tx the user started afterwards.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const confirmedIndex = useRef<number | null>(null);

  const write = useCallback(
    (variables: WriteVariables, milestoneIndex?: number) => {
      if (milestoneIndex !== undefined) {
        confirmedIndex.current = milestoneIndex;
        setActiveIndex(milestoneIndex);
      }
      writeContract(variables);
    },
    [writeContract],
  );

  // useEffectEvent: always calls the latest onConfirmed, but only re-runs when isSuccess flips
  const handleConfirmed = useEffectEvent(() => {
    if (onConfirmed && confirmedIndex.current !== null) onConfirmed(confirmedIndex.current);
  });
  useEffect(() => {
    if (isSuccess) handleConfirmed();
  }, [isSuccess]);

  /** Button state for a project-level action (accept, fund, cancel …). Add `onClick` in the JSX. */
  const status: TxStatus = { isPending, isConfirming, error };

  /**
   * Button state for the card of milestone `index`. Add `onClick` in the JSX —
   * passing a handler in here would make React Compiler assume it runs during render.
   */
  const forIndex = (index: number): TxStatus => {
    const mine = activeIndex === index;
    return { isPending: isPending && mine, isConfirming: isConfirming && mine, error: mine ? error : null };
  };

  /** True while another milestone's tx of this kind is in flight. */
  const busyElsewhere = (index: number) => (isPending || isConfirming) && activeIndex !== index;

  return { write, isPending, isConfirming, isSuccess, error, status, forIndex, busyElsewhere };
}
