"use client";

import { useState } from "react";
import { useLive } from "@/components/live/LiveProvider";
import { usePrefs } from "@/components/live/PrefsProvider";
import { useAlertSubjects } from "@/components/live/useMarketRows";
import { playChime, unlockAudio } from "@/lib/client/sound";
import { CREDITS_TARGET, KIND_DEFS, describeRule, evaluateRule, formatValue } from "@/lib/crust/alerts";
import { AlertEditor } from "./AlertEditor";

/** Every alert in one list: live value, status, on/off, delete; plus sound settings and a credits alert shortcut. */
export function AlertsPanel({ holdings, holdingsSource }: { holdings: Record<string, number>; holdingsSource: "live" | "save" }) {
  const live = useLive();
  const { alerts, updateAlert, removeAlert, sound, setSound } = usePrefs();
  const subjects = useAlertSubjects(holdings, holdingsSource);
  const [editingCredits, setEditingCredits] = useState(false);

  return (
    <div className="alerts-panel">
      <div className="toolbar">
        <button type="button" className="btn" onClick={() => setEditingCredits(true)}>+ Credits alert</button>
        <span className="muted">Add resource alerts with the bell button in the Resources table.</span>
        <span className="spacer" />
        <label className="check-row">
          <input type="checkbox" checked={sound.enabled} onChange={(e) => setSound({ ...sound, enabled: e.target.checked })} />
          Sound
        </label>
        <label className="check-row">
          <span className="sr-only">Volume</span>
          <input type="range" min={0} max={1} step={0.05} value={sound.volume} disabled={!sound.enabled} onChange={(e) => setSound({ ...sound, volume: Number(e.target.value) })} aria-label="Alert volume" />
        </label>
        <button type="button" className="btn btn-quiet" onClick={() => { unlockAudio(); playChime(sound.volume); }}>Test sound</button>
      </div>

      {alerts.length === 0 ? (
        <p className="empty">No alerts yet. Alerts only fire while this dashboard is open in a browser tab.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Alert</th>
                <th className="num">Now</th>
                <th>Status</th>
                <th>Repeats</th>
                <th className="num">Fired</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => {
                const subject = a.target === CREDITS_TARGET ? null : subjects.get(a.target) ?? null;
                const label = a.target === CREDITS_TARGET ? "Credits" : subject?.label ?? a.target;
                const ev = evaluateRule(a, subject, live.credits);
                const status = !a.enabled
                  ? { text: a.firedCount && !a.repeat ? "Done" : "Off", cls: "status-off" }
                  : ev.unavailable
                    ? { text: ev.unavailable, cls: "status-wait" }
                    : a.armed
                      ? { text: ev.met ? "Firing" : "Watching", cls: "status-on" }
                      : { text: "Waiting to re-arm", cls: "status-wait" };
                return (
                  <tr key={a.id}>
                    <td>{describeRule(a, label)}</td>
                    <td className="num">{formatValue(a.kind, ev.value)}</td>
                    <td><span className={`status-pill ${status.cls}`}>{status.text}</span></td>
                    <td>{a.repeat ? "Every time" : "Once"}</td>
                    <td className="num">{a.firedCount}</td>
                    <td>
                      <div className="row-actions">
                      <label className="check-row">
                        <input type="checkbox" checked={a.enabled} onChange={(e) => updateAlert(a.id, { enabled: e.target.checked, armed: true })} aria-label={`Turn ${KIND_DEFS[a.kind].label} alert ${a.enabled ? "off" : "on"}`} />
                        On
                      </label>
                      <button type="button" className="btn btn-quiet danger" onClick={() => removeAlert(a.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editingCredits && (
        <AlertEditor target={CREDITS_TARGET} label="Credits" subject={null} credits={live.credits} onClose={() => setEditingCredits(false)} />
      )}
    </div>
  );
}
