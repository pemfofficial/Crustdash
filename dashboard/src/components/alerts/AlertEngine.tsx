"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkline } from "@/components/charts/Figures";
import { compact, integer, signedPercent } from "@/components/charts/format";
import { focusResource, showResource, usePrefs } from "@/components/live/PrefsProvider";
import { useMarketRows } from "@/components/live/useMarketRows";
import { openNotifications } from "@/components/notifications/Notifications";
import { openTasks } from "@/components/tasks/TaskCenter";
import { Modal } from "@/components/ui/Modal";
import { RichText } from "@/components/ui/RichText";
import { openModule } from "@/lib/client/moduleHash";
import { playChime, unlockAudio } from "@/lib/client/sound";
import { CREDITS_TARGET, METRICS, describeCondition, evaluateRule, formatAmount, sourceInfo, sourceLabel, usesBaseline, type AlertRule } from "@/lib/crust/alerts";
import { useAlertContext } from "./AlertData";

type Fired = { key: string; rule: AlertRule; value: number | null; detail: string | null };

/** Values are still arriving right after the page opens; hold off firing so loading doesn't look like changes. */
const WARM_UP_MS = 20000;

/** Where "Show me" goes for an alert. */
function showAlert(rule: AlertRule) {
  const source = rule.source;
  if (source.type === "resource") return showResource(source.resource);
  if (source.type === "metric") {
    const group = METRICS[source.metric].group;
    if (group === "Missions" || source.metric === "openTasks") return openTasks();
    if (group === "Assistant") return openNotifications();
    if (group === "Market") return openModule("findings/market");
    if (source.metric === "credits") window.setTimeout(() => focusResource(CREDITS_TARGET), 60);
  }
  openModule("live");
}

/**
 * Checks every alert once a second and shows the pop-up with a chime.
 * - Level rules (reaches, drops to, is) fire when the condition becomes true, and re-arm once it clears.
 * - Change rules (rises by, falls by, changes) compare with a starting value kept here, set when the rule is first
 *   checked and reset after it fires.
 * - Yes/no values (paused, connected) fire when they flip to the chosen state.
 */
export function AlertEngine() {
  const ctx = useAlertContext();
  const { alerts, updateAlert, sound } = usePrefs();
  const rows = useMarketRows();
  const sellHistory = useMemo(() => new Map(rows.map((r) => [r.name, r.sellHistory])), [rows]);
  const [queue, setQueue] = useState<Fired[]>([]);
  const latest = useRef({ ctx, alerts, sound, updateAlert });
  const baselines = useRef(new Map<string, number>());
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    latest.current = { ctx, alerts, sound, updateAlert };
  });

  // Browsers only play audio after a user gesture; warm the audio context on the first click anywhere
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    const check = () => {
      const { ctx, alerts, sound, updateAlert } = latest.current;
      const now = Date.now();
      startedAt.current ??= now;
      const warmingUp = now - startedAt.current < WARM_UP_MS;
      const fired: Fired[] = [];
      const fire = (rule: AlertRule, value: number | null, detail: string | null, patch: Partial<AlertRule>) => {
        fired.push({ key: `${rule.id}-${now}`, rule, value, detail });
        updateAlert(rule.id, { lastFiredAt: now, firedCount: rule.firedCount + 1, enabled: rule.repeat, ...patch });
      };

      for (const rule of alerts) {
        if (!rule.enabled) {
          baselines.current.delete(rule.id);
          continue;
        }
        const yesNo = sourceInfo(rule.source).unit === "flag";
        const baseline = baselines.current.get(rule.id) ?? null;
        const ev = evaluateRule(rule, ctx, baseline);
        if (ev.value == null) continue;

        if (!yesNo && !usesBaseline(rule)) {
          if (ev.met && rule.armed && !warmingUp) fire(rule, ev.value, ev.detail, { armed: false });
          else if (!ev.met && !rule.armed && rule.repeat) updateAlert(rule.id, { armed: true });
          continue;
        }

        if (baseline == null || warmingUp) {
          baselines.current.set(rule.id, ev.value);
          continue;
        }
        const met = yesNo ? baseline !== rule.threshold && ev.value === rule.threshold : ev.met;
        if (met) fire(rule, ev.value, ev.detail, {});
        // Measure the next change from here: after firing, whenever a yes/no value is read, and when a rises/falls
        // rule moves the other way (so "rises by 5" means 5 above the lowest point since)
        const wrongWay = (rule.comparator === "risesBy" && ev.value < baseline) || (rule.comparator === "fallsBy" && ev.value > baseline);
        if (met || yesNo || wrongWay) baselines.current.set(rule.id, ev.value);
      }

      if (fired.length) {
        setQueue((q) => [...q, ...fired]);
        if (sound.enabled) playChime(sound.volume);
      }
    };
    const id = window.setInterval(check, 1000);
    return () => window.clearInterval(id);
  }, []);

  const current = queue[0];
  const dismiss = () => setQueue((q) => q.slice(1));
  if (!current) return null;

  const rule = current.rule;
  const info = sourceInfo(rule.source);
  const subject = rule.source.type === "resource" ? (ctx.subjects.get(rule.source.resource) ?? null) : null;
  const history = rule.source.type === "resource" ? (sellHistory.get(rule.source.resource) ?? []) : [];
  const title = rule.name?.trim() || sourceLabel(rule.source, ctx.resourceLabel);
  const condition = describeCondition(rule);

  return (
    <Modal open onClose={dismiss} label={`Alert: ${title}`} size="sm">
      <button
        type="button"
        className="alert-pop"
        onClick={() => {
          dismiss();
          showAlert(rule);
        }}
        data-autofocus
      >
        <span className="alert-pop-kicker">
          <span aria-hidden>◆</span> Alert triggered{queue.length > 1 ? `, ${queue.length - 1} more waiting` : ""}
        </span>
        <span className="alert-pop-title">{title}</span>
        <span className="alert-pop-result">
          <RichText text={`${condition.charAt(0).toUpperCase()}${condition.slice(1)}. Now ==${formatAmount(info.unit, current.value, info.flag)}==${current.detail ? ` (${current.detail})` : ""}.`} />
        </span>

        {subject && (
          <span className="alert-snapshot">
            {history.length > 1 && (
              <span className="alert-spark">
                <Sparkline values={history} width={140} height={40} />
                <span className="muted">30-day sell price</span>
              </span>
            )}
            <span className="mini-stats">
              <span>
                <span className="muted">Sell</span>
                <strong>{subject.sell == null ? "—" : integer(subject.sell)}</strong>
              </span>
              <span>
                <span className="muted">Buy</span>
                <strong>{subject.buy == null ? "—" : integer(subject.buy)}</strong>
              </span>
              <span>
                <span className="muted">vs base</span>
                <strong>{signedPercent(subject.vsBase)}</strong>
              </span>
              <span>
                <span className="muted">You hold</span>
                <strong>{subject.held == null ? "—" : integer(subject.held)}</strong>
              </span>
              <span>
                <span className="muted">Worth</span>
                <strong>{subject.heldValue == null ? "—" : compact(subject.heldValue)}</strong>
              </span>
            </span>
          </span>
        )}
        <span className="alert-pop-cta">Show me</span>
      </button>
      <div className="modal-actions">
        <button
          type="button"
          className="btn btn-quiet danger"
          onClick={() => {
            updateAlert(rule.id, { enabled: false });
            dismiss();
          }}
        >
          Turn this alert off
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-quiet" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </Modal>
  );
}
