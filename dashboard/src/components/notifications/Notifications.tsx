"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useAlertContext } from "@/components/alerts/AlertData";
import { AlertEditor } from "@/components/alerts/AlertEditor";
import { InsightList } from "@/components/insights/InsightList";
import { focusResource, showResource, usePrefs } from "@/components/live/PrefsProvider";
import { useResourceLabel } from "@/components/live/useMarketRows";
import { Modal } from "@/components/ui/Modal";
import { RichText } from "@/components/ui/RichText";
import { openModule } from "@/lib/client/moduleHash";
import { shouldIgnoreShortcut } from "@/lib/client/keyboard";
import { useStoredState } from "@/lib/client/useStoredState";
import { CREDITS_TARGET, describeCondition, describeRule, evaluateRule, formatAmount, sourceInfo, sourceLabel, type AlertRule } from "@/lib/crust/alerts";
import { stripMarkup } from "@/lib/crust/markup";
import { TOPICS } from "@/lib/crust/topics";
import { AREA_TEXT, LEVEL_ICON, LEVEL_TEXT, type Insight, type InsightArea } from "@/lib/crust/types";
import { WIKI_ENTRIES, wikiHref } from "@/lib/wiki/client";

export type Bucket = "urgent" | "pressing" | "recommended";

export const BUCKETS: { id: Bucket; label: string }[] = [
  { id: "urgent", label: "Urgent" },
  { id: "pressing", label: "Pressing" },
  { id: "recommended", label: "Recommended" },
];

export type Notice =
  | { kind: "alert"; id: string; signature: string; bucket: Bucket; title: string; meta: string; rule: AlertRule }
  | { kind: "finding"; id: string; signature: string; bucket: Bucket; title: string; meta: string; insight: Insight };

const AREA_MODULE: Record<InsightArea, { id: string; label: string }> = {
  cash: { id: "credits", label: "Credits" },
  networth: { id: "networth", label: "Net worth" },
  market: { id: "resources", label: "Resources" },
  production: { id: "resources", label: "Resources" },
  income: { id: "flows", label: "Income & spending" },
  capacity: { id: "buildings", label: "Buildings & capacity" },
};

export const OPEN_NOTIFICATIONS_EVENT = "crustdash:open-notifications";

/** Open the notification panel from anywhere, optionally filtered to one bucket. */
export function openNotifications(bucket?: Bucket) {
  window.dispatchEvent(new CustomEvent(OPEN_NOTIFICATIONS_EVENT, { detail: bucket ?? null }));
}

const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const bucketOf = (i: Insight): Bucket => (i.level === "critical" || i.level === "serious" ? "urgent" : i.level === "warning" ? "pressing" : "recommended");

const NO_DISMISSED: Record<string, string> = {};

/**
 * Everything that wants the Director's attention, sorted into three buckets:
 * urgent (alerts that fired, critical and serious findings), pressing (warnings), recommended (good moves with something to do).
 * Dismissing hides an item until it changes (a new firing, a new headline).
 */
export function useNotifications(insights: Insight[]) {
  const { alerts } = usePrefs();
  const labelOf = useResourceLabel();
  const [dismissedMap, setDismissed] = useStoredState("crustdash:notifications:dismissed", NO_DISMISSED);

  const all = useMemo<Notice[]>(() => {
    const fired: Notice[] = alerts
      .filter((a) => a.lastFiredAt != null && a.firedCount > 0)
      .sort((x, y) => (y.lastFiredAt ?? 0) - (x.lastFiredAt ?? 0))
      .map((rule) => ({
        kind: "alert",
        id: `alert-${rule.id}`,
        signature: String(rule.lastFiredAt),
        bucket: "urgent",
        title: describeRule(rule, labelOf),
        meta: `Alert fired at ${clock(rule.lastFiredAt ?? 0)}${rule.firedCount > 1 ? ` · ${rule.firedCount} times` : ""}`,
        rule,
      }));
    const findings: Notice[] = insights
      .filter((i) => bucketOf(i) !== "recommended" || i.actions.length > 0)
      .map((i) => ({
        kind: "finding",
        id: `finding-${i.id}`,
        signature: stripMarkup(i.title),
        bucket: bucketOf(i),
        title: stripMarkup(i.title),
        meta: `${LEVEL_TEXT[i.level]} · ${AREA_TEXT[i.area]}`,
        insight: i,
      }));
    const order: Record<Bucket, number> = { urgent: 0, pressing: 1, recommended: 2 };
    return [...fired, ...findings].sort((a, b) => order[a.bucket] - order[b.bucket]);
  }, [alerts, insights, labelOf]);

  const active = all.filter((n) => dismissedMap[n.id] !== n.signature);
  const dismissed = all.filter((n) => dismissedMap[n.id] === n.signature);
  const counts: Record<Bucket, number> = {
    urgent: active.filter((n) => n.bucket === "urgent").length,
    pressing: active.filter((n) => n.bucket === "pressing").length,
    recommended: active.filter((n) => n.bucket === "recommended").length,
  };
  const dismiss = useCallback((n: Notice) => setDismissed((d) => ({ ...d, [n.id]: n.signature })), [setDismissed]);
  const restore = useCallback(
    (n: Notice) =>
      setDismissed((d) => {
        const next = { ...d };
        delete next[n.id];
        return next;
      }),
    [setDismissed],
  );

  return { all, active, dismissed, counts, dismiss, restore };
}

export type Notifications = ReturnType<typeof useNotifications>;

function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.6 2H4.4L6 16Z M10 20.5a2.2 2.2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

type DetailProps = {
  notice: Notice;
  isDismissed: boolean;
  onClose: () => void;
  onDismiss: () => void;
  onRestore: () => void;
  onAlert: (target: string) => void;
};

/** The modal behind a notification: what it is, and buttons that take you there or do the thing. */
function NoticeDetail({ notice: n, isDismissed, onClose, onDismiss, onRestore, onAlert }: DetailProps) {
  const labelOf = useResourceLabel();
  const ctx = useAlertContext();
  const { updateAlert } = usePrefs();
  const bucket = BUCKETS.find((b) => b.id === n.bucket)?.label;
  const go = (fn: () => void) => {
    onClose();
    fn();
  };
  const openResource = (name: string) => go(() => showResource(name));

  const footer = (
    <div className="modal-actions">
      <button type="button" className="btn btn-quiet" onClick={isDismissed ? onRestore : onDismiss}>
        {isDismissed ? "Restore to notifications" : n.kind === "alert" ? "Mark as seen" : "Dismiss until it changes"}
      </button>
      <span className="spacer" />
      <button type="button" className="btn" onClick={onClose}>
        Close
      </button>
    </div>
  );

  if (n.kind === "alert") {
    const rule = n.rule;
    const source = rule.source;
    const resource = source.type === "resource" ? source.resource : null;
    const isCredits = source.type === "metric" && source.metric === "credits";
    const label = rule.name?.trim() || sourceLabel(source, labelOf);
    const info = sourceInfo(source);
    const ev = evaluateRule(rule, ctx);
    return (
      <div className="notify-detail">
        <p className={`notify-kicker b-${n.bucket}`}>
          <span aria-hidden>◆</span> {bucket} · Alert
        </p>
        <h2 className="modal-title">{label}</h2>
        <p className="notify-text">
          <RichText
            text={`Fires when it ${describeCondition(rule)}. ${ev.unavailable ? `Right now: _${ev.unavailable}_.` : `Right now: ==${formatAmount(info.unit, ev.value, info.flag)}==${ev.detail ? ` (${ev.detail})` : ""}.`}`}
          />
        </p>
        <p className="notify-meta">
          {n.meta}. {!rule.enabled ? "This alert is off." : rule.repeat ? "It fires again the next time the condition comes true." : "It was set to fire once."}
        </p>
        <div className="notify-actions">
          <span className="notify-actions-label">Take action</span>
          <div className="notify-action-grid">
            <button
              type="button"
              className="notify-action primary"
              data-autofocus
              onClick={() =>
                resource
                  ? openResource(resource)
                  : go(() => {
                      openModule("live");
                      if (isCredits) window.setTimeout(() => focusResource(CREDITS_TARGET), 60);
                    })
              }
            >
              {resource ? `Show ${labelOf(resource)} in Resources` : isCredits ? "Show live credits" : "Open Live now"}
            </button>
            {resource && (
              <button type="button" className="notify-action" onClick={() => go(() => openModule("calculator"))}>
                Price a trade in the Calculator
              </button>
            )}
            <button type="button" className="notify-action" onClick={() => go(() => openModule("alerts"))}>
              Manage alerts
            </button>
            {rule.enabled && (
              <button
                type="button"
                className="notify-action danger"
                onClick={() => {
                  updateAlert(rule.id, { enabled: false });
                  onDismiss();
                  onClose();
                }}
              >
                Turn this alert off
              </button>
            )}
          </div>
        </div>
        {footer}
      </div>
    );
  }

  const i = n.insight;
  const targets = i.subjects ?? [];
  const target = AREA_MODULE[i.area];
  const wikiId = TOPICS[i.topic]?.wiki;
  const wiki = wikiId ? WIKI_ENTRIES.get(wikiId) : undefined;

  return (
    <div className="notify-detail">
      <p className={`notify-kicker b-${n.bucket}`}>
        <span aria-hidden>{LEVEL_ICON[i.level]}</span> {bucket} · {AREA_TEXT[i.area]}
      </p>
      <InsightList insights={[i]} />
      <div className="notify-actions">
        <span className="notify-actions-label">Take action</span>
        <div className="notify-action-grid">
          {targets.length > 0 ? (
            targets.map((t, idx) => (
              <button key={t} type="button" className={`notify-action${idx === 0 ? " primary" : ""}`} data-autofocus={idx === 0 ? true : undefined} onClick={() => openResource(t)}>
                Show {labelOf(t)} in Resources
              </button>
            ))
          ) : (
            <button type="button" className="notify-action primary" data-autofocus onClick={() => go(() => openModule(target.id))}>
              Open {target.label}
            </button>
          )}
          {targets.length === 1 && (
            <button
              type="button"
              className="notify-action"
              onClick={() => {
                onClose();
                onAlert(targets[0]);
              }}
            >
              Set an alert on {labelOf(targets[0])}
            </button>
          )}
          {i.area === "market" && (
            <button type="button" className="notify-action" onClick={() => go(() => openModule("calculator"))}>
              Price it in the Calculator
            </button>
          )}
          <button type="button" className="notify-action" onClick={() => go(() => openModule(`findings/${i.area}`))}>
            All {AREA_TEXT[i.area].toLowerCase()} findings
          </button>
          {wiki && (
            <a className="notify-action" href={wikiHref(wiki.id)} onClick={onClose}>
              How it works: {wiki.title}
            </a>
          )}
        </div>
      </div>
      {footer}
    </div>
  );
}

type CenterProps = { notices: Notifications };

/** Status-bar bell: a compact panel of urgent, pressing and recommended items; each opens a modal to act on it. Shortcut: N. */
export function NotificationCenter({ notices }: CenterProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Bucket | "all">("all");
  const [showDismissed, setShowDismissed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [alerting, setAlerting] = useState<string | null>(null);
  const [top, setTop] = useState(56);
  const wrap = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const show = (bucket: Bucket | "all") => {
    const rect = toggle.current?.getBoundingClientRect();
    if (rect) setTop(rect.bottom + 8);
    setFilter(bucket);
    setShowDismissed(false);
    setOpen(true);
  };
  const showRef = useRef(show);
  useEffect(() => {
    showRef.current = show;
  });

  // Open from the Live summary, or with N anywhere outside a text field
  useEffect(() => {
    const onOpen = (e: Event) => showRef.current((e as CustomEvent<Bucket | null>).detail ?? "all");
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "n" || shouldIgnoreShortcut(e)) return;
      e.preventDefault();
      showRef.current("all");
    };
    window.addEventListener(OPEN_NOTIFICATIONS_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_NOTIFICATIONS_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // While open: outside click or Escape closes; focus lands on the first item
  useEffect(() => {
    if (!open) return;
    (list.current?.querySelector<HTMLElement>(".notify-row") ?? list.current?.querySelector<HTMLElement>(".notify-filters button"))?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pool = showDismissed ? notices.dismissed : notices.active;
  const shown = filter === "all" ? pool : pool.filter((n) => n.bucket === filter);
  const total = notices.active.length;
  const current = selected ? notices.all.find((n) => n.id === selected) ?? null : null;
  const isDismissed = current ? notices.dismissed.some((n) => n.id === current.id) : false;

  // Up/Down (and Home/End) move between items
  const onListKey = (e: ReactKeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const rows = [...(list.current?.querySelectorAll<HTMLElement>(".notify-row") ?? [])];
    if (!rows.length) return;
    e.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : e.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1);
    rows[next]?.focus();
  };

  const groups = BUCKETS.map((b) => ({ ...b, items: shown.filter((n) => n.bucket === b.id) })).filter((g) => g.items.length);

  return (
    <div className="notify" ref={wrap}>
      <button
        ref={toggle}
        type="button"
        className={`btn notify-toggle${notices.counts.urgent ? " has-urgent" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Notifications: ${notices.counts.urgent} urgent, ${notices.counts.pressing} pressing, ${notices.counts.recommended} recommended`}
        title="Notifications (N)"
        onClick={() => (open ? setOpen(false) : show("all"))}
      >
        <BellIcon />
        {total > 0 && <span className="notify-badge">{notices.counts.urgent || total}</span>}
      </button>

      {open && (
        <div className="notify-panel" role="dialog" aria-label="Notifications" style={{ top }} ref={list} onKeyDown={onListKey}>
          <div className="notify-head">
            <span className="notify-heading">{showDismissed ? "Dismissed" : "Notifications"}</span>
            <span className="notify-meta">{showDismissed ? `${notices.dismissed.length} hidden until they change` : total ? `${total} need a look` : "All clear"}</span>
            <button type="button" className="icon-btn" aria-label="Close notifications" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          <div className="notify-filters" role="group" aria-label="Filter notifications">
            {(["all", ...BUCKETS.map((b) => b.id)] as const).map((id) => {
              const count = id === "all" ? pool.length : pool.filter((n) => n.bucket === id).length;
              return (
                <button key={id} type="button" className={`chip-btn notify-filter b-${id}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                  {id === "all" ? "All" : BUCKETS.find((b) => b.id === id)?.label} {count}
                </button>
              );
            })}
          </div>

          {groups.length ? (
            <div className="notify-list">
              {groups.map((g) => (
                <section key={g.id} aria-label={g.label}>
                  {filter === "all" && <h3 className={`notify-group b-${g.id}`}>{g.label}</h3>}
                  <ul>
                    {g.items.map((n) => (
                      <li key={n.id}>
                        <button
                          type="button"
                          className={`notify-row b-${n.bucket}`}
                          onClick={() => {
                            setSelected(n.id);
                            setOpen(false);
                          }}
                        >
                          <span className="notify-mark" aria-hidden>
                            {n.kind === "alert" ? "◆" : LEVEL_ICON[n.insight.level]}
                          </span>
                          <span className="notify-title">{n.title}</span>
                          <span className="notify-meta">{n.meta}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <p className="notify-empty">
              {showDismissed ? "Nothing dismissed." : filter === "all" ? "All clear. Nothing needs you right now." : `No ${filter} items right now.`}
            </p>
          )}

          <div className="notify-foot">
            <button type="button" className="link-btn" onClick={() => setShowDismissed((s) => !s)}>
              {showDismissed ? "Back to notifications" : `Dismissed (${notices.dismissed.length})`}
            </button>
            <a href="#findings" onClick={() => setOpen(false)}>
              All findings
            </a>
            <a href="#alerts" onClick={() => setOpen(false)}>
              Alerts
            </a>
          </div>
        </div>
      )}

      <Modal open={selected != null} onClose={() => setSelected(null)} label={current ? `Notification: ${current.title}` : "Notification"} size="md">
        {current ? (
          <NoticeDetail
            notice={current}
            isDismissed={isDismissed}
            onClose={() => setSelected(null)}
            onDismiss={() => {
              notices.dismiss(current);
              setSelected(null);
            }}
            onRestore={() => notices.restore(current)}
            onAlert={setAlerting}
          />
        ) : (
          <div className="notify-detail">
            <p className="notify-text">This has cleared since you opened it.</p>
            <div className="modal-actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      {alerting && (
        <AlertEditor resource={alerting} onClose={() => setAlerting(null)} />
      )}
    </div>
  );
}

/** Compact counts for the Live module; each opens the panel on that bucket. */
export function NotificationSummary({ counts }: { counts: Record<Bucket, number> }) {
  const total = counts.urgent + counts.pressing + counts.recommended;
  return (
    <div className="notify-summary" role="group" aria-label="Notifications">
      {BUCKETS.map((b) => (
        <button key={b.id} type="button" className={`notify-chip b-${b.id}`} onClick={() => openNotifications(b.id)}>
          <strong>{counts[b.id]}</strong> {b.label.toLowerCase()}
        </button>
      ))}
      <span className="spacer" />
      <button type="button" className="link-btn notify-open" onClick={() => openNotifications()}>
        {total ? "Open notifications" : "Notifications"} <kbd className="command-hint">N</kbd>
      </button>
    </div>
  );
}
