import { useSyncExternalStore } from "react";

// The active module lives in the URL hash so Back works and links can point anywhere:
//   #resources        a module
//   #wiki/steel       a module plus a path inside it (a wiki article, a findings filter)
const subscribeHash = (listener: () => void) => {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
};
const readHash = () => decodeURIComponent(window.location.hash.slice(1));

export function useModuleHash() {
  return useSyncExternalStore(subscribeHash, readHash, () => "");
}

/** The module id and the rest of the path: "wiki/steel" -> ["wiki", "steel"]. */
export function splitModuleHash(hash: string): [string, string] {
  const slash = hash.indexOf("/");
  return slash < 0 ? [hash, ""] : [hash.slice(0, slash), hash.slice(slash + 1)];
}

export function openModule(id: string) {
  if (readHash() !== id) window.location.hash = id;
}
