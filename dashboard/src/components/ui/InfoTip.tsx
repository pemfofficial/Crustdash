"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { TOPICS, type TopicId } from "@/lib/crust/topics";
import { WIKI_ENTRIES, wikiHref } from "@/lib/wiki/client";
import { RichText } from "./RichText";

/** The small "i" next to a heading: what the figure is, where it comes from, and the Wiki article on how the game works. */
export function InfoTip({ topic, label }: { topic: TopicId; label?: string }) {
  const t = TOPICS[topic];
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const popId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!t) return null;
  const article = t.wiki ? WIKI_ENTRIES.get(t.wiki) : undefined;

  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    const rect = wrap.current?.getBoundingClientRect();
    if (rect) setAlignRight(rect.left + 390 > window.innerWidth);
    setOpen((o) => !o);
  };

  return (
    <span className="infotip" ref={wrap}>
      <button
        type="button"
        className="info-btn"
        aria-label={`About ${label ?? t.title}`}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={toggle}
      >
        i
      </button>
      {open && (
        <span id={popId} role="dialog" aria-label={t.title} className={`info-pop${alignRight ? " align-right" : ""}`} onClick={(e) => e.stopPropagation()}>
          <span className="info-title">{t.title}</span>
          <span className="info-text">
            <RichText text={t.what} autolink self={t.wiki} />
          </span>
          {t.here && (
            <span className="info-text">
              <span className="info-label">On this dashboard</span>
              <RichText text={t.here} />
            </span>
          )}
          <span className="info-source">Source: {t.source}</span>
          {article && (
            <a className="info-wiki" href={wikiHref(article.id)} onClick={() => setOpen(false)}>
              How it works in the game: <strong>{article.title}</strong> in the Wiki
            </a>
          )}
        </span>
      )}
    </span>
  );
}
