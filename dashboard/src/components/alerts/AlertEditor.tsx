"use client";

import { useId, useMemo, useState } from "react";
import { usePrefs } from "@/components/live/PrefsProvider";
import { Modal } from "@/components/ui/Modal";
import {
  ALERT_TEMPLATES,
  COMPARATOR_TEXT,
  METRICS,
  METRIC_GROUPS,
  RESOURCE_FIELDS,
  evaluateRule,
  finalizeAlert,
  formatAmount,
  glossaryLabel,
  readSource,
  sourceInfo,
  usesBaseline,
  type AlertDraft,
  type AlertRule,
  type AlertSource,
  type Comparator,
  type MetricGroup,
  type MetricId,
  type ResourceField,
} from "@/lib/crust/alerts";
import { useAlertContext } from "./AlertData";

type Category = "Resources" | MetricGroup | "Game values";
const CATEGORIES: Category[] = ["Resources", ...METRIC_GROUPS, "Game values"];
const CATEGORY_HINT: Record<Category, string> = {
  Resources: "Prices, supply and stock for one resource.",
  Economy: "Credits, net worth, reputation.",
  Colony: "Power, CPU, drones, colonists, research.",
  Missions: "Missions starting, steps finishing, progress.",
  Market: "The whole market: best prices and scarcity.",
  Game: "Paused, disconnected, the in-game calendar.",
  Assistant: "Notifications and your task list.",
  "Game values": "Any number the game reports, by name.",
};

type Props = {
  /** Edit this rule instead of creating one. */
  rule?: AlertRule;
  /** Start a new alert on this resource. */
  resource?: string;
  /** Start from a template's settings. */
  template?: AlertDraft;
  onClose: () => void;
};

const categoryOf = (source: AlertSource): Category => (source.type === "resource" ? "Resources" : source.type === "glossary" ? "Game values" : METRICS[source.metric].group);
const toDateInput = (v: number) => `${Math.floor(v / 10000)}-${String(Math.floor((v % 10000) / 100)).padStart(2, "0")}-${String(v % 100).padStart(2, "0")}`;
const fromDateInput = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return y && m && d ? y * 10000 + m * 100 + d : NaN;
};

/** Build or edit an alert: pick what to watch, the condition and the value; see the live value as you go. */
export function AlertEditor({ rule, resource, template, onClose }: Props) {
  const ctx = useAlertContext();
  const { alerts, addAlert, updateAlert } = usePrefs();
  const ids = useId();
  const resources = useMemo(() => [...ctx.subjects.values()].sort((a, b) => a.label.localeCompare(b.label)), [ctx.subjects]);

  const start: AlertSource =
    rule?.source ?? template?.source ?? (resource ? { type: "resource", resource, field: "sell" } : { type: "metric", metric: "credits" });
  const [category, setCategory] = useState<Category>(categoryOf(start));
  const [resourceName, setResourceName] = useState(start.type === "resource" ? start.resource : (resource ?? resources[0]?.name ?? ""));
  const [field, setField] = useState<ResourceField>(start.type === "resource" ? start.field : "sell");
  const [metric, setMetric] = useState<MetricId>(start.type === "metric" ? start.metric : "credits");
  const [address, setAddress] = useState(start.type === "glossary" ? start.address : "");
  const [search, setSearch] = useState("");
  const [comparator, setComparator] = useState<Comparator>(rule?.comparator ?? template?.comparator ?? "atLeast");
  const [threshold, setThreshold] = useState<string>(() => {
    if (rule) return String(rule.threshold);
    if (template) return String(template.threshold);
    const info = sourceInfo(start);
    const current = readSource(start, ctx).value;
    return String(start.type === "resource" ? RESOURCE_FIELDS[start.field].suggest(ctx.subjects.get(start.resource) ?? null) : start.type === "metric" ? METRICS[start.metric].suggest(current) : info.unit === "count" ? (current ?? 0) : 0);
  });
  const [name, setName] = useState(rule?.name ?? "");
  const [repeat, setRepeat] = useState(rule?.repeat ?? template?.repeat ?? true);

  const source: AlertSource | null =
    category === "Resources"
      ? resourceName
        ? { type: "resource", resource: resourceName, field }
        : null
      : category === "Game values"
        ? address
          ? { type: "glossary", address }
          : null
        : { type: "metric", metric };
  const info = source ? sourceInfo(source) : null;
  const allowed = info?.comparators ?? ["atLeast"];
  const activeComparator = allowed.includes(comparator) ? comparator : allowed[0];
  const needsThreshold = COMPARATOR_TEXT[activeComparator].needsThreshold;
  const thresholdValue = info?.unit === "date" ? fromDateInput(threshold) : Number(threshold);
  const valid = source != null && (!needsThreshold || (threshold.trim() !== "" && Number.isFinite(thresholdValue)));

  const draft: AlertDraft | null = source ? { source, comparator: activeComparator, threshold: needsThreshold ? thresholdValue : 0, repeat, name: name.trim() || undefined } : null;
  const reading = source ? readSource(source, ctx) : null;
  const preview = draft ? evaluateRule({ ...draft, id: "draft", enabled: true, armed: true, createdAt: 0, lastFiredAt: null, firedCount: 0 }, ctx, reading?.value ?? null) : null;

  // A new "what to watch" suggests a sensible value
  const suggestFor = (next: AlertSource) => {
    if (rule) return;
    const current = readSource(next, ctx).value;
    const nextInfo = sourceInfo(next);
    const suggested =
      next.type === "resource"
        ? RESOURCE_FIELDS[next.field].suggest(ctx.subjects.get(next.resource) ?? null)
        : next.type === "metric"
          ? METRICS[next.metric].suggest(current)
          : (current ?? 0);
    setThreshold(nextInfo.unit === "date" ? toDateInput(suggested) : String(suggested));
    if (!nextInfo.comparators.includes(comparator)) setComparator(nextInfo.comparators[0]);
  };

  const applyTemplate = (t: AlertDraft) => {
    const cat = categoryOf(t.source);
    setCategory(cat);
    if (t.source.type === "metric") setMetric(t.source.metric);
    setComparator(t.comparator);
    const unit = sourceInfo(t.source).unit;
    setThreshold(unit === "date" ? toDateInput(t.threshold) : String(t.threshold));
    setRepeat(t.repeat);
  };

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.entries(ctx.glossary)
      .filter(([a]) => !q || a.toLowerCase().includes(q) || glossaryLabel(a).toLowerCase().includes(q))
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 40);
  }, [ctx.glossary, search]);

  const save = () => {
    if (!draft || !valid) return;
    if (rule) updateAlert(rule.id, { ...draft, name: draft.name, armed: true });
    else addAlert(finalizeAlert(draft));
    onClose();
  };

  const resourceAlerts = resourceName ? alerts.filter((a) => a.source.type === "resource" && a.source.resource === resourceName).length : 0;
  const title = rule ? "Edit alert" : resource ? `New alert · ${ctx.resourceLabel(resource)}` : "New alert";

  return (
    <Modal open onClose={onClose} label={title} size="lg">
      <div className="alert-editor">
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <p className="modal-sub">A chime and a pop-up tell you the moment the condition becomes true, while this dashboard is open.</p>
        </div>

        {!rule && !resource && !template && (
          <section className="alert-templates" aria-labelledby={`${ids}-quick`}>
            <h3 id={`${ids}-quick`} className="field-label">
              Quick start
            </h3>
            <div className="alert-template-chips">
              {ALERT_TEMPLATES.map((t) => (
                <button key={t.id} type="button" className="chip-btn" title={t.hint} onClick={() => applyTemplate(t.draft(ctx))}>
                  {t.label}
                </button>
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby={`${ids}-what`} className="alert-step">
          <h3 id={`${ids}-what`} className="alert-step-title">
            What to watch
          </h3>
          <div className="alert-tabs" role="tablist" aria-label="Kind of value">
            {CATEGORIES.map((c) => (
              <button key={c} type="button" role="tab" aria-selected={category === c} className="alert-tab" onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
          <p className="field-hint">{CATEGORY_HINT[category]}</p>

          {category === "Resources" && (
            <>
              <label className="field">
                <span className="field-label">Resource</span>
                <select
                  className="text-input"
                  value={resourceName}
                  onChange={(e) => {
                    setResourceName(e.target.value);
                    suggestFor({ type: "resource", resource: e.target.value, field });
                  }}
                >
                  {!resourceName && <option value="">Choose a resource</option>}
                  {resources.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.label}
                    </option>
                  ))}
                </select>
                {resourceAlerts > 0 && !rule && <span className="field-hint">{resourceAlerts} alert{resourceAlerts === 1 ? "" : "s"} already set for this resource.</span>}
              </label>
              <div className="radio-cards alert-options">
                {(Object.keys(RESOURCE_FIELDS) as ResourceField[]).map((f) => {
                  const probe = resourceName ? readSource({ type: "resource", resource: resourceName, field: f }, ctx) : null;
                  return (
                    <label key={f} className={`radio-card${field === f ? " checked" : ""}${probe?.unavailable ? " unavailable" : ""}`}>
                      <input
                        type="radio"
                        name={`${ids}-field`}
                        checked={field === f}
                        onChange={() => {
                          setField(f);
                          suggestFor({ type: "resource", resource: resourceName, field: f });
                        }}
                      />
                      <span className="radio-title">{RESOURCE_FIELDS[f].label}</span>
                      <span className="radio-hint">{probe?.unavailable ?? `Now ${formatAmount(RESOURCE_FIELDS[f].unit, probe?.value ?? null)}`}</span>
                    </label>
                  );
                })}
              </div>
            </>
          )}

          {METRIC_GROUPS.includes(category as MetricGroup) && (
            <div className="radio-cards alert-options">
              {(Object.keys(METRICS) as MetricId[])
                .filter((id) => METRICS[id].group === category)
                .map((id) => {
                  const def = METRICS[id];
                  const probe = def.read(ctx);
                  return (
                    <label key={id} className={`radio-card${metric === id ? " checked" : ""}${probe.unavailable ? " unavailable" : ""}`}>
                      <input
                        type="radio"
                        name={`${ids}-metric`}
                        checked={metric === id}
                        onChange={() => {
                          setMetric(id);
                          suggestFor({ type: "metric", metric: id });
                        }}
                      />
                      <span className="radio-title">{def.label}</span>
                      <span className="radio-hint">{probe.unavailable ?? `Now ${formatAmount(def.unit, probe.value, def.flag)}${probe.detail ? ` (${probe.detail})` : ""}`}</span>
                    </label>
                  );
                })}
            </div>
          )}

          {category === "Game values" && (
            <div className="alert-picker">
              <input className="text-input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search values, e.g. Stats, Quest, Research" aria-label="Search game values" />
              {Object.keys(ctx.glossary).length === 0 ? (
                <p className="field-hint">The game hasn’t reported any values yet. Start the game and load a save.</p>
              ) : (
                <ul className="alert-picker-list" role="listbox" aria-label="Game values">
                  {matches.map(([a, entry]) => (
                    <li key={a} role="option" aria-selected={address === a}>
                      <button
                        type="button"
                        className={`alert-picker-row${address === a ? " is-selected" : ""}`}
                        onClick={() => {
                          setAddress(a);
                          suggestFor({ type: "glossary", address: a });
                        }}
                      >
                        <span className="alert-picker-name">{glossaryLabel(a)}</span>
                        <span className="alert-picker-address">{a}</span>
                        <span className="alert-picker-value">{formatAmount("count", entry.value)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section aria-labelledby={`${ids}-when`} className="alert-step alert-config">
          <h3 id={`${ids}-when`} className="alert-step-title">
            When
          </h3>
          {source && info ? (
            <>
              <div className="alert-condition">
                <select className="text-input" value={activeComparator} onChange={(e) => setComparator(e.target.value as Comparator)} aria-label="Condition">
                  {allowed.map((c) => (
                    <option key={c} value={c}>
                      {COMPARATOR_TEXT[c].label}
                    </option>
                  ))}
                </select>
                {needsThreshold &&
                  (info.unit === "flag" && info.flag ? (
                    <select className="text-input" value={threshold} onChange={(e) => setThreshold(e.target.value)} aria-label="Value">
                      <option value="1">{info.flag[0]}</option>
                      <option value="0">{info.flag[1]}</option>
                    </select>
                  ) : info.unit === "date" ? (
                    <input className="text-input" type="date" value={threshold} min="2070-01-01" onChange={(e) => setThreshold(e.target.value)} aria-label="In-game date" />
                  ) : (
                    <span className="input-with-unit">
                      <input type="number" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} aria-label="Value" data-autofocus />
                      <span className="unit">{info.unit === "credits" ? "credits" : info.unit === "percent" || info.unit === "signedPercent" ? "%" : info.unit === "perDay" ? "a day" : ""}</span>
                    </span>
                  ))}
              </div>
              <p className="field-hint">{info.hint}</p>
              <p className="field-hint">
                Right now: <strong>{reading?.unavailable ?? formatAmount(info.unit, reading?.value ?? null, info.flag)}</strong>
                {reading?.detail ? ` (${reading.detail})` : ""}
                {usesBaseline({ comparator: activeComparator })
                  ? ". It measures from the value when the alert is set."
                  : preview?.met
                    ? ". Already true, so it fires straight away."
                    : "."}
              </p>
            </>
          ) : (
            <p className="field-hint">{category === "Game values" ? "Pick a game value above." : "Pick a resource above."}</p>
          )}

          <label className="field">
            <span className="field-label">Name (optional)</span>
            <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sell titanium plates" maxLength={80} />
          </label>

          <fieldset className="field">
            <legend className="field-label">How often</legend>
            <label className="check-row">
              <input type="radio" name={`${ids}-repeat`} checked={repeat} onChange={() => setRepeat(true)} />
              <span>
                <strong>Every time</strong> it becomes true
              </span>
            </label>
            <label className="check-row">
              <input type="radio" name={`${ids}-repeat`} checked={!repeat} onChange={() => setRepeat(false)} />
              <span>
                <strong>Once</strong>, then switch the alert off
              </span>
            </label>
          </fieldset>
        </section>

        <div className="modal-actions">
          <span className="spacer" />
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!valid}>
            {rule ? "Save changes" : "Create alert"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
