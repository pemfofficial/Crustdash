"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMounted } from "@/lib/client/useMounted";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
};

/** Centered dialog over a dimmed backdrop. Escape or a backdrop click closes it; focus returns afterwards. */
export function Modal({ open, onClose, label, children, size = "md" }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const mounted = useMounted();

  // Callers pass inline onClose functions and live data re-renders every ~2 s; keeping the latest handler in a
  // ref stops the focus effect from re-running (and stealing focus from inputs) on every render.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    const first = panel.current?.querySelector<HTMLElement>("[data-autofocus], button, input, select, textarea, a[href]");
    first?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open]);

  if (!open || !mounted) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} className={`modal-panel modal-${size}`}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
