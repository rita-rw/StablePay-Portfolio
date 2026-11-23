import { useCallback, useRef } from "react";
import { useWriteContract } from "wagmi";

/**
 * useWriteContract that ignores a second call while the wallet prompt is open.
 *
 * Buttons disable themselves on `isPending`, but wagmi sets that flag a moment
 * after the click, so a fast double click could open two MetaMask prompts.
 * The ref is set synchronously and cleared when the wallet answers.
 */
export function useWriteContractOnce() {
  const result = useWriteContract();
  const { writeContract } = result;
  const inFlight = useRef(false);

  const writeContractOnce = useCallback(
    (variables: Parameters<typeof writeContract>[0]) => {
      if (inFlight.current) return;
      inFlight.current = true;
      writeContract(variables, {
        onSettled: () => {
          inFlight.current = false;
        },
      });
    },
    [writeContract],
  );

  return { ...result, writeContract: writeContractOnce };
}
