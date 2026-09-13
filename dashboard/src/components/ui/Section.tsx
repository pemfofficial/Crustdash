"use client";

import { useEffect, useId, type ReactNode } from "react";
import { useStoredState } from "@/lib/client/useStoredState";
import { InfoTip } from "./InfoTip";
import type { TopicId } from "@/lib/crust/topics";

export const OPEN_SECTION_EVENT = "crustdash:open-section";

/** Ask a collapsed section (by id) to open, e.g. before scrolling to something inside it. */
export function requestOpenSection(id: string) {
  window.dispatchEvent(new CustomEvent(OPEN_SECTION_EVENT, { detail: id }));
}

type Props = {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  info?: TopicId;
  actions?: ReactNode;
  defaultOpen?: boolean;
  /** "card" for top-level sections, "sub" for collapsible groups inside a section. */
  variant?: "card" | "sub";
  children: ReactNode;
};

/** A section whose whole header row toggles it. Open/closed state is remembered per section in this browser. */
export function Section({ id, title, subtitle, info, actions, defaultOpen = true, variant = "card", children }: Props) {
  const [saved, setSaved] = useStoredState<boolean | null>(`crustdash:section:${id}`, null);
  const open = saved ?? defaultOpen;
  const bodyId = useId();

  useEffect(() => {
    const onRequest = (e: Event) => {
      if ((e as CustomEvent<string>).detail === id) setSaved(true);
    };
    window.addEventListener(OPEN_SECTION_EVENT, onRequest);
    return () => window.removeEventListener(OPEN_SECTION_EVENT, onRequest);
  }, [id, setSaved]);

  return (
    <section id={`section-${id}`} className={`${variant === "card" ? "card section" : "sub-section"} ${open ? "is-open" : "is-closed"}`}>
      <div className="section-head">
        <button type="button" className="section-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setSaved(!open)}>
          <span className="chevron" aria-hidden>▸</span>
          <span className="section-heading">{title}</span>
          {subtitle && <span className="section-sub">{subtitle}</span>}
        </button>
        {info && <InfoTip topic={info} />}
        {actions && <div className="section-actions">{actions}</div>}
      </div>
      <div id={bodyId} className="section-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
