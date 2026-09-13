import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/** False during server rendering and hydration, true afterwards. Portals need this: document.body only exists in the browser. */
export function useMounted(): boolean {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}
