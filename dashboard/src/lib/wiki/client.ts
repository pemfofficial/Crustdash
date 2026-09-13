import indexJson from "@/data/wiki/index.json";
import type { WikiArticle, WikiEntry, WikiIndex } from "./types";

export const WIKI_INDEX = indexJson as unknown as WikiIndex;
export const WIKI_ENTRIES: ReadonlyMap<string, WikiEntry> = new Map(WIKI_INDEX.entries.map((e) => [e.id, e]));
export const WIKI_MODULE = "wiki";

/** Hash for the Wiki module, or one article in it. Plain <a href> links work because modules follow the hash. */
export const wikiHref = (id?: string) => `#${WIKI_MODULE}${id ? `/${id}` : ""}`;

let articles: Promise<Record<string, WikiArticle>> | null = null;
/** Article bodies are a separate chunk, fetched the first time the Wiki needs them. */
export function loadArticles() {
  articles ??= import("@/data/wiki/articles.json").then((m) => m.default as unknown as Record<string, WikiArticle>);
  return articles;
}

const byResource = new Map(WIKI_INDEX.entries.filter((e) => e.resourceKey).map((e) => [e.resourceKey as string, e]));
const byName = new Map<string, WikiEntry>();
const key = (s: string) => s.toLowerCase().replace(/aluminium/g, "aluminum").replace(/[^a-z0-9]+/g, "");
for (const e of WIKI_INDEX.entries) {
  if (e.category === "research" || e.category === "story") continue;
  for (const name of [e.title, ...e.aliases]) if (!byName.has(key(name))) byName.set(key(name), e);
}

/** The article for a resource the companion tracks, by its EResourceType name (e.g. "Concrete"). */
export const wikiForResource = (resourceKey: string) => byResource.get(resourceKey) ?? null;

// Stats.bin module keys that differ from the names the game shows
const BUILDING_KEYS: Record<string, string> = {
  Accumulator: "battery",
  BigAccumulator: "large-battery",
  DroneCharger: "charging-station",
  DrillDressRoom: "drone-reconfiguration-module",
  PressingFactory: "pressing-module",
  OneResourceStorage: "single-resource-storage",
  BigBulkStorage: "large-bulk-storage",
  ElectricPillar: "utility-pole",
  ExtractorDeepOre: "extractor",
  RareMineralRecycler: "rare-minerals-refinery",
  MeltingFurnace: "smelting-furnace",
  CapsuleLandingPlatform: "landing-platform",
  CapsuleLandingPlatformTemp: "landing-platform",
  Midsolarpanel: "medium-solar-panel",
  RailGun: "rail-gun",
  Repeater: "repeater",
  HangarForCars: "vehicle-hangar",
  SmallTransportAssemblyWorkshop: "small-vehicle-assembly-facility",
  ElectrolysisFactory: "electrolysis-plant",
  FuelGenerator: "fuel-generator",
  Manufacturer: "manufacturer",
  AssemblerModule: "assembler",
  Bed: "bed",
  BunkBed: "bunk-bed",
};

/** The article for a building by its Stats.bin key ("MeltingFurnaceSys") or a display name. */
export function wikiForBuilding(statKey: string, label: string) {
  const bare = statKey.replace(/Sys$/i, "");
  const mapped = BUILDING_KEYS[bare];
  if (mapped) return WIKI_ENTRIES.get(mapped) ?? null;
  const hit = byName.get(key(label)) ?? byName.get(key(bare));
  return hit && hit.category === "buildings" ? hit : null;
}

type Term = { id: string; pattern: string };
const terms: Term[] = WIKI_INDEX.entries
  .flatMap((e) => e.linkTerms.filter((t) => /^[A-Za-z]/.test(t) && t.length >= 3).map((t) => ({ id: e.id, pattern: t })))
  .sort((a, b) => b.pattern.length - a.pattern.length);
const termIds = new Map(terms.map((t) => [t.pattern.toLowerCase(), t.id]));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches any link term as a whole word (longest first). Used to link keywords in companion text to the Wiki. */
export const TERM_RE = new RegExp(`(?<![\\w-])(${terms.map((t) => escape(t.pattern)).join("|")})(?![\\w-])`, "gi");
export const termArticle = (match: string) => termIds.get(match.toLowerCase()) ?? null;
