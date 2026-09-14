"use client";

import { useState } from "react";
import { usePrefs } from "@/components/live/PrefsProvider";
import { playChime, unlockAudio } from "@/lib/client/sound";
import { ALERT_TEMPLATES, describeRule, evaluateRule, formatAmount, sourceGroup, sourceInfo, usesBaseline, type AlertDraft, type AlertRule } from "@/lib/crust/alerts";
import { useAlertContext } from "./AlertData";
import { AlertEditor } from "./AlertEditor";

type Editing = { rule?: AlertRule; template?: AlertDraft };
const GROUP_ORDER = ["Resources", "Economy", "Colony", "Missions", "Market", "Game", "Assistant", "Game values"];

/** Every alert, grouped by what it watches: live value, status, edit, on/off, delete. Plus templates and sound settings. */
export function AlertsPanel() {
  const ctx = useAlertContext();
  const { alerts, updateAlert, removeAlert, sound, setSound } = usePrefs();
  const [editing, setEditing] = useState<Editing | null>(null);

  const groups = GROUP_ORDER.map((g) => ({ name: g, items: alerts.filter((a) => sourceGroup(a.source) === g) })).filter((g) => g.items.length);

  return (
    <div className="alerts-panel">
      <div className="toolbar">
        <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>
          New alert
        </button>
        <span className="muted">Watch prices, stock, credits, power, CPU, missions, the game itself or any game value.</span>
        <span className="spacer" />
        <label className="check-row">
          <input type="checkbox" checked={sound.enabled} onChange={(e) => setSound({ ...sound, enabled: e.target.checked })} />
          Sound
        </label>
        <label className="check-row">
          <span className="sr-only">Volume</span>
          <input type="range" min={0} max={1} step={0.05} value={sound.volume} disabled={!sound.enabled} onChange={(e) => setSound({ ...sound, volume: Number(e.target.value) })} aria-label="Alert volume" />
        </label>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => {
            unlockAudio();
            playChime(sound.volume);
          }}
        >
          Test sound
        </button>
      </div>

      <section className="alert-templates" aria-label="Quick start">
        <span className="field-label">Quick start</span>
        <div className="alert-template-chips">
          {ALERT_TEMPLATES.map((t) => (
            <button key={t.id} type="button" className="chip-btn" title={t.hint} onClick={() => setEditing({ template: t.draft(ctx) })}>
              + {t.label}
            </button>
          ))}
        </div>
      </section>

      {alerts.length === 0 ? (
        <p className="empty">No alerts yet. Start from a quick-start idea above, or build your own with New alert. Alerts only fire while this dashboard is open in a browser tab.</p>
      ) : (
        groups.map((g) => (
          <section key={g.name} className="alerts-group" aria-label={g.name}>
            <h3 className="alerts-group-title">{g.name}</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Alert</th>
                    <th className="num">Now</th>
                    <th>Status</th>
                    <th>Repeats</th>
                    <th className="num">Fired</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((a) => {
                    const info = sourceInfo(a.source);
                    const ev = evaluateRule(a, ctx);
                    const status = !a.enabled
                      ? { text: a.firedCount && !a.repeat ? "Done" : "Off", cls: "status-off" }
                      : ev.unavailable
                        ? { text: ev.unavailable, cls: "status-wait" }
                        : usesBaseline(a) || info.unit === "flag"
                          ? { text: "Watching for a change", cls: "status-on" }
                          : a.armed
                            ? { text: ev.met ? "Firing" : "Watching", cls: "status-on" }
                            : { text: "Waiting to re-arm", cls: "status-wait" };
                    const label = describeRule(a, ctx.resourceLabel);
                    return (
                      <tr key={a.id}>
                        <td className="wrap-cell">{label}</td>
                        <td className="num">
                          {formatAmount(info.unit, ev.value, info.flag)}
                          {ev.detail && <span className="cell-sub">{ev.detail}</span>}
                        </td>
                        <td>
                          <span className={`status-pill ${status.cls}`}>{status.text}</span>
                        </td>
                        <td>{a.repeat ? "Every time" : "Once"}</td>
                        <td className="num">{a.firedCount}</td>
                        <td>
                          <div className="row-actions">
                            <button type="button" className="btn btn-quiet" onClick={() => setEditing({ rule: a })}>
                              Edit
                            </button>
                            <label className="check-row">
                              <input
                                type="checkbox"
                                checked={a.enabled}
                                onChange={(e) => updateAlert(a.id, { enabled: e.target.checked, armed: true })}
                                aria-label={`Turn “${label}” ${a.enabled ? "off" : "on"}`}
                              />
                              On
                            </label>
                            <button type="button" className="btn btn-quiet danger" onClick={() => removeAlert(a.id)}>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      {editing && <AlertEditor rule={editing.rule} template={editing.template} onClose={() => setEditing(null)} />}
    </div>
  );
}
