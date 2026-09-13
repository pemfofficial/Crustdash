import Link from "next/link";
import { connection } from "next/server";
import { LivePanel } from "@/components/LivePanel";
import { CraterMark } from "@/components/shell/TerminalShell";
import { Section } from "@/components/ui/Section";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { listProfiles, SAVE_DIR, type Profile } from "@/lib/crust/saves";

function SaveRow({ p }: { p: Profile }) {
  return (
    <li>
      <Link href={`/profiles/${encodeURIComponent(p.id)}`} className="save-row">
        <span className="save-row-name">{p.isAutosave ? p.id.replace(/^Autosave_/, "Autosave ") : p.name}</span>
        <span className="save-row-meta">{[p.difficulty, p.startParameter, p.gameVersion && `v${p.gameVersion}`].filter(Boolean).join(", ")}</span>
        <span className="save-row-time">{new Date(p.savedAt).toLocaleString("en-US")}</span>
        {!p.hasStats && <span className="chip">No statistics yet</span>}
      </Link>
    </li>
  );
}

export default async function Home() {
  await connection();
  let profiles: Profile[] = [];
  let error: string | null = null;
  try {
    profiles = await listProfiles();
  } catch (e) {
    error = String(e);
  }
  const saves = profiles.filter((p) => !p.isAutosave);
  const autosaves = profiles.filter((p) => p.isAutosave);

  return (
    <div className="terminal">
      <header className="statusbar">
        <div className="statusbar-brand">
          <CraterMark />
          <span className="brand-text">Director’s terminal</span>
          <span className="brand-save">CrustDash</span>
        </div>
        <div className="statusbar-tools">
          <ThemeToggle />
        </div>
      </header>

      <main className="workspace home-workspace">
        <section className="module">
          <header className="module-head">
            <h1 className="module-title">Choose a save</h1>
            <p className="module-summary">Each save opens its own terminal. Saves are read from {SAVE_DIR}.</p>
          </header>
          {error && <p className="banner">Couldn’t read the save folder: {error}</p>}
          {saves.length ? (
            <ul className="save-list">{saves.map((p) => <SaveRow key={p.id} p={p} />)}</ul>
          ) : (
            <p className="empty">No manual saves yet. Save once in The Crust, then reload this page.</p>
          )}
        </section>

        {autosaves.length > 0 && (
          <Section id="home-autosaves" title="Autosaves" subtitle={`${autosaves.length}`} defaultOpen={false}>
            <ul className="save-list">{autosaves.map((p) => <SaveRow key={p.id} p={p} />)}</ul>
          </Section>
        )}

        <Section id="home-live" title="Raw game feed" subtitle="every numeric field the watcher reads" info="live" defaultOpen={false}>
          <LivePanel />
        </Section>
      </main>
    </div>
  );
}
