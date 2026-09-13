"use client";

import { Suspense, use, useEffect, useId, useState, type FormEvent } from "react";
import { oneDp } from "@/components/charts/format";
import { showResource } from "@/components/live/PrefsProvider";
import { Drawer } from "@/components/shell/TerminalShell";
import { Modal } from "@/components/ui/Modal";
import { RichText, WikiLink } from "@/components/ui/RichText";
import { StatusTag, WikiBlockView } from "@/components/wiki/WikiModule";
import { shouldIgnoreShortcut } from "@/lib/client/keyboard";
import { taskActions, useTasks, type Task } from "@/lib/client/taskStore";
import { WIKI_ENTRIES, loadArticles, wikiForBuilding, wikiForResource, wikiHref } from "@/lib/wiki/client";
import type { Mission, MissionStep, MissionsState } from "./useMissions";

export const OPEN_TASKS_EVENT = "crustdash:open-tasks";

/** Open the task list from anywhere; pass a mission id to open that mission straight away. */
export function openTasks(missionId?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_TASKS_EVENT, { detail: missionId ?? null }));
}

/** "3 / 5 at last save", "Researched", … */
export function stepProgressText(step: MissionStep): string | null {
  if (step.target == null) return null;
  if (step.glossary?.startsWith("G.ModuleUnlock.")) return step.state === "done" ? "Researched" : "Not researched yet";
  const value = step.live ?? step.last;
  if (value == null) return `Target ${oneDp(step.target)}`;
  return `${oneDp(value)} of ${oneDp(step.target)}${step.live != null ? ", live" : ", at last save"}`;
}

type StepLink = { label: string; href?: string; run?: () => void };

/** Where to go for help with a step, from the game value it watches. */
function stepLinks(step: MissionStep): StepLink[] {
  const tag = step.glossary ?? "";
  const links: StepLink[] = [];
  const built = tag.match(/^G\.Stats\.(\w+?)SysCount$/) ?? tag.match(/^G\.ModuleUnlock\.(\w+?)Sys$/);
  if (built) {
    const article = wikiForBuilding(`${built[1]}Sys`, built[1]);
    if (article) links.push({ label: `${article.title} in the Wiki`, href: wikiHref(article.id) });
    if (tag.startsWith("G.ModuleUnlock.")) {
      const research = WIKI_ENTRIES.get("research-system");
      if (research) links.push({ label: "How research works", href: wikiHref(research.id) });
    } else {
      links.push({ label: "Your modules in Buildings & capacity", href: "#buildings" });
    }
    return links;
  }
  const resource = tag.match(/^G\.Stats\.(\w+)Count$/);
  if (resource) {
    const key = resource[1];
    const article = wikiForResource(key);
    if (article) {
      links.push({ label: `${article.title} in the Wiki`, href: wikiHref(article.id) });
      links.push({
        label: `Show ${article.title} in Resources`,
        run: () => showResource(key),
      });
    }
  }
  return links;
}

function MissionGuide({ id }: { id: string }) {
  const article = use(loadArticles())[id];
  if (!article) return null;
  const blocks = article.blocks.filter((b) => !(b.t === "h" && /^description$/i.test(b.text))).slice(0, 16);
  return (
    <div className="mission-guide">
      <div className="wiki-status-row">
        <StatusTag status={article.alignment.status} />
        <span className="wiki-status-note">{article.alignment.note}</span>
      </div>
      <div className="wiki-content mission-guide-body">
        {blocks.map((b, i) => (
          <WikiBlockView key={i} block={b} self={id} />
        ))}
      </div>
    </div>
  );
}

function MissionModal({ mission: m, profileName, onClose }: { mission: Mission; profileName: string; onClose: () => void }) {
  const [added, setAdded] = useState(false);
  const step = m.current;
  const links = step ? stepLinks(step) : [];
  const ids = useId();

  return (
    <Modal open onClose={onClose} label={`Mission: ${m.name}`} size="lg">
      <div className="mission-detail">
        <p className="notify-kicker b-recommended">{m.total ? `Mission, ${m.done} of ${m.total} steps done` : "Mission, started this session"}</p>
        <h2 className="modal-title mission-title">{m.name}</h2>
        {m.description && <p className="mission-desc">{m.description}</p>}
        {m.startedThisSession && (
          <p className="banner">This mission started while you were playing. The game writes its steps into the save, so they appear here after the next save or autosave.</p>
        )}

        {step && (
          <section className="mission-now" aria-labelledby={`${ids}-now`}>
            <h3 id={`${ids}-now`} className="mission-h">
              What it wants now
            </h3>
            {m.currentStage && <p className="mission-stage-name">{m.currentStage}</p>}
            <p className="mission-now-step">{step.name}</p>
            {step.description && (
              <p className="mission-now-desc">
                <RichText text={step.description} autolink />
              </p>
            )}
            {step.progress != null && (
              <div className="mission-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(step.progress * 100)} aria-label="Step progress">
                <span style={{ width: `${step.progress * 100}%` }} />
              </div>
            )}
            {stepProgressText(step) && <p className="notify-meta">{stepProgressText(step)}</p>}
            {links.length > 0 && (
              <div className="notify-action-grid">
                {links.map((l) =>
                  l.href ? (
                    <a key={l.label} className="notify-action" href={l.href} onClick={onClose}>
                      {l.label}
                    </a>
                  ) : (
                    <button
                      key={l.label}
                      type="button"
                      className="notify-action"
                      onClick={() => {
                        onClose();
                        l.run?.();
                      }}
                    >
                      {l.label}
                    </button>
                  ),
                )}
              </div>
            )}
          </section>
        )}

        {m.stages.length > 0 && (
          <section aria-labelledby={`${ids}-steps`}>
            <h3 id={`${ids}-steps`} className="mission-h">
              All steps
            </h3>
            <ol className="mission-stages">
              {m.stages.map((stage, si) => (
                <li key={si} className={`mission-stage${stage.active ? " is-active" : ""}`}>
                  <span className="mission-stage-title">{stage.name || `Stage ${si + 1}`}</span>
                  <ul className="mission-steps">
                    {stage.steps.map((s, i) => (
                      <li key={i} className={`mission-step is-${s.state}`}>
                        <span className="mission-step-mark" aria-hidden>
                          {s.state === "done" ? "✓" : s.state === "current" ? "●" : "○"}
                        </span>
                        <span className="mission-step-body">
                          <span className="mission-step-name">
                            {s.name}
                            <span className="sr-only">{s.state === "done" ? " (done)" : s.state === "current" ? " (current step)" : " (to do)"}</span>
                          </span>
                          {s.description && <span className="mission-step-desc">{s.description}</span>}
                          {stepProgressText(s) && <span className="notify-meta">{stepProgressText(s)}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section aria-labelledby={`${ids}-guide`}>
          <h3 id={`${ids}-guide`} className="mission-h">
            Walkthrough and advice
          </h3>
          {m.wiki ? (
            <Suspense fallback={<p className="empty">Opening the archive…</p>}>
              <MissionGuide id={m.wiki.id} />
            </Suspense>
          ) : (
            <p className="notify-meta">The Crust Wiki has no walkthrough for this mission yet. The step descriptions above are the game’s own.</p>
          )}
          <p className="notify-meta">
            See also <WikiLink id="contracts-and-tenders">Contracts and tenders</WikiLink>, <WikiLink id="research-system">the research system</WikiLink> and{" "}
            <WikiLink id="what-s-new-in-1-0">what changed in 1.0</WikiLink>.
          </p>
        </section>

        <div className="modal-actions">
          {step && (
            <button
              type="button"
              className="btn btn-quiet"
              disabled={added}
              onClick={() => {
                taskActions.add(step.name, profileName, { notes: [m.name, step.description].filter(Boolean).join(": "), mission: { tag: m.tag, name: m.name } });
                setAdded(true);
              }}
            >
              {added ? "Added to your tasks" : "Add this step to my tasks"}
            </button>
          )}
          <span className="spacer" />
          {m.wiki && (
            <a className="btn" href={wikiHref(m.wiki.id)} onClick={onClose}>
              Open in the Wiki
            </a>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

function TaskRow({ task, visibleIds, profileName }: { task: Task; visibleIds: string[]; profileName: string }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [everySave, setEverySave] = useState(task.profile == null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ids = useId();
  const index = visibleIds.indexOf(task.id);

  const startEdit = () => {
    setTitle(task.title);
    setNotes(task.notes);
    setEverySave(task.profile == null);
    setEditing(true);
  };

  if (editing) {
    return (
      <li className="task-row is-editing">
        <form
          className="task-edit"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            taskActions.update(task.id, { title: title.trim(), notes: notes.trim(), profile: everySave ? null : (task.profile ?? profileName) });
            setEditing(false);
          }}
        >
          <label className="field-label" htmlFor={`${ids}-title`}>
            Task
          </label>
          <input id={`${ids}-title`} className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <label className="field-label" htmlFor={`${ids}-notes`}>
            Notes
          </label>
          <textarea id={`${ids}-notes`} className="text-input task-notes-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <label className="check-row">
            <input type="checkbox" checked={everySave} onChange={(e) => setEverySave(e.target.checked)} />
            Show for every save
          </label>
          <div className="task-edit-actions">
            <button type="submit" className="btn btn-primary">
              Save
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className={`task-row${task.done ? " is-done" : ""}`}>
      <input type="checkbox" className="task-check" checked={task.done} onChange={() => taskActions.toggle(task.id)} aria-label={`${task.done ? "Reopen" : "Complete"} “${task.title}”`} />
      <div className="task-main">
        <button type="button" className="task-title" onClick={startEdit} title="Edit this task">
          {task.title}
        </button>
        {task.notes && <p className="task-notes">{task.notes}</p>}
        <span className="task-meta">
          {task.mission ? `From ${task.mission.name}` : task.profile ? "This save" : "Every save"}
          {task.done && task.doneAt ? `, done ${new Date(task.doneAt).toLocaleDateString()}` : ""}
        </span>
      </div>
      <div className="task-tools">
        <button type="button" className="icon-btn" aria-label={`Move “${task.title}” up`} disabled={index <= 0} onClick={() => taskActions.move(task.id, -1, visibleIds)}>
          ↑
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={`Move “${task.title}” down`}
          disabled={index === visibleIds.length - 1}
          onClick={() => taskActions.move(task.id, 1, visibleIds)}
        >
          ↓
        </button>
        <button type="button" className="icon-btn" aria-label={`Edit “${task.title}”`} onClick={startEdit}>
          ✎
        </button>
        {confirmDelete ? (
          <button type="button" className="btn btn-quiet danger task-confirm" autoFocus onBlur={() => setConfirmDelete(false)} onClick={() => taskActions.remove(task.id)}>
            Delete?
          </button>
        ) : (
          <button type="button" className="icon-btn" aria-label={`Delete “${task.title}”`} onClick={() => setConfirmDelete(true)}>
            ✕
          </button>
        )}
      </div>
    </li>
  );
}

type Filter = "open" | "done" | "all";

/** Status-bar Tasks button: your own task list (kept until you delete a task) plus the game's missions, live. Shortcut: T. */
export function TaskCenter({ missions, profileName }: { missions: MissionsState; profileName: string }) {
  const { tasks, ready } = useTasks();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("open");
  const [draft, setDraft] = useState("");
  const [missionId, setMissionId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<string | null>).detail;
      if (id) setMissionId(id);
      else setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "t" || shouldIgnoreShortcut(e)) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener(OPEN_TASKS_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_TASKS_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const mine = tasks.filter((t) => t.profile == null || t.profile === profileName);
  const openCount = mine.filter((t) => !t.done).length;
  const doneTasks = mine.filter((t) => t.done);
  const visible = mine.filter((t) => (filter === "all" ? true : filter === "done" ? t.done : !t.done));
  const visibleIds = visible.map((t) => t.id);
  const mission = missionId ? (missions.missions.find((m) => m.id === missionId) ?? null) : null;
  const badge = openCount + missions.missions.length;

  const add = (e: FormEvent) => {
    e.preventDefault();
    taskActions.add(draft, profileName);
    setDraft("");
    setFilter((f) => (f === "done" ? "open" : f));
  };

  return (
    <>
      <button type="button" className="btn tasks-toggle" aria-expanded={open} aria-haspopup="dialog" title="Task list (T)" onClick={() => setOpen((o) => !o)}>
        Tasks
        {badge > 0 && <span className="tasks-badge">{badge}</span>}
      </button>

      {open && (
        <Drawer side="right" label="Task list" onClose={() => setOpen(false)}>
          <div className="tasks">
            <form className="task-add" onSubmit={add}>
              <input className="text-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a task, e.g. Build a second smelting furnace" aria-label="New task" />
              <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>
                Add
              </button>
            </form>

            <section className="task-section" aria-labelledby="tasks-missions">
              <div className="task-section-head">
                <h3 id="tasks-missions" className="task-section-title">
                  Missions
                </h3>
                <span className="task-section-meta">From the game, updated live</span>
              </div>
              {missions.missions.length ? (
                <ul className="mission-list">
                  {missions.missions.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        className="mission-row"
                        onClick={() => {
                          setOpen(false);
                          setMissionId(m.id);
                        }}
                      >
                        <span className="mission-row-name">{m.name}</span>
                        <span className="mission-row-count">{m.total ? `${m.done}/${m.total}` : "New"}</span>
                        <span className="mission-row-step">{m.current ? m.current.name : m.startedThisSession ? "Steps appear after the next save" : "All steps done"}</span>
                        {m.total > 0 && (
                          <span className="mission-row-bar" aria-hidden>
                            <span style={{ width: `${(m.done / m.total) * 100}%` }} />
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="task-empty">
                  {!missions.loaded
                    ? "Reading missions from your last save…"
                    : missions.error
                      ? `Couldn’t read missions from this save (${missions.error}).`
                      : `No missions in progress in the last save${missions.savedAt ? ` (${new Date(missions.savedAt).toLocaleString()})` : ""}.`}
                </p>
              )}
            </section>

            <section className="task-section" aria-labelledby="tasks-mine">
              <div className="task-section-head">
                <h3 id="tasks-mine" className="task-section-title">
                  Your tasks
                </h3>
                <div className="chip-filters" role="group" aria-label="Show tasks">
                  {(
                    [
                      ["open", `Open ${openCount}`],
                      ["done", `Done ${doneTasks.length}`],
                      ["all", "All"],
                    ] as const
                  ).map(([id, label]) => (
                    <button key={id} type="button" className="chip-btn" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {!ready ? (
                <p className="task-empty">Loading your tasks…</p>
              ) : visible.length ? (
                <ul className="task-list">
                  {visible.map((t) => (
                    <TaskRow key={t.id} task={t} visibleIds={visibleIds} profileName={profileName} />
                  ))}
                </ul>
              ) : (
                <p className="task-empty">{filter === "done" ? "Nothing finished yet." : "No open tasks. Add one above, or add a mission step from its details."}</p>
              )}
              {doneTasks.length > 0 && filter !== "open" && (
                <div className="task-foot">
                  {confirmClear ? (
                    <>
                      <span className="notify-meta">Delete {doneTasks.length} finished task{doneTasks.length === 1 ? "" : "s"}?</span>
                      <button
                        type="button"
                        className="btn btn-quiet danger"
                        onClick={() => {
                          taskActions.clearDone(doneTasks.map((t) => t.id));
                          setConfirmClear(false);
                        }}
                      >
                        Delete
                      </button>
                      <button type="button" className="btn btn-quiet" onClick={() => setConfirmClear(false)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button type="button" className="link-btn" onClick={() => setConfirmClear(true)}>
                      Clear finished tasks
                    </button>
                  )}
                </div>
              )}
              <p className="task-note">Saved in data/tasks.json, kept until you delete a task.</p>
            </section>
          </div>
        </Drawer>
      )}

      {mission && <MissionModal mission={mission} profileName={profileName} onClose={() => setMissionId(null)} />}
    </>
  );
}
