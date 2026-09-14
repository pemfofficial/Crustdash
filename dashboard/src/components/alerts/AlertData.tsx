"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useLive, useLiveClock } from "@/components/live/LiveProvider";
import { useAlertSubjects, useResourceLabel } from "@/components/live/useMarketRows";
import type { MissionsState } from "@/components/tasks/useMissions";
import { useTasks } from "@/lib/client/taskStore";
import type { AlertContext } from "@/lib/crust/alerts";

const AlertDataContext = createContext<AlertContext | null>(null);

type Props = {
  holdings: Record<string, number>;
  holdingsSource: "live" | "save";
  missions: MissionsState;
  notifications: { urgent: number; pressing: number };
  profileName: string;
  children: ReactNode;
};

/** The live values every alert is checked against, shared by the alert engine, editor, list and notifications. */
export function AlertDataProvider({ holdings, holdingsSource, missions, notifications, profileName, children }: Props) {
  const live = useLive();
  const { status } = useLiveClock();
  const subjects = useAlertSubjects(holdings, holdingsSource);
  const resourceLabel = useResourceLabel();
  const { tasks } = useTasks();
  const connected = status === "live";
  const openTasks = tasks.filter((t) => !t.done && (t.profile == null || t.profile === profileName)).length;

  const value = useMemo<AlertContext>(
    () => ({
      credits: live.credits,
      subjects,
      glossary: live.glossary,
      connected,
      paused: live.paused,
      inGameTime: live.inGameTime,
      missions: missions.missions.map((m) => ({
        name: m.name,
        done: m.done,
        total: m.total,
        currentName: m.current?.name ?? null,
        currentProgress: m.current?.progress ?? null,
      })),
      notifications: { urgent: notifications.urgent, pressing: notifications.pressing },
      openTasks,
      resourceLabel,
    }),
    [live.credits, live.glossary, live.paused, live.inGameTime, subjects, connected, missions, notifications.urgent, notifications.pressing, openTasks, resourceLabel],
  );

  return <AlertDataContext.Provider value={value}>{children}</AlertDataContext.Provider>;
}

export function useAlertContext(): AlertContext {
  const value = useContext(AlertDataContext);
  if (!value) throw new Error("useAlertContext must be used inside <AlertDataProvider>");
  return value;
}
