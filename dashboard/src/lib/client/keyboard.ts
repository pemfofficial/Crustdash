/**
 * Whether a global single-key shortcut (/, N, T) should ignore this keypress: a modifier is held, the user is
 * typing in a field, or (unless allowed) a dialog or drawer is open.
 */
export function shouldIgnoreShortcut(e: KeyboardEvent, { overOverlays = false }: { overOverlays?: boolean } = {}): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const target = e.target as HTMLElement | null;
  if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return true;
  return !overOverlays && document.querySelector(".modal-backdrop, .drawer-backdrop") !== null;
}
