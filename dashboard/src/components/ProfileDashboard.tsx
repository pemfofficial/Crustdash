"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { AlertDataProvider } from "@/components/alerts/AlertData";
import { AlertEngine } from "@/components/alerts/AlertEngine";
import { AlertsPanel } from "@/components/alerts/AlertsPanel";
import { Calculator } from "@/components/calculator/Calculator";
import { formatGameStamp, fullDate } from "@/components/charts/format";
import { FindingsLink, InsightsBoard } from "@/components/insights/InsightList";
import { LiveOverview } from "@/components/live/LiveOverview";
import { liveDotClass, liveStatusText, LiveProvider, useLive, useLiveClock } from "@/components/live/LiveProvider";
import { PrefsProvider, showResource, usePrefs } from "@/components/live/PrefsProvider";
import { useHoldings, useMarketRows, useResourceLabel } from "@/components/live/useMarketRows";
import { ResourceTable } from "@/components/resources/ResourceTable";
import { BuildingsSection } from "@/components/sections/BuildingsSection";
import { CreditsSection } from "@/components/sections/CreditsSection";
import { FlowsSection } from "@/components/sections/FlowsSection";
import { NotificationCenter, useNotifications } from "@/components/notifications/Notifications";
import { NetWorthSection } from "@/components/sections/NetWorthSection";
import { openModule, TerminalShell, useModuleHash, type CommandItem, type ModuleDef } from "@/components/shell/TerminalShell";
import { setTheme, ThemeToggle } from "@/components/ui/ThemeToggle";
import { TaskCenter } from "@/components/tasks/TaskCenter";
import { useMissions } from "@/components/tasks/useMissions";
import { WikiModule } from "@/components/wiki/WikiModule";
import type { Analysis } from "@/lib/crust/insights";
import { marketInsights } from "@/lib/crust/market";
import { WIKI_INDEX, WIKI_MODULE } from "@/lib/wiki/client";

export type ProfileInfo = {
  id: string;
  name: string;
  title: string;
  difficulty: string | null;
  startParameter: string | null;
  gameVersion: string | null;
  savedAtText: string;
};

type Props = {
  profile: ProfileInfo;
  rangeKey: string;
  ranges: { key: string; label: string }[];
  analysis: Analysis;
  holdings: Record<string, number>;
};

const LIVE_REFRESH_MS = 10000;
const WIKI_CATEGORY_LABEL = new Map(WIKI_INDEX.categories.map((c) => [c.id, c.label]));

// Every wiki article is reachable from the command line
const WIKI_COMMANDS: CommandItem[] = [
  ...WIKI_INDEX.categories.map((c) => ({
    id: `wiki-category-${c.id}`,
    label: `Wiki: ${c.label}`,
    group: "Wiki",
    keywords: `wiki ${c.id}`,
    run: () => openModule(`${WIKI_MODULE}/c/${c.id}`),
  })),
  ...WIKI_INDEX.entries.map((e) => ({
    id: `wiki-${e.id}`,
    label: e.title,
    group: "Wiki",
    keywords: `${e.aliases.join(" ")} ${WIKI_CATEGORY_LABEL.get(e.category) ?? ""} wiki`,
    run: () => openModule(`${WIKI_MODULE}/${e.id}`),
  })),
];

/** In the Live range, re-read the saves every 10 s so a new save shows up without reloading the page. */
function LiveAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);
  return null;
}

function LinkStatus() {
  const live = useLive();
  const { status, ageMs } = useLiveClock();
  const t = live.inGameTime;
  const text = liveStatusText(status, ageMs, { short: true });
  return (
    <>
      <span className={`status-readout${status === "live" ? " is-live" : ""}`}>
        <span className={liveDotClass(status)} aria-hidden />
        {text}
      </span>
      {t && (
        <span className="status-readout" title="In-game date and time">
          {formatGameStamp(t)}
          {live.paused ? " paused" : ""}
        </span>
      )}
    </>
  );
}

function RangeControl({ ranges, rangeKey, rangeDays, lastDay }: { ranges: Props["ranges"]; rangeKey: string; rangeDays: number; lastDay: number | null }) {
  const hash = useModuleHash();
  return (
    <div className="range-block">
      <span className="sidebar-heading">Save history</span>
      <div className="range-list">
        {ranges.map((r) => (
          <Link key={r.key} href={`?range=${r.key}${hash ? `#${hash}` : ""}`} scroll={false} className="range-item" aria-current={r.key === rangeKey ? "page" : undefined}>
            {r.key === "live" && <span className="live-dot on" aria-hidden />}
            {r.label}
          </Link>
        ))}
      </div>
      <p className="range-meta">
        {rangeKey === "live" ? "Refreshes every 10 s. Save-based modules show the last 30 days." : `${rangeDays} in-game days.`}
        {lastDay != null && ` Last save: ${fullDate(lastDay)} in-game.`}
      </p>
    </div>
  );
}

export function ProfileDashboard(props: Props) {
  return (
    <LiveProvider>
      <PrefsProvider>
        <DashboardBody {...props} />
      </PrefsProvider>
    </LiveProvider>
  );
}

function DashboardBody({ profile, rangeKey, ranges, analysis: a, holdings: saveHoldings }: Props) {
  const router = useRouter();
  const isLive = rangeKey === "live";
  const rangeLabel = isLive ? "the last 30 days of saves" : (ranges.find((r) => r.key === rangeKey)?.label ?? "").toLowerCase();
  const rangeChip = <span className="chip">{isLive ? "Live · last 30 days of saves" : ranges.find((r) => r.key === rangeKey)?.label}</span>;
  // Live counts from the running game when available for this save; otherwise the last save's numbers
  const { holdings, source } = useHoldings(saveHoldings, profile.name);
  const { pins, alerts } = usePrefs();
  const market = useMarketRows(holdings);
  const labelOf = useResourceLabel();
  // Findings = advice from the saves plus live market opportunities; both live in the Assistant, not in the Colony modules
  const liveInsights = useMemo(() => marketInsights(market), [market]);
  const findings = useMemo(() => [...liveInsights, ...a.insights], [liveInsights, a.insights]);
  const notices = useNotifications(findings);
  const missions = useMissions(profile.id);

  const urgent = findings.filter((i) => i.level === "critical" || i.level === "serious" || i.level === "warning").length;
  const alertsOn = alerts.filter((x) => x.enabled).length;
  const pinCount = Object.keys(pins).length;

  // The calculator only uses the running game's credits and date when that game has this save loaded
  const live = useLive();
  const liveMatches = live.slot === profile.name && live.credits != null;
  const calculator = (size: "full" | "compact") => (
    <Calculator
      holdings={holdings}
      holdingsSource={source}
      credits={liveMatches ? live.credits : a.credits.now}
      creditsSource={liveMatches ? "live" : "save"}
      gameTime={liveMatches ? live.inGameTime : null}
      recordedNetPerDay={a.credits.avgNetPerDay}
      trendPerDay={a.credits.driftPerDay30}
      size={size}
    />
  );

  const modules: ModuleDef[] = [
    {
      id: "live",
      group: "Colony",
      label: "Live now",
      summary: "Straight from your running game",
      info: "live",
      content: (
        <LiveOverview
          holdings={holdings}
          holdingsSource={source}
          savedCredits={a.credits.now}
          profileName={profile.name}
          isLiveRange={isLive}
          notifications={notices.counts}
          missions={missions}
        />
      ),
    },
    { id: "credits", group: "Colony", label: "Credits", summary: "Balance, cash flow and runway", info: "credits", headerActions: rangeChip, content: <CreditsSection a={a} /> },
    { id: "networth", group: "Colony", label: "Net worth", summary: "Where your net worth sits", info: "netWorth", headerActions: rangeChip, content: <NetWorthSection a={a} /> },
    {
      id: "resources",
      group: "Colony",
      label: "Resources",
      summary: source === "live" ? "Holdings and prices, live" : "Holdings from saves, prices live",
      info: "resources",
      badge: pinCount ? <span className="badge-info" title="Pinned">★{pinCount}</span> : undefined,
      headerActions: rangeChip,
      content: (
        <>
          <ResourceTable saveRows={a.resources} holdings={holdings} holdingsSource={source} rangeLabel={rangeLabel} lastDay={a.lastDay} />
          <FindingsLink insights={a.insights} area="production" topic="production and stockpiles" />
          <FindingsLink insights={liveInsights} area="market" topic="the live market" />
        </>
      ),
    },
    { id: "flows", group: "Colony", label: "Income & spending", summary: "Where credits come from and go", info: "income", headerActions: rangeChip, content: <FlowsSection a={a} /> },
    { id: "buildings", group: "Colony", label: "Buildings & capacity", summary: "Modules and CPU", info: "buildings", headerActions: rangeChip, content: <BuildingsSection a={a} /> },
    {
      id: "findings",
      group: "Assistant",
      label: "Findings",
      summary: "Advice from your saves and the live market",
      info: "insights",
      badge: urgent ? <span className="badge-warn" title="Warnings">{urgent}</span> : undefined,
      headerActions: rangeChip,
      content: <InsightsBoard insights={findings} />,
    },
    {
      id: "alerts",
      group: "Assistant",
      label: "Alerts",
      summary: "Your own triggers on prices, power, CPU, missions, the game and more",
      info: "alerts",
      badge: alertsOn ? <span className="badge-info" title="Alerts on">{alertsOn}</span> : undefined,
      content: <AlertsPanel />,
    },
    { id: WIKI_MODULE, group: "Reference", label: "Wiki", summary: `How The Crust ${WIKI_INDEX.gameVersion} works`, content: <WikiModule /> },
    { id: "calculator", group: "Tools", label: "Calculator", summary: "Keypad, trades, contracts and credit goals", content: calculator("full") },
  ];

  const resourceNames = useMemo(() => [...new Set([...a.resources.map((r) => r.name), ...market.map((r) => r.name)])], [a.resources, market]);
  const commands: CommandItem[] = [
    ...modules.map((m) => ({ id: `module-${m.id}`, label: m.label, group: "Modules", keywords: `${m.id} ${m.group} ${m.summary ?? ""}`, run: () => openModule(m.id) })),
    ...resourceNames.map((name) => ({
      id: `resource-${name}`,
      label: labelOf(name),
      group: "Resources",
      keywords: name,
      run: () => showResource(name),
    })),
    ...WIKI_COMMANDS,
    ...ranges.map((r) => ({
      id: `range-${r.key}`,
      label: `Range: ${r.label}`,
      group: "Save history",
      keywords: `range ${r.key} ${r.label}`,
      run: () => router.push(`?range=${r.key}${window.location.hash}`, { scroll: false }),
    })),
    { id: "theme-dark", label: "Theme: Terminal", group: "Display", keywords: "theme dark terminal", run: () => setTheme("dark") },
    { id: "theme-light", label: "Theme: Daylight", group: "Display", keywords: "theme light daylight", run: () => setTheme("light") },
  ];

  return (
    <AlertDataProvider holdings={holdings} holdingsSource={source} missions={missions} notifications={notices.counts} profileName={profile.name}>
      <TerminalShell
        title={profile.title}
        status={<LinkStatus />}
        tools={
          <>
            <TaskCenter missions={missions} profileName={profile.name} />
            <NotificationCenter notices={notices} />
            <ThemeToggle />
          </>
        }
        modules={modules}
        defaultModule="live"
        commands={commands}
        calculator={calculator("compact")}
        sidebarFooter={
          <>
            <RangeControl ranges={ranges} rangeKey={rangeKey} rangeDays={a.rangeDays} lastDay={a.lastDay} />
            <div className="save-meta">
              <Link href="/" className="crumb">
                Switch save
              </Link>
              <span>
                {[profile.difficulty, profile.startParameter, profile.gameVersion && `v${profile.gameVersion}`].filter(Boolean).join(", ")}
              </span>
              <span>Saved {profile.savedAtText}</span>
            </div>
          </>
        }
      />
      {isLive && <LiveAutoRefresh />}
      <AlertEngine />
    </AlertDataProvider>
  );
}
