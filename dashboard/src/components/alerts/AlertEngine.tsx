"use client";

import { useEffect, useRef, useState } from "react";
import { useLive, useLiveClock } from "@/components/live/LiveProvider";
import { focusResource, showResource, usePrefs } from "@/components/live/PrefsProvider";
import { useAlertSubjects, useMarketRows } from "@/components/live/useMarketRows";
import { requestOpenSection } from "@/components/ui/Section";
import { Modal } from "@/components/ui/Modal";
import { RichText } from "@/components/ui/RichText";
import { Sparkline } from "@/components/charts/Figures";
import { compact, integer, signedPercent } from "@/components/charts/format";
import { playChime, unlockAudio } from "@/lib/client/sound";
import { CREDITS_TARGET, KIND_DEFS, evaluateRule, formatThreshold, formatValue, type AlertRule, type AlertSubject } from "@/lib/crust/alerts";

type Fired = {
  key: string;
  rule: AlertRule;
  value: number | null;
  subject: AlertSubject | null;
  sellHistory: number[];
  credits: number | null;
  at: number;
};

/** Evaluates alert rules on every live snapshot, plays the chime, and shows the alert pop-up. */
export function AlertEngine({ holdings, holdingsSource }: { holdings: Record<string, number>; holdingsSource: "live" | "save" }) {
  const live = useLive();
  const { status } = useLiveClock();
  const { alerts, updateAlert, sound } = usePrefs();
  const subjects = useAlertSubjects(holdings, holdingsSource);
  const rows = useMarketRows(holdings);
  const [queue, setQueue] = useState<Fired[]>([]);
  // The checker runs on a timer and reads the newest values from here (updated after every render)
  const latest = useRef({ status, alerts, subjects, rows, credits: live.credits, sound, updateAlert });
  useEffect(() => {
    latest.current = { status, alerts, subjects, rows, credits: live.credits, sound, updateAlert };
  });

  // Browsers only play audio after a user gesture; warm the audio context on the first click anywhere
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // Check every rule once a second against the latest live data (live snapshots arrive about every 2 s)
  useEffect(() => {
    const check = () => {
      const { status, alerts, subjects, rows, credits, sound, updateAlert } = latest.current;
      if (status !== "live") return;
      const fired: Fired[] = [];
      for (const rule of alerts) {
        if (!rule.enabled) continue;
        const subject = rule.target === CREDITS_TARGET ? null : subjects.get(rule.target) ?? null;
        const ev = evaluateRule(rule, subject, credits);
        if (ev.unavailable) continue;
        if (ev.met && rule.armed) {
          const now = Date.now();
          fired.push({
            key: `${rule.id}-${now}`,
            rule,
            value: ev.value,
            subject,
            sellHistory: rows.find((r) => r.name === rule.target)?.sellHistory ?? [],
            credits,
            at: now,
          });
          updateAlert(rule.id, { armed: false, lastFiredAt: now, firedCount: rule.firedCount + 1, enabled: rule.repeat });
        } else if (!ev.met && !rule.armed && rule.repeat) {
          updateAlert(rule.id, { armed: true });
        }
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

  const showOnPage = () => {
    if (!current) return;
    dismiss();
    if (current.rule.target === CREDITS_TARGET) {
      requestOpenSection("live");
      focusResource(CREDITS_TARGET);
    } else {
      showResource(current.rule.target);
    }
  };

  if (!current) return null;
  const def = KIND_DEFS[current.rule.kind];
  const s = current.subject;
  const label = current.rule.target === CREDITS_TARGET ? "Credits" : s?.label ?? current.rule.target;

  return (
    <Modal open onClose={dismiss} label={`Alert: ${label}`} size="sm">
      <button type="button" className="alert-pop" onClick={showOnPage} data-autofocus>
        <span className="alert-pop-kicker">
          <span aria-hidden>◆</span> Alert triggered{queue.length > 1 ? ` · ${queue.length - 1} more waiting` : ""}
        </span>
        <span className="alert-pop-title">{label}</span>
        <span className="alert-pop-result">
          <RichText text={`${def.label} **${formatThreshold(current.rule.kind, current.rule.threshold)}**. It’s now ==${formatValue(current.rule.kind, current.value)}==.`} />
        </span>

        {s ? (
          <span className="alert-snapshot">
            {current.sellHistory.length > 1 && (
              <span className="alert-spark">
                <Sparkline values={current.sellHistory} width={140} height={40} />
                <span className="muted">30-day sell price</span>
              </span>
            )}
            <span className="mini-stats">
              <span><span className="muted">Sell</span><strong>{s.sell == null ? "—" : integer(s.sell)}</strong></span>
              <span><span className="muted">Buy</span><strong>{s.buy == null ? "—" : integer(s.buy)}</strong></span>
              <span><span className="muted">vs base</span><strong>{signedPercent(s.vsBase)}</strong></span>
              <span><span className="muted">You hold</span><strong>{s.held == null ? "—" : integer(s.held)}</strong></span>
              <span><span className="muted">Worth</span><strong>{s.heldValue == null ? "—" : compact(s.heldValue)}</strong></span>
            </span>
          </span>
        ) : (
          <span className="mini-stats">
            <span><span className="muted">Live credits</span><strong>{current.credits == null ? "—" : integer(current.credits)}</strong></span>
          </span>
        )}

        <span className="alert-pop-cta">Show me on the page</span>
      </button>
      <div className="modal-actions">
        <button type="button" className="btn btn-quiet danger" onClick={() => { updateAlert(current.rule.id, { enabled: false }); dismiss(); }}>
          Turn this alert off
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-quiet" onClick={dismiss}>Dismiss</button>
      </div>
    </Modal>
  );
}
