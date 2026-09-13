import { useSyncExternalStore } from "react";

// The Director's task list. Stored in data/tasks.json through /api/tasks (kept until you delete a task),
// with a copy in this browser in case the dashboard server isn't reachable.
export type Task = {
  id: string;
  title: string;
  notes: string;
  done: boolean;
  createdAt: number;
  doneAt: number | null;
  /** Save the task was written for; null = every save. */
  profile: string | null;
  /** Set when the task was copied from a mission step. */
  mission?: { tag: string; name: string };
};

const BACKUP_KEY = "crustdash:tasks-backup";
const NO_TASKS: Task[] = [];
let tasks: Task[] = NO_TASKS;
let state: "idle" | "loading" | "ready" = "idle";
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function load() {
  state = "loading";
  try {
    const res = await fetch("/api/tasks", { cache: "no-store" });
    const json = (await res.json()) as { tasks?: Task[] };
    tasks = Array.isArray(json.tasks) ? json.tasks : NO_TASKS;
  } catch {
    try {
      tasks = JSON.parse(localStorage.getItem(BACKUP_KEY) ?? "[]") as Task[];
    } catch {
      tasks = NO_TASKS;
    }
  }
  state = "ready";
  emit();
}

function commit(next: Task[]) {
  tasks = next;
  emit();
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(next));
  } catch {
    // private window or storage blocked: the server copy still saves
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch("/api/tasks", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ tasks }) }).catch(() => {});
  }, 250);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (state === "idle") void load();
  return () => listeners.delete(listener);
}

const getTasks = () => tasks;
const getReady = () => state === "ready";

export function useTasks() {
  const list = useSyncExternalStore(subscribe, getTasks, () => NO_TASKS);
  const ready = useSyncExternalStore(subscribe, getReady, () => false);
  return { tasks: list, ready };
}

const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Call from event handlers. */
export const taskActions = {
  add(title: string, profile: string | null, extra: Partial<Task> = {}) {
    const clean = title.trim();
    if (!clean) return;
    commit([{ id: newId(), title: clean, notes: "", done: false, createdAt: Date.now(), doneAt: null, profile, ...extra }, ...tasks]);
  },
  update(id: string, patch: Partial<Omit<Task, "id">>) {
    commit(tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  },
  toggle(id: string) {
    commit(tasks.map((t) => (t.id === id ? { ...t, done: !t.done, doneAt: t.done ? null : Date.now() } : t)));
  },
  remove(id: string) {
    commit(tasks.filter((t) => t.id !== id));
  },
  /** Move a task up or down among the tasks shown with it. */
  move(id: string, direction: -1 | 1, visibleIds: string[]) {
    const at = visibleIds.indexOf(id);
    const swapWith = visibleIds[at + direction];
    if (at < 0 || !swapWith) return;
    const a = tasks.findIndex((t) => t.id === id);
    const b = tasks.findIndex((t) => t.id === swapWith);
    const next = [...tasks];
    [next[a], next[b]] = [next[b], next[a]];
    commit(next);
  },
  clearDone(ids: string[]) {
    const drop = new Set(ids);
    commit(tasks.filter((t) => !(t.done && drop.has(t.id))));
  },
};
