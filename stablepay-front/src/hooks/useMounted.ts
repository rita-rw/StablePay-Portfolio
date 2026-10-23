"use client";

import { useSyncExternalStore } from "react";

// Nothing to subscribe to — the value never changes after hydration.
const subscribe = () => () => {};

/** False on the server and during hydration, true afterwards in the browser. */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}