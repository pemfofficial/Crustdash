"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { usePrefs } from "@/components/live/PrefsProvider";
import {
  ALERT_GROUPS,
  CREDITS_TARGET,
  KIND_DEFS,
  describeRule,
  evaluateRule,
  finalizeAlert,
  formatValue,
  type AlertKind,
  type AlertRule,
  type AlertSubject,
} from "@/lib/crust/alerts";

type Props = {
  /** Resource name, or CREDITS_TARGET for credit alerts. */
  target: string;
  label: string;
  subject: AlertSubject | null;
  credits: number | null;
  onClose: () => void;
};

/** Create alerts for one resource (or credits), grouped by what they watch, and manage existing ones. */
export function AlertEditor({ target, label, subject, credits, onClose }: Props) {
  const { alerts, addAlert, updateAlert, removeAlert } = usePrefs();
  const isCredits = target === CREDITS_TARGET;
  const groups = ALERT_GROUPS.filter((g) => (isCredits ? g.id === "credits" : g.id !== "credits"));
  const firstKind = groups[0].kinds[0].kind;

  const [kind, setKind] = useState<AlertKind>(firstKind);
  const [threshold, setThreshold] = useState(() => String(KIND_DEFS[firstKind].suggest(subject, credits)));
  const [repeat, setRepeat] = useState(true);

  const def = KIND_DEFS[kind];
  const draft: AlertRule = {
    id: "draft",
    kind,
    target,
    threshold: Number(threshold),
    repeat,
    enabled: true,
    armed: true,
    createdAt: 0,
    lastFiredAt: null,
    firedCount: 0,
  };
  const now = evaluateRule(draft, subject, credits);
  const valid = threshold.trim() !== "" && Number.isFinite(Number(threshold));
  const existing = useMemo(() => alerts.filter((a) => a.target === target), [alerts, target]);

  const pickKind = (k: AlertKind) => {
    setKind(k);
    setThreshold(String(KIND_DEFS[k].suggest(subject, credits)));
  };

  const create = () => {
    if (!valid) return;
    addAlert(finalizeAlert(draft));
    onClose();
  };

  return (
    <Modal open onClose={onClose} label={`Alerts for ${label}`} size="lg">
      <div className="modal-head">
        <h2 className="modal-title">Set an alert · {label}</h2>
        <p className="modal-sub">
          You’ll hear a chime and get a pop-up the moment the condition becomes true while this dashboard is open.
        </p>
      </div>

      <div className="alert-groups">
        {groups.map((g) => (
          <fieldset key={g.id} className="alert-group">
            <legend className="field-label">{g.label}</legend>
            <p className="field-hint">{g.blurb}</p>
            <div className="radio-cards">
              {g.kinds.map((k) => {
                const probe = evaluateRule({ ...draft, kind: k.kind, threshold: 0 }, subject, credits);
                return (
                  <label key={k.kind} className={`radio-card${kind === k.kind ? " checked" : ""}${probe.unavailable ? " unavailable" : ""}`}>
                    <input type="radio" name="alert-kind" checked={kind === k.kind} onChange={() => pickKind(k.kind)} />
                    <span className="radio-title">{k.label}</span>
                    <span className="radio-hint">{probe.unavailable ?? k.hint}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="alert-config">
        <label className="field">
          <span className="field-label">{def.label}</span>
          <span className="input-with-unit">
            {kind === "vsBaseBelow" && <span className="unit">−</span>}
            <input type="number" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} data-autofocus />
            <span className="unit">{def.unit === "credits" ? "credits" : def.unit === "percent" ? "%" : "units"}</span>
          </span>
          <span className="field-hint">
            Right now: <strong>{formatValue(kind, now.value)}</strong>
            {now.unavailable ? ` · ${now.unavailable}` : now.met ? " · already true, so it will fire straight away" : ""}
          </span>
        </label>

        <fieldset className="field">
          <legend className="field-label">How often</legend>
          <label className="check-row">
            <input type="radio" name="alert-repeat" checked={repeat} onChange={() => setRepeat(true)} />
            <span><strong>Every time</strong> it becomes true (re-arms after the condition clears)</span>
          </label>
          <label className="check-row">
            <input type="radio" name="alert-repeat" checked={!repeat} onChange={() => setRepeat(false)} />
            <span><strong>Once</strong>, then switch the alert off</span>
          </label>
        </fieldset>
      </div>

      {existing.length > 0 && (
        <div className="existing-alerts">
          <span className="field-label">Existing alerts for {label}</span>
          <ul className="alert-list compact">
            {existing.map((a) => (
              <li key={a.id}>
                <span>{describeRule(a, label)}</span>
                <label className="check-row">
                  <input type="checkbox" checked={a.enabled} onChange={(e) => updateAlert(a.id, { enabled: e.target.checked, armed: true })} />
                  On
                </label>
                <button type="button" className="btn btn-quiet danger" onClick={() => removeAlert(a.id)}>Delete</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="modal-actions">
        <span className="spacer" />
        <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={create} disabled={!valid}>Create alert</button>
      </div>
    </Modal>
  );
}
