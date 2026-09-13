import Link from "next/link";
import path from "node:path";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ProfileDashboard } from "@/components/ProfileDashboard";
import { listProfiles, profileDir } from "@/lib/crust/saves";
import { readStats } from "@/lib/crust/stats";
import { analyze, RANGE_PRESETS } from "@/lib/crust/insights";

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  await connection();
  const { id } = await params;
  const { range = "90" } = await searchParams;
  const profileId = decodeURIComponent(id);

  const profile = (await listProfiles()).find((p) => p.id === profileId);
  if (!profile) notFound();

  const preset = RANGE_PRESETS.find((r) => r.key === range) ?? RANGE_PRESETS.find((r) => r.key === "90")!;
  let stats;
  try {
    stats = await readStats(path.join(profileDir(profile.id), "Stats.bin"));
  } catch {
    return (
      <main className="shell">
        <Link href="/" className="crumb">← Profiles</Link>
        <div className="card empty">This save has no readable Stats.bin yet. Save once in-game and reload.</div>
      </main>
    );
  }

  const analysis = analyze(stats, preset.days);
  // Latest quantity per resource (by EResourceType name), to value stockpiles at live market prices
  const holdings = Object.fromEntries(
    stats
      .filter((s) => s.name.startsWith("EResourceType::"))
      .map((s) => [s.name.slice("EResourceType::".length), s.points.length ? s.points[s.points.length - 1].value : 0]),
  );

  return (
    <ProfileDashboard
      profile={{
        id: profile.id,
        name: profile.name,
        title: profile.isAutosave ? profile.id.replace(/^Autosave_/, "Autosave ") : profile.name,
        difficulty: profile.difficulty,
        startParameter: profile.startParameter,
        gameVersion: profile.gameVersion,
        savedAtText: new Date(profile.savedAt).toLocaleString("en-US"),
      }}
      rangeKey={preset.key}
      ranges={RANGE_PRESETS.map(({ key, label }) => ({ key, label }))}
      analysis={analysis}
      holdings={holdings}
    />
  );
}
