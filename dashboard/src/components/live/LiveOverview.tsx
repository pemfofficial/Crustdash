"use client";

import { formatGameClock, formatGameDate } from "@/components/charts/format";
import type { Bucket } from "@/components/notifications/Notifications";
import type { MissionsState } from "@/components/tasks/useMissions";
import { InfoTip } from "@/components/ui/InfoTip";
import { LiveBoard } from "./LiveBoard";
import { liveDotClass, liveStatusText, useLive, useLiveClock } from "./LiveProvider";

type Props = {
  holdings: Record<string, number>;
  holdingsSource: "live" | "save";
  savedCredits: number | null;
  profileName: string;
  isLiveRange: boolean;
  /** Counts only; the items themselves live in the notification panel, Findings and Alerts. */
  notifications: Record<Bucket, number>;
  missions: MissionsState;
};

/** The screen to keep open while you play: live status, then a board of widgets you arrange yourself. */
export function LiveOverview({ holdings, holdingsSource, savedCredits, profileName, isLiveRange, notifications, missions }: Props) {
  const live = useLive();
  const { status, ageMs } = useLiveClock();

  const statusText = liveStatusText(status, ageMs);
  // Live values are only tied to this profile when the game reported which save is loaded and it matches
  const saveUnknown = Boolean(live.market) && !live.slot;
  const mismatch = saveUnknown || Boolean(live.slot && live.slot !== profileName);
  const t = live.inGameTime;

  return (
    <>
      <div className="live-status">
        <span className="chip">
          <span className={liveDotClass(status)} aria-hidden />
          {statusText}
        </span>
        {live.slot && <span className="chip">Save: {live.slot}</span>}
        {t && (
          <span className="chip chip-with-tip">
            In-game {formatGameDate(t)}, {formatGameClock(t)}
            <InfoTip topic="inGameTime" />
          </span>
        )}
        {live.game && <span className="chip">{live.paused ? "Paused" : "Running"}</span>}
      </div>

      {mismatch && (
        <div className="banner">
          {saveUnknown ? (
            <>
              The running game didn’t report which save is loaded, so its credits and holdings aren’t compared with <strong>{profileName}</strong>. Prices are
              still live; holdings come from {profileName}’s last save.
            </>
          ) : (
            <>
              The game has <strong>{live.slot}</strong> loaded, but this page shows <strong>{profileName}</strong>. Holdings and values below come from{" "}
              {profileName}’s last save.
            </>
          )}
        </div>
      )}

      {!live.market && <p className="empty">Start The Crust and load a save. Live numbers appear a few seconds after the save finishes loading.</p>}

      <LiveBoard
        ctx={{ holdings, holdingsSource, savedCredits, mismatch, isLiveRange, notifications, missions, profileName }}
      />
    </>
  );
}
