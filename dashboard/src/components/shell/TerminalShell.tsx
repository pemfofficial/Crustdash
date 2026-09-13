"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { InfoTip } from "@/components/ui/InfoTip";
import { OPEN_SECTION_EVENT } from "@/components/ui/Section";
import { shouldIgnoreShortcut } from "@/lib/client/keyboard";
import { openModule, splitModuleHash, useModuleHash } from "@/lib/client/moduleHash";
import { useMounted } from "@/lib/client/useMounted";
import type { TopicId } from "@/lib/crust/topics";

export { openModule, useModuleHash };

export type ModuleDef = {
  id: string;
  label: string;
  /** Menu heading the module sits under (Colony, Assistant, Reference, Tools). */
  group: string;
  summary?: string;
  info?: TopicId;
  badge?: ReactNode;
  headerActions?: ReactNode;
  content: ReactNode;
};

export type CommandItem = { id: string; label: string; group: string; keywords?: string; run: () => void };

export function CraterMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {/* A cratered moon: craters placed off-balance so it never reads as a face */}
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="9.2" cy="14.2" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="15.8" cy="8.4" r="1.9" fill="currentColor" />
      <circle cx="16.6" cy="15.6" r="1" fill="currentColor" />
      <circle cx="7.4" cy="7.2" r="0.9" fill="currentColor" />
    </svg>
  );
}

/** Slide-out panel. Rendered into document.body: the status bar's backdrop blur would otherwise clip fixed children. */
export function Drawer({ side, label, onClose, children }: { side: "left" | "right"; label: string; onClose: () => void; children: ReactNode }) {
  const mounted = useMounted();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("[aria-current='page'], button, input, select, a[href]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);
  if (!mounted) return null;
  return createPortal(
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} className={`drawer drawer-${side}`}>
        <div className="drawer-head">
          <span className="drawer-title">{label}</span>
          <button type="button" className="icon-btn" aria-label={`Close ${label.toLowerCase()}`} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

const scoreCommand = (c: CommandItem, q: string) => {
  const label = c.label.toLowerCase();
  const words = `${label} ${c.keywords ?? ""}`.toLowerCase();
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (words.split(/\s+/).some((w) => w.startsWith(q))) return 60;
  return words.includes(q) ? 40 : 0;
};

function CommandLine({ commands }: { commands: CommandItem[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  // "/" anywhere (outside a text field) jumps to the command line
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || shouldIgnoreShortcut(e, { overOverlays: true })) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.filter((c) => c.group === "Modules");
    return commands
      .map((c) => ({ c, score: scoreCommand(c, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((x) => x.c);
  }, [query, commands]);
  const active = Math.min(index, Math.max(0, matches.length - 1));
  const expanded = open && matches.length > 0;

  const run = (c: CommandItem) => {
    c.run();
    setQuery("");
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className="command">
      <span className="command-prompt" aria-hidden>
        ›
      </span>
      <input
        ref={input}
        className="command-input"
        role="combobox"
        aria-label="Command line: jump to a module, resource, wiki article, range or theme"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
        placeholder="Jump to a module, resource or wiki article: try steel, cpu or range 30"
        value={query}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setIndex(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setIndex(Math.min(matches.length - 1, active + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex(Math.max(0, active - 1));
          } else if (e.key === "Enter" && matches[active]) {
            e.preventDefault();
            run(matches[active]);
          } else if (e.key === "Escape") {
            setQuery("");
            setOpen(false);
          }
        }}
      />
      <kbd className="command-hint" aria-hidden>
        /
      </kbd>
      {expanded && (
        <ul id={listId} role="listbox" className="command-list">
          {matches.map((c, i) => (
            <li
              key={c.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="command-option"
              onMouseDown={(e) => {
                e.preventDefault();
                run(c);
              }}
              onMouseEnter={() => setIndex(i)}
            >
              <span className="command-group">{c.group}</span>
              <span>{c.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Props = {
  title: string;
  status: ReactNode;
  tools: ReactNode;
  modules: ModuleDef[];
  defaultModule: string;
  sidebarFooter?: ReactNode;
  commands: CommandItem[];
  calculator: ReactNode;
};

/** The colony terminal: status bar, grouped module menu (a slide-out drawer on small screens), command line, one module at a time. */
export function TerminalShell({ title, status, tools, modules, defaultModule, sidebarFooter, commands, calculator }: Props) {
  const [hashModule] = splitModuleHash(useModuleHash());
  const active = modules.some((m) => m.id === hashModule) ? hashModule : defaultModule;
  const [menuOpen, setMenuOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeCalc = useCallback(() => setCalcOpen(false), []);
  const ids = modules.map((m) => m.id).join(",");

  // Anything that asks for a section by id (alerts, pinned cards) switches to that module
  useEffect(() => {
    const known = new Set(ids.split(","));
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (known.has(id)) openModule(id);
    };
    window.addEventListener(OPEN_SECTION_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SECTION_EVENT, onOpen);
  }, [ids]);

  const go = (id: string) => {
    openModule(id);
    setMenuOpen(false);
    window.scrollTo({ top: 0 });
  };

  const groups = modules.reduce<{ name: string; items: ModuleDef[] }[]>((acc, m) => {
    const last = acc[acc.length - 1];
    if (last && last.name === m.group) last.items.push(m);
    else acc.push({ name: m.group, items: [m] });
    return acc;
  }, []);

  const nav = (
    <nav className="module-nav" aria-label="Modules">
      {groups.map((g) => (
        <div key={g.name} className="module-nav-section">
          <span className="module-nav-group" id={`nav-group-${g.name}`}>
            {g.name}
          </span>
          <ul aria-labelledby={`nav-group-${g.name}`}>
            {g.items.map((m) => (
              <li key={m.id}>
                <button type="button" className="module-link" aria-current={m.id === active ? "page" : undefined} onClick={() => go(m.id)}>
                  <span className="module-link-label">{m.label}</span>
                  {m.badge != null && <span className="module-badge">{m.badge}</span>}
                  {m.summary && <span className="module-link-sub">{m.summary}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="terminal">
      <a href="#module-main" className="skip-link">
        Skip to the module
      </a>
      <header className="statusbar">
        <button type="button" className="icon-btn hamburger" aria-label="Open the module menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
            <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <div className="statusbar-brand">
          <CraterMark />
          <span className="brand-text">Director’s terminal</span>
          <span className="brand-save">{title}</span>
        </div>
        <div className="statusbar-status">{status}</div>
        <div className="statusbar-tools">
          <button type="button" className="btn calc-toggle" aria-expanded={calcOpen} onClick={() => setCalcOpen((o) => !o)}>
            Calculator
          </button>
          {tools}
        </div>
      </header>

      <div className="terminal-body">
        <aside className="sidebar">
          {nav}
          {sidebarFooter && <div className="sidebar-footer">{sidebarFooter}</div>}
        </aside>
        <main id="module-main" className="workspace">
          <CommandLine commands={commands} />
          {modules.map((m) => (
            <section key={m.id} id={`module-${m.id}`} className="module" hidden={m.id !== active} aria-labelledby={`module-title-${m.id}`}>
              <header className="module-head">
                <h1 id={`module-title-${m.id}`} className="module-title">
                  {m.label}
                </h1>
                {m.info && <InfoTip topic={m.info} label={m.label} />}
                {m.headerActions && <div className="module-actions">{m.headerActions}</div>}
                {m.summary && <p className="module-summary">{m.summary}</p>}
              </header>
              <div className="module-body">{m.content}</div>
            </section>
          ))}
        </main>
      </div>

      {menuOpen && (
        <Drawer side="left" label="Modules" onClose={closeMenu}>
          {nav}
          {sidebarFooter}
        </Drawer>
      )}
      {calcOpen && (
        <Drawer side="right" label="Calculator" onClose={closeCalc}>
          {calculator}
        </Drawer>
      )}
    </div>
  );
}
