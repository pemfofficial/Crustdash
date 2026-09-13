"""Build the dashboard's Wiki from The Crust Wiki (wiki.gg), the game's own 1.0 text and Steam patch notes.

    python tools/build_wiki.py            # build from the cached downloads
    python tools/build_wiki.py --fetch    # refresh the wiki and Steam news first

Inputs  data/wiki-cache/pages.json      every main-namespace article (MediaWiki API)
        data/wiki-cache/steam_news.json  Steam news for app 1465470
        data/game-text/game_en.tsv       Localization/Game/en/Game.locres from the 1.0.6.1 pak
Outputs dashboard/src/data/wiki/index.json     titles, categories, link terms (client bundle)
        dashboard/src/data/wiki/articles.json  article bodies (loaded when the Wiki opens)

Wiki text is CC BY-SA 4.0; every article keeps its source page, last edit and license.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "wiki-cache"
GAME_TEXT = ROOT / "data" / "game-text" / "game_en.tsv"
OUT = ROOT / "dashboard" / "src" / "data" / "wiki"
WIKI = "https://thecrust.wiki.gg/wiki/"
API = "https://thecrust.wiki.gg/api.php"
UA = "CrustDash/1.0 (local personal dashboard)"
GAME_VERSION = "1.0.6.1"
RELEASE_DATE = "2026-09-10"

L, R, SEP = "⟦", "⟧", "¦"  # protected link token: ⟦target¦label⟧ (no "|" so tables can split safely)
BR = " "
BOLD = ""  # "**" placeholder until blocks are built, so a bold word at line start isn't read as a list marker


# ------------------------------------------------------------------------------------------------ fetch
def fetch() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)

    def get(params: dict) -> dict:
        url = API + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
            return json.load(r)

    pages: dict = {}
    cont: dict = {}
    while True:
        d = get({"action": "query", "generator": "allpages", "gapnamespace": 0, "gapfilterredir": "nonredirects", "gaplimit": 50,
                 "prop": "revisions|categories|info", "rvprop": "content|timestamp", "rvslots": "main", "cllimit": "max", **cont})
        for p in d.get("query", {}).get("pages", []):
            rev = (p.get("revisions") or [{}])[0]
            prev = pages.get(p["title"], {})
            pages[p["title"]] = {
                "title": p["title"], "pageid": p["pageid"], "length": p.get("length"), "touched": p.get("touched"),
                "timestamp": rev.get("timestamp") or prev.get("timestamp"),
                "content": rev.get("slots", {}).get("main", {}).get("content") or prev.get("content", ""),
                "categories": sorted({c["title"].replace("Category:", "") for c in p.get("categories", [])} | set(prev.get("categories", []))),
            }
        if "continue" not in d:
            break
        cont = d["continue"]
        time.sleep(0.5)
    (CACHE / "pages.json").write_text(json.dumps(pages, ensure_ascii=False), encoding="utf-8")
    url = "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=1465470&count=40&maxlength=0&format=json"
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
        (CACHE / "steam_news.json").write_bytes(r.read())
    print(f"fetched {len(pages)} wiki pages and Steam news")


# ------------------------------------------------------------------------------------------------ helpers
def slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower().replace("-3", "3")).strip("-")


def norm(s: str) -> str:
    """Loose key for name matching: case, spacing, punctuation and dash styles don't matter."""
    s = s.lower().replace("aluminium", "aluminum").replace("–", "-").replace("—", "-").replace("--", "-")
    return re.sub(r"[^a-z0-9]+", "", s)


def norm_text(s: str) -> str:
    s = re.sub(r"<[^>]*>", "", s).replace("¶", " ")
    s = s.replace("“", '"').replace("”", '"').replace("’", "'").replace("—", "-").replace("–", "-").replace("--", "-")
    return re.sub(r"\s+", " ", s).strip().lower()


def plain(markup: str) -> str:
    s = re.sub(L + r"[^" + SEP + R + r"]*" + SEP + r"([^" + R + r"]*)" + R, r"\1", markup)
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\*\*|==|\+\+|!!", "", s).replace(BR, " ").replace(BOLD, "")
    return re.sub(r"\s+", " ", s).strip()


def fmt_int(v: str) -> str:
    raw = v.replace(",", "").replace(" ", "").strip()
    if re.fullmatch(r"-?\d+", raw):
        return f"{int(raw):,}"
    return v.strip()


# ------------------------------------------------------------------------------------------------ inputs
if "--fetch" in sys.argv:
    fetch()

PAGES: dict = json.loads((CACHE / "pages.json").read_text(encoding="utf-8"))
NEWS: list = json.loads((CACHE / "steam_news.json").read_text(encoding="utf-8"))["appnews"]["newsitems"]
LOCRES = [r for r in (line.rstrip("\n").split("\t", 2) for line in GAME_TEXT.read_text(encoding="utf-8").splitlines()) if len(r) == 3]

GAME_NAMES: set[str] = set()
for ns, _k, v in LOCRES:
    if ns in {"UINames", "QuestTitles", "ResourceNamesLocale", "Organization_ST", "POI_ST", "ColonistCareerNames", "ResearchPoints"}:
        GAME_NAMES.add(norm(v))
GAME_TEXT_ALL = "\n".join(norm_text(v) for _ns, _k, v in LOCRES)

ATLAS: dict[str, list[str]] = {}
for _ns, _k, v in LOCRES:
    m = re.match(r"<AY2\d>([^<]{2,50})</>", v)
    if m and len(v) > 150:
        head = m.group(1).strip()
        paragraphs = [re.sub(r"\s+", " ", re.sub(r"<[^>]*>", "", p)).strip() for p in v.split("¶")]
        ATLAS.setdefault(head, [p for p in paragraphs if p])
for head, paras in ATLAS.items():
    GAME_NAMES.add(norm(head))


def game_line(pattern: str) -> str:
    """One exact line of 1.0 game text (tags stripped), or fail the build so quotes never drift from the game."""
    for _ns, _k, v in LOCRES:
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]*>", "", v).replace("¶", " ")).strip()
        if re.search(pattern, text):
            return text if re.search(r"[.!?…”\")]$", text) else text + "."
    raise SystemExit(f"game text not found: {pattern}")


# ------------------------------------------------------------------------------------------------ page selection and categories
DISPLAY_TITLES = {"Cpu": "CPU"}
RENAMED = {"Circle Sofa": "Circled Sofa", "Simple Chair": "Chair"}  # 1.0 names for wiki pages the encyclopedia doesn't cover
SKIP = {"The Crust", "The Crust (Disambiguation)", "The Crust Wiki", "Characters (list)", "Factions (list)", "Buildings (list)",
        "Resources (list)", "Events (list)", "Systems", "BFFCC"}
DUPLICATES = {"Top secret": "Top Secret", "Repeater (quest)": "Repeater (Quest)"}
STORY_EXTRA = {"A Million Opportunities", "A Place to Live", "Aurora Project", "Moon location & rewards", "Repeater (Quest)", "Stable Income",
               "Top Secret", "Oxygen facilities", "Heavy rolling"}
SYSTEMS_EXTRA = {"Cpu", "Conveyor belts", "Difficulty", "Research System"}
COLONY = {"Colonists", "Oxygen", "Room Construction", "Canteen", "Comfy Chair", "Ergonomic Chair", "Gaming Chair", "Large Dining Table",
          "Lounge Chair", "Simple Chair", "VR Center", "Wide Chair"}
BUILDINGS_EXTRA = {"CPU Data Center": "Science and CPU", "Large Oxygen Receiver": "Life Support", "Large Vehicle Assembly Facility": "Logistics",
                   "Metals Storage": "Storage", "Projector": "Electricity", "Refrigerator": "Storage", "Small Vehicle Assembly Facility": "Logistics",
                   "Standard Wall": "Construction", "Utility Pole": "Electricity", "Vehicle Hangar": "Logistics"}
BUILDING_SUBCATS = {"Production Buildings": "Production", "Storage Buildings": "Storage", "Electricity Buildings": "Electricity",
                    "Logistics Buildings": "Logistics", "Recreation Buildings": "Recreation", "Science and CPU Buildings": "Science and CPU",
                    "Mining and Refining Buildings": "Mining and refining"}
MODULE_CATEGORY = {"Production": "Production", "Storage": "Storage", "Electricity": "Electricity", "Logistics": "Logistics", "Mining": "Mining and refining",
                   "Science": "Science and CPU", "Life Support": "Life support", "Recreation": "Recreation"}

CATEGORIES = [
    {"id": "handbook", "label": "Director’s handbook", "blurb": "How the colony’s money, market and 1.0 systems work."},
    {"id": "resources", "label": "Resources", "blurb": "Raw materials, refined metals and manufactured goods."},
    {"id": "buildings", "label": "Modules", "blurb": "Everything you can build, by module category."},
    {"id": "research", "label": "Research", "blurb": "Technologies in the Fundamental, Engineering and Social branches."},
    {"id": "vehicles", "label": "Drones & vehicles", "blurb": "Drones, rovers, trucks and heavy harvesters."},
    {"id": "colony", "label": "Colonists & rooms", "blurb": "Life support, living quarters and furniture."},
    {"id": "systems", "label": "Systems", "blurb": "Power, CPU, conveyors, upgrades and difficulty."},
    {"id": "story", "label": "Story & events", "blurb": "Quests and events, step by step."},
    {"id": "organizations", "label": "Organizations", "blurb": "Factions and characters of the lunar economy."},
]


def classify(title: str, cats: list[str], infobox_group: str | None) -> tuple[str, str | None]:
    if title in STORY_EXTRA or "Events" in cats:
        return "story", "Main story" if title not in {"Heavy Hauling", "Searching for survivors", "Aurora Project", "Moon location & rewards"} else "Side quests"
    if title in COLONY:
        return "colony", "Furniture" if title not in {"Colonists", "Oxygen", "Room Construction"} else "Life support"
    if title.endswith("(Research)"):
        for c in cats:
            if c.endswith(" Research"):
                return "research", c.replace(" Research", "")
        return "research", "Other"
    if "Resource" in cats:
        return "resources", None
    if "Factions" in cats:
        return "organizations", "Factions"
    if "Characters" in cats:
        return "organizations", "Characters"
    if {"Vehicles", "Small Vehicles", "Large Vehicles"} & set(cats):
        return "vehicles", "Large vehicles" if "Large Vehicles" in cats else "Small vehicles" if "Small Vehicles" in cats else "Drones"
    if "Buildings" in cats or title in BUILDINGS_EXTRA:
        group = infobox_group or next((BUILDING_SUBCATS[c] for c in cats if c in BUILDING_SUBCATS), None) or BUILDINGS_EXTRA.get(title)
        return "buildings", group or "Other"
    if "Game Concepts" in cats or title in SYSTEMS_EXTRA:
        return ("colony", "Life support") if title == "Room Construction" else ("systems", None)
    return "systems", None


selected = {t: p for t, p in PAGES.items() if "/" not in t and t not in SKIP and t not in DUPLICATES}
TITLE_TO_ID = {t: slug(t) for t in selected}
for dup, keep in DUPLICATES.items():
    TITLE_TO_ID[dup] = slug(keep)
NORM_TO_ID = {norm(t): i for t, i in TITLE_TO_ID.items()}

# Names the wiki uses in links that point at renamed or merged pages
LINK_ALIASES = {
    "Regolith Extractor": "Extractor", "Medical Block": "Medical Center", "Medecine": "Medicines", "Simple Resource Storage": "Single Resource Storage",
    "Large Storage": "Large Single Resource Storage", "Hauling Drone Reconfigurator": "Cargo Drone Reconfiguration Module", "Buildings": None,
    "Trading System": None, "Commerce": None, "Outposts": None, "Skills": None, "Resources": None, "CRUST": "CRUST",
    "Energy": None, "Medecines": "Medicines", "Concrete": "Smart Concrete", "Aluminium": "Aluminum", "Titanium Plate": "Titanium Plates",
    "ModularFrame": "Modular Frames", "Modular Frame": "Modular Frames", "TitaniumPlates": "Titanium Plates", "Microcircuit": "Microcircuits",
}
RESOURCE_KEYS = {"concrete": "Smart Concrete", "bluesci": "Fundamental", "orangesci": "Engineering", "greensci": "Social", "helium3": "Helium-3"}


def resolve(target: str) -> str | None:
    target = target.split("#")[0].strip().replace("_", " ")
    if not target:
        return None
    if target in LINK_ALIASES:
        alias = LINK_ALIASES[target]
        return TITLE_TO_ID.get(alias) if alias else None
    if target in TITLE_TO_ID:
        return TITLE_TO_ID[target]
    key = norm(target)
    return NORM_TO_ID.get(key) or NORM_TO_ID.get(key.rstrip("s")) or NORM_TO_ID.get(key + "s")


def link(target: str, label: str | None = None) -> str:
    label = (label or target).strip()
    art = resolve(target)
    return f"{L}{art}{SEP}{label}{R}" if art else label


def resource_link(name: str, amount: str | None = None) -> str:
    key = name.strip()
    title = RESOURCE_KEYS.get(key.lower().replace(" ", ""), key)
    art = resolve(title)
    label = PAGES_TITLE.get(art, title) if art else re.sub(r"([a-z])([A-Z])", r"\1 \2", title)
    text = f"{L}{art}{SEP}{label}{R}" if art else label
    return f"{fmt_int(amount)} {text}" if amount else text


PAGES_TITLE = {i: t for t, i in TITLE_TO_ID.items() if t not in DUPLICATES}


# ------------------------------------------------------------------------------------------------ wikitext -> blocks
UNKNOWN_TEMPLATES: Counter = Counter()
BOILERPLATE_TABLES = [0]
# Icons that carry meaning in quest tables become words
ICON_TEXT = {"credits.webp": " credits", "relation.png": " relations", "reputation.png": " reputation", "bluesci.png": " Fundamental",
             "orangesci.png": " Engineering", "greensci.png": " Social", "energy.png": " energy", "2x.png": "2×"}
SCIENCE = {"fundamental": "Fundamental", "bluesci": "Fundamental", "blue": "Fundamental", "engineering": "Engineering", "orangesci": "Engineering",
           "orange": "Engineering", "social": "Social", "greensci": "Social", "green": "Social"}


def split_params(body: str) -> tuple[str, list[str], dict[str, str]]:
    parts, depth, cur = [], 0, ""
    i = 0
    while i < len(body):
        two = body[i:i + 2]
        if two in ("{{", "[["):
            depth += 1; cur += two; i += 2; continue
        if two in ("}}", "]]"):
            depth -= 1; cur += two; i += 2; continue
        if body[i] == "|" and depth == 0:
            parts.append(cur); cur = ""; i += 1; continue
        cur += body[i]; i += 1
    parts.append(cur)
    name, positional, named = parts[0].strip(), [], {}
    for p in parts[1:]:
        m = re.match(r"^\s*([A-Za-z0-9_ \-#]+?)\s*=(.*)$", p, re.S)
        if m:
            named[m.group(1).strip()] = m.group(2).strip()
        else:
            positional.append(p.strip())
    return name, positional, named


def science_text(named: dict[str, str], positional: list[str]) -> str:
    bits = [f"{fmt_int(v)} {SCIENCE[k]}" for k, v in named.items() if k in SCIENCE and v.strip() not in ("", "0")]
    if not bits and positional:
        bits = [" / ".join(fmt_int(p) for p in positional if p) + " points (branches not stated on the wiki)"]
    return ", ".join(bits)


def rates_row(spec: str) -> str:
    items = []
    for chunk in spec.split("+"):
        if "," in chunk:
            name, amount = chunk.rsplit(",", 1)
            items.append(resource_link(name.strip(), amount.strip()))
        elif chunk.strip():
            items.append(resource_link(chunk.strip()))
    return " + ".join(items)


def render_template(title: str, raw: str, infoboxes: list) -> str:
    name, pos, named = split_params(raw)
    key = name.lower()
    if key in {"version", "stub", "ambox", "navbox-buildings", "navbox-resources", "research navbox", "numberofarticles", "sitename", "mp link"} or key.startswith("#description2"):
        return ""
    if key in {"pagename", "subst:pagename"}:
        return title
    if key in {"building", "research overview", "resource", "infobox-faction", "infobox-character", "infobox-basic", "infobox-resource",
               "infobox-building", "infobox-software"}:
        infoboxes.append((key, named))
        return ""
    if key in {"resource link", "resourcelink"}:
        return resource_link(pos[0] if pos else "", named.get("amount")) if pos else ""
    if key == "itemlink":
        return link(pos[0], pos[1] if len(pos) > 1 else None) if pos else ""
    if key == "research link":
        target = pos[0] if pos else ""
        rid = resolve(f"{target} (Research)") or resolve(target)
        return f"{L}{rid}{SEP}{target.strip()}{R}" if rid else target.strip()
    if key == "resourcecost":
        items = []
        for k, v in named.items():
            if k == "separator":
                continue
            if k == "credits":
                items.append(f"{fmt_int(v)} credits")
            elif k in SCIENCE:
                items.append(f"{fmt_int(v)} {SCIENCE[k]} points")
            else:
                items.append(resource_link(k, v))
        return ", ".join(items)
    if key == "credits":
        return f"{fmt_int(pos[0])} credits" if pos else "credits"
    if key == "energy":
        return f"{pos[0]} energy" if pos else "energy"
    if key == "research":
        label = named.get("name", "Research")
        section = f" ({named['section']})" if named.get("section") else ""
        return f"{BOLD}{label}{BOLD}{section}: {science_text(named, pos)}"
    if key == "sciencecost":
        return ", ".join(f"{fmt_int(v)} {k.split('_')[0].capitalize()}" for k, v in named.items() if v)
    if key == "#invoke:resource":
        return ", ".join(resource_link(p) for p in pos[1:] if p)
    if key == "recipe table/start":
        return f"\n{{|\n|+ {named.get('Caption', '')}\n! Input !! Output\n"
    if key == "recipe table/row":
        return f"|-\n| {rates_row(pos[0] if pos else named.get('Input', ''))} || {rates_row(pos[1] if len(pos) > 1 else named.get('Output', ''))}\n"
    if key == "recipe table/end":
        return "|}\n"
    if key == "productionrates/with2x":
        rows = [("Per minute", "input_per_minute", "output_per_minute"), ("Per day", "input_per_day", "output_per_day"),
                ("Per minute, 2× speed", "input_per_minute_2x", "output_per_minute_2x"), ("Per day, 2× speed", "input_per_day_2x", "output_per_day_2x")]
        out = "\n{|\n! Production !! Input !! Output\n"
        for label, i, o in rows:
            if named.get(i) or named.get(o):
                out += f"|-\n| {label} || {rates_row(named.get(i, ''))} || {rates_row(named.get(o, ''))}\n"
        return out + "|}\n"
    if key == "tabbedsection/hardcoded10max":
        out = ""
        for n in range(1, 11):
            if named.get(f"title_tab_{n}"):
                out += f"\n==== {named[f'title_tab_{n}']} ====\n{named.get(f'content_tab_{n}', '')}\n"
        return out
    if key in {"buildingstats", "survivalbuildingstats"}:
        infoboxes.append((key, {**named, **{str(i + 1): v for i, v in enumerate(pos)}}))
        return ""
    UNKNOWN_TEMPLATES[name] += 1
    return ""


def expand(title: str, text: str, infoboxes: list) -> str:
    inner = re.compile(r"\{\{((?:(?!\{\{|\}\}).)*)\}\}", re.S)
    for _ in range(12):
        new = inner.sub(lambda m: render_template(title, m.group(1), infoboxes), text)
        if new == text:
            break
        text = new
    return text


def inline(title: str, text: str, infoboxes: list) -> str:
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"\[\[Category:[^\]]*\]\]|__[A-Z]+__|</?onlyinclude>|</?includeonly>|<noinclude>.*?</noinclude>", "", text, flags=re.S)
    text = re.sub(r"<ref[^>]*>.*?</ref>|<ref[^>]*/>", "", text, flags=re.S)
    def icon(m: re.Match) -> str:
        name = re.match(r"\[\[(?:File|Image):([^|\]]+)", m.group(0), re.I)
        return ICON_TEXT.get(name.group(1).strip().lower(), "") if name else ""

    for _ in range(3):
        text = re.sub(r"\[\[(?:File|Image):(?:[^\[\]]|\[\[[^\]]*\]\])*\]\]", icon, text, flags=re.I)
    text = re.sub(r"\[\[([^\[\]|]+)\|([^\[\]]*)\]\]", lambda m: link(m.group(1), m.group(2)), text)
    text = re.sub(r"\[\[([^\[\]|]+)\]\]", lambda m: link(m.group(1)), text)
    text = re.sub(r"\[(https?://[^\s\]]+)\s+([^\]]+)\]", lambda m: f"{L}{m.group(1)}{SEP}{m.group(2)}{R}", text)
    text = expand(title, text, infoboxes)
    text = re.sub(r"<tabber>(.*?)</tabber>", lambda m: "\n" + "\n".join(
        f"\n==== {t.split('=', 1)[0].strip()} ====\n{t.split('=', 1)[1] if '=' in t else ''}" for t in m.group(1).split("|-|")) + "\n", text, flags=re.S)
    text = re.sub(r"<br\s*/?>", BR, text, flags=re.I)
    text = re.sub(r"</?b>", BOLD, text)
    text = re.sub(r"<blockquote>", "\n\x01quote\n", text)
    text = re.sub(r"</blockquote>", "\n\x01end\n", text)
    text = re.sub(r"</?(?:div|span|center|code|h|nowiki|small|big|u|s|sup|sub)[^>]*>", "", text, flags=re.I)
    text = text.replace("&nbsp;", " ").replace("&#32;", " ").replace("&#8239;", " ").replace("&amp;", "&")
    text = re.sub(r"'''''(.+?)'''''", BOLD + r"_\1_" + BOLD, text)
    text = re.sub(r"'''(.+?)'''", BOLD + r"\1" + BOLD, text)
    text = re.sub(r"''(.+?)''", r"_\1_", text)
    return text


def clean_cell(s: str) -> str:
    s = s.strip()
    m = re.match(r'^\s*(?:(?:style|class|rowspan|colspan|align|width|scope)\s*=\s*"[^"]*"\s*)+\|(.*)$', s, re.S)
    if m:
        s = m.group(1)
    s = re.sub(rf"\s*{BR}\s*", "\n", s)
    return re.sub(r"[ \t]+", " ", s).strip()


def parse_table(lines: list[str]) -> dict | None:
    caption, rows, cur = None, [], None
    for line in lines:
        s = line.strip()
        if s.startswith("|+"):
            caption = clean_cell(s[2:])
        elif s.startswith("|-"):
            if cur:
                rows.append(cur)
            cur = []
        elif (s.startswith("||") or s.startswith("!!")) and cur is not None:
            # A row whose cells continue on the next line: "| a" then "|| b"
            cur += [(clean_cell(c), s.startswith("!!")) for c in re.split(r"!!|\|\|", s[2:])]
        elif s.startswith("!"):
            cur = cur if cur is not None else []
            cur += [(clean_cell(c), True) for c in re.split(r"!!|\|\|", s[1:])]
        elif s.startswith("|"):
            cur = cur if cur is not None else []
            cur += [(clean_cell(c), False) for c in s[1:].split("||")]
        elif cur:
            text, head = cur[-1]
            cur[-1] = ((text + "\n" + clean_cell(s)).strip(), head)
    if cur:
        rows.append(cur)
    rows = [r for r in rows if any(c for c, _h in r)]
    if not rows:
        return None
    head: list[str] = []
    if all(h for _c, h in rows[0]):
        head = [c for c, _h in rows[0]]
        rows = rows[1:]
    body = [[f"{BOLD}{c}{BOLD}" if h and c and i == 0 and not head else c for i, (c, h) in enumerate(r)] for r in rows]
    width = max([len(head)] + [len(r) for r in body])
    body = [r + [""] * (width - len(r)) for r in body]
    head = head + [""] * (width - len(head)) if head else []
    if caption in (None, "", "Caption text"):
        caption = None
    return {"t": "table", "caption": caption, "head": head, "rows": body}


def to_blocks(text: str) -> list[dict]:
    blocks: list[dict] = []
    para: list[str] = []
    lines = text.split("\n")
    quote = False

    def flush():
        nonlocal para
        joined = re.sub(r"[ \t]+", " ", " ".join(p.strip() for p in para)).replace(BR, "\n").strip()
        if joined:
            blocks.append({"t": "quote" if quote else "p", "text": joined})
        para = []

    i = 0
    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if s.startswith("{|"):
            flush()
            depth, body = 1, []
            i += 1
            while i < len(lines) and depth:
                t = lines[i].strip()
                if t.startswith("{|"):
                    depth += 1
                elif t.startswith("|}"):
                    depth -= 1
                    if not depth:
                        break
                body.append(lines[i])
                i += 1
            table = parse_table(body)
            if table and [plain(h) for h in table["head"][:3]] == ["Mining", "Production", "Electricity"]:
                # The resource pages' copied "every building by category" grid; "Used to build" (from each module's own cost) replaces it
                BOILERPLATE_TABLES[0] += 1
            elif table:
                blocks.append(table)
        elif s in ("\x01quote", "\x01end"):
            flush()
            quote = s == "\x01quote"
        elif m := re.match(r"^(={2,5})\s*(.+?)\s*\1\s*$", s):
            flush()
            blocks.append({"t": "h", "level": min(4, len(m.group(1))), "text": m.group(2).strip("= ")})
        elif m := re.match(r"^([*#]+)\s*(.*)$", s):
            flush()
            kind = "ol" if m.group(1)[0] == "#" else "ul"
            item = ("– " if len(m.group(1)) > 1 else "") + m.group(2).replace(BR, " ").strip()
            if blocks and blocks[-1]["t"] == kind and blocks[-1].get("open"):
                blocks[-1]["items"].append(item)
            else:
                blocks.append({"t": kind, "items": [item], "open": True})
        elif s.startswith(";"):
            flush()
            term, _, rest = s[1:].partition(":")
            blocks.append({"t": "p", "text": f"**{term.strip()}** {rest.strip()}".strip()})
        elif s == "" or s == "----":
            flush()
            if blocks and blocks[-1].get("open"):
                blocks[-1]["open"] = False
        else:
            if blocks and blocks[-1].get("open"):
                blocks[-1]["open"] = False
            para.append(s.lstrip(":"))
        i += 1
    flush()
    for b in blocks:
        b.pop("open", None)
        if b["t"] in ("ul", "ol"):
            b["items"] = [x for x in b["items"] if x.strip(" –")]
    blocks = [b for b in blocks if b["t"] not in ("ul", "ol") or b["items"]]
    # Drop headings with nothing under them (the wiki's empty "== Description ==" placeholders)
    pruned: list[dict] = []
    for idx, b in enumerate(blocks):
        if b["t"] == "h":
            nxt = next((x for x in blocks[idx + 1:]), None)
            if nxt is None or (nxt["t"] == "h" and nxt["level"] <= b["level"]):
                continue
        pruned.append(b)
    return pruned


def finalize(value):
    """Protected tokens -> [[id|label]] markup that the dashboard's RichText renders."""
    if isinstance(value, str):
        return value.replace(L, "[[").replace(SEP, "|").replace(R, "]]").replace(BOLD, "**")
    if isinstance(value, list):
        return [finalize(v) for v in value]
    if isinstance(value, dict):
        return {k: finalize(v) for k, v in value.items()}
    return value


# ------------------------------------------------------------------------------------------------ infobox -> facts
def cost_list(spec: str) -> list[dict]:
    items = []
    for chunk in re.split(r",|\n", spec):
        if ":" in chunk:
            name, amount = chunk.split(":", 1)
            art = resolve(RESOURCE_KEYS.get(norm(name), name))
            if name.strip():
                items.append({"id": art, "name": PAGES_TITLE.get(art, name.strip()) if art else name.strip(), "amount": fmt_int(amount)})
    return items


def names_list(spec: str, research: bool = False) -> str:
    out = []
    for n in re.split(r",", plain(spec)):
        n = n.strip()
        if not n or n.lower() in ("none", "n/a", "-"):
            continue
        target = resolve(f"{n} (Research)") if research else None
        target = target or resolve(n)
        out.append(f"{L}{target}{SEP}{n}{R}" if target else n)
    return ", ".join(out)


def infobox_facts(title: str, infoboxes: list, blocks_extra: list) -> tuple[list[dict], list[dict], str | None, str | None]:
    facts: list[dict] = []
    costs: list[dict] = []
    summary: str | None = None
    group: str | None = None

    def add(label: str, value: str | None):
        if value is None:
            return
        value = re.sub(r"\s+", " ", value.replace(BR, " ")).strip()
        if value and value.lower() not in ("tbd", "?", "none"):
            facts.append({"label": label, "value": value})

    for key, p in infoboxes:
        g = lambda *names: next((p[n] for n in names if p.get(n, "").strip()), None)  # noqa: E731
        if key == "building":
            summary = g("MainContent") or summary
            group = MODULE_CATEGORY.get((g("Module Category") or "").strip(), (g("Module Category") or "").strip() or None)
            add("Module category", g("Module Category"))
            add("Research branch", g("ResearchType"))
            research = g("Required Research", "Research", "ResearchName")
            add("Unlocked by", names_list(research, research=True) if research else None)
            purchase = g("Purchase Cost", "Purchase", "Purchse")
            add("Buy price", f"{fmt_int(purchase)} credits" if purchase and re.search(r"\d", purchase) else None)
            add("Power use", g("Power Consumption"))
            add("Power output", g("Power Production"))
            add("Power storage", g("Power Capacity"))
            add("CPU use", g("CPU Consumption", "CPU COnsumption", "CPU Cnsumption"))
            add("CPU provided", g("CPU Production"))
            add("Water use", g("Water Consumption"))
            add("Water output", g("Water Production"))
            add("Oxygen use", g("Oxygen Consumption"))
            add("Oxygen output", g("Oxygen Production"))
            add("Oxygen storage", g("Oxygen Capacity"))
            add("Colonist jobs", g("Colonist Positions", "Colonists"))
            add("Placement", "Indoors" if (g("Indoors") or "").lower().startswith("mand") else "Surface" if g("Surface") else None)
            add("Inputs", g("Inputs"))
            add("Outputs", g("Outputs"))
            if g("Construction Cost", "Cost"):
                costs.append({"label": "Construction cost", "items": cost_list(g("Construction Cost", "Cost") or "")})
            if g("Repairs With", "RepairsWith"):
                costs.append({"label": "Repairs use", "items": cost_list(g("Repairs With", "RepairsWith") or "")})
        elif key == "research overview":
            summary = g("Description") or summary
            group = (g("Research Category", "Category") or "").strip() or None
            add("Branch", g("Research Category", "Category"))
            for branch in ("Fundamental", "Engineering", "Social"):
                if g(branch):
                    add(f"{branch} points", fmt_int(g(branch) or ""))
            add("Requires", names_list(g("Requires Research") or "", research=True) if g("Requires Research") else None)
            add("Unlocks research", names_list(g("Unlocks Research") or "", research=True) if g("Unlocks Research") else None)
            add("Unlocks modules", names_list(g("Unlocks Buildings", "Unlocks") or "") if g("Unlocks Buildings", "Unlocks") else None)
            add("Other effects", g("Other"))
        elif key in ("resource", "infobox-resource"):
            add("Made or found in", g("obtainedby"))
            add("Used by", g("usedby"))
            if g("craftingcost"):
                add("Made from", g("craftingcost"))
            if g("usedfor"):
                blocks_extra.append({"t": "h", "level": 2, "text": "Used for"})
                blocks_extra.extend(to_blocks(p["usedfor"]))
        elif key == "infobox-faction":
            add("Founder", g("founder"))
            add("Founded", g("founded"))
            add("Headquarters", g("headquarters", "hq", "location"))
            add("Type", g("type"))
        elif key == "infobox-character":
            add("Faction", g("faction"))
        elif key == "infobox-building":
            add("Unlocked by", names_list(g("researchname") or "", research=True) if g("researchname") else None)
            if g("greensci"):
                add("Social points", fmt_int(g("greensci") or ""))
        elif key == "buildingstats":
            add("Research branch", p.get("1") or p.get("researchtype"))
            add("Power use", p.get("3") or p.get("power"))
            add("CPU", p.get("4") or p.get("cpu"))
        elif key == "survivalbuildingstats":
            add("Power use", p.get("power") or p.get("1"))
            add("Water use", p.get("water") or p.get("2"))
            add("Oxygen use", p.get("oxygen") or p.get("3"))
            add("Colonist jobs", p.get("colonists") or p.get("4"))
            add("CPU use", p.get("cpu") or p.get("5"))
    return facts, costs, summary, group


# ------------------------------------------------------------------------------------------------ 1.0 game text attached to articles
ATLAS_TO_TITLE = {
    "CPU": "Cpu", "Battery": "Battery", "Assembler": "Assembler", "Ventilation": "Indoor Ventilation", "Cargo Dock": "Cargo Dock", "Ore Detector": "Ore Detector",
    "Mining Drones": "Drones", "Drones": "Drones", "Standard Drones": "Drones", "Parts Factory": "Components Factory",
    "Modular Terminals Factory": "Modular Terminals Factory", "Smart Concrete Factory": "Smart Concrete Factory", "Carbon Fiber Factory": "Carbon Fiber Factory",
    "Electrolysis Plant": "Electrolysis Plant", "Charging Stations": "Charging Station", "AI Center": "AI Center", "Conveyor": "Conveyor belts",
    "Underground Conveyor": "Conveyor belts", "Conveyor Lift": "Conveyor Elevator", "Medical Center": "Medical Center",
    "Drone Configuration Module": "Drone Reconfiguration Module", "Multi-Regolith Refinery": "Multi-Regolith Refinery", "Single Storage": "Single Resource Storage",
    "Single Regolith Refinery": "Single Regolith Refinery", "Smelting Furnace": "Smelting Furnace", "Ice Melter": "Ice Melter", "Landing Platform": "Landing Platform",
    "Pressing Machine": "Pressing Module", "Projector": "Projector", "Rolling Mill": "Rolling Mill", "RTG": "RTG", "Repeater": "Repeater", "Rover": "Rover Scout",
    "Smart Concrete": "Smart Concrete", "Tech Center": "Tech Center", "Fuel Generator": "Fuel Generator", "Fuel Plant": "Fuel Factory",
    "Transport Cannon": "Rail Gun", "Microchip Factory": "Microcircuits Factory", "Pharmaceutical Factory": "Pharmaceutical Factory",
    "Small Equipment Assembly Shop": "Small Vehicle Assembly Facility", "Heavy Equipment Assembly Shop": "Large Vehicle Assembly Facility",
    "Expedition Center": "Expedition Control Center", "Ice Extractor": "Ice Extractor", "Regolith Extractor": "Extractor", "Fusion Generator": "Fusion Reactor",
    "Hi-Tech Constructor": "Hi-Tech Factory", "Data Centers": "CPU Data Center", "Mission Control Center, MCC": "Flight Control Center",
    "Training Center": "Training Module", "Biogenerator": "Bioreactor", "Science Points": "Research System", "Solar Panel": "Small Solar Panel",
}
# Atlas entries with no wiki page become articles of their own
ATLAS_ONLY = {
    "Launch Station": ("buildings", "Logistics"), "Connector": ("buildings", "Electricity"), "Data Center": ("buildings", "Science and CPU"),
    "Anomalies": ("systems", None), "CRUST Solutions": ("handbook", None), "Online Market": ("handbook", None),
}

# Resources as the game's EResourceType enum names them (what CrustWatcher and Stats.bin report) -> wiki titles
ENUM_TO_TITLE = {
    "Regolith": "Regolith", "TitanOxide": "Titanium Oxide", "IronOxide": "Iron Oxide", "SiliconOxide": "Silicon Oxide", "AluminiumOxide": "Aluminum Oxide",
    "Slag": "Slag", "Titan": "Titanium", "Aluminium": "Aluminum", "Steel": "Steel", "Silicon": "Silicon", "Concrete": "Smart Concrete",
    "RareMinerals": "Rare Earth Minerals", "RareElements": "Rare Earth Elements", "DuralPlate": "Duralumin Plates", "Microchip": "Microcircuits",
    "TitanPlate": "Titanium Plates", "Parts": "Components", "ModularFrame": "Modular Frames", "CarbonFiber": "Carbon Fiber", "ElectricPart": "Modular Terminals",
    "Nanotube": "Nanotubes", "ControlUnit": "Control Unit", "Composite": "Composites", "Water": "Water", "Oxygen": "Oxygen", "Organics": "Organics",
    "Food": "Food", "Medicines": "Medicines", "Fuel": "Fuel", "Helium3": "Helium-3", "EnergyCell": "Energy Cells", "FundamentalResearchPoint": "Fundamental",
    "EngineeringResearchPoint": "Engineering", "SocialResearchPoint": "Social", "Microprocessor": "Microprocessors", "WaterIce": "Water Ice",
    "Plasteel": "Plasteel", "AluClear": "Transparent Aluminum", "Neurostimulator": "Neurostimulator", "Supercapacitor": "Supercapacitor",
    "QuantumComputer": "Quantum Computer", "Argon": "Argon", "Methane": "Methane", "Neon": "Neon",
}
GAS_ONLY = {"Argon", "Methane", "Neon"}


# ------------------------------------------------------------------------------------------------ build wiki articles
articles: dict[str, dict] = {}
report_missing: list[str] = []
text_checks = Counter()

for title, page in sorted(selected.items()):
    infoboxes: list = []
    body = inline(title, page["content"], infoboxes)
    extra: list[dict] = []
    facts, costs, summary, ib_group = infobox_facts(title, infoboxes, extra)
    blocks = to_blocks(body) + extra
    category, group = classify(title, page["categories"], ib_group)
    version_m = re.search(r"\{\{\s*Version\s*\|\s*([0-9][0-9.]*)\s*\}\}", page["content"])
    version = version_m.group(1) if version_m else None
    edited = (page.get("timestamp") or "")[:10] or None
    stub = "Stubs" in page["categories"] or bool(re.search(r"\{\{\s*Stub", page["content"], re.I))

    base = re.sub(r"\s*\((?:Research|Quest|quest)\)$", "", title)
    if norm(base) in GAME_NAMES:
        name_check = "exact"
    elif re.search(r"\b" + re.escape(norm_text(base)) + r"\b", GAME_TEXT_ALL):
        name_check = "mentioned"
    else:
        name_check = "missing"
        report_missing.append(title)

    text_match = None
    if summary:
        text_match = norm_text(plain(summary)) in GAME_TEXT_ALL
        text_checks["match" if text_match else "differs"] += 1

    if version and version.startswith("1."):
        status = "verified"
        note = f"Wiki editors checked this page against version {version}."
    elif version:
        status = "early-access"
        note = f"Last checked on Early Access build {version}. 1.0 rebuilt logistics and excavation and added roads, so figures may have changed."
    else:
        status = "unversioned"
        note = f"The wiki page doesn’t say which game version it describes. Last edited {edited}."

    summary_text = plain(inline(title, summary, [])) if summary else None
    if not summary_text:
        first_p, heading = "", None
        for b in blocks:
            if b["t"] == "h":
                heading = b["text"].lower()
            elif b["t"] == "p":
                if heading in (None, "description", "about", "introduction"):
                    first_p = b["text"]
                break
        text = plain(first_p)
        summary_text = (text if len(text) <= 220 else text[:217].rsplit(" ", 1)[0] + "…") if len(text) >= 40 else None

    art_id = TITLE_TO_ID[title]
    aliases = [title] if title == base else [title, base]
    if title in DUPLICATES.values():
        aliases += [d for d, k in DUPLICATES.items() if k == title]
    articles[art_id] = {
        "id": art_id, "title": DISPLAY_TITLES.get(title, title), "category": category, "group": group,
        "summary": summary_text, "facts": facts, "costs": [c for c in costs if c["items"]],
        "gameText": [], "blocks": blocks, "xref": [], "companion": [],
        "source": {"kind": "wiki", "url": WIKI + urllib.parse.quote(title.replace(" ", "_")), "edited": edited, "version": version,
                   "license": "CC BY-SA 4.0"},
        "alignment": {"status": status, "note": note, "gameName": name_check, "textMatch": text_match, "inGameAs": RENAMED.get(title)},
        "stub": stub, "aliases": aliases, "linkTerms": [],
    }

# 1.0 in-game encyclopedia text
for head, paragraphs in ATLAS.items():
    title = ATLAS_TO_TITLE.get(head)
    if title and TITLE_TO_ID.get(title) in articles:
        art = articles[TITLE_TO_ID[title]]
        art["gameText"].append({"heading": head, "paragraphs": paragraphs})
        generic = {"Data Centers", "Science Points", "Mining Drones", "Standard Drones", "Underground Conveyor", "Solar Panel", "Conveyor", "Charging Stations"}
        if norm(head) != norm(title) and head not in generic:
            art["alignment"]["inGameAs"] = head.replace(", MCC", "")
        if head not in art["aliases"]:
            art["aliases"].append(head)
    elif head in ATLAS_ONLY:
        category, group = ATLAS_ONLY[head]
        art_id = slug(head)
        articles[art_id] = {
            "id": art_id, "title": head, "category": category, "group": group, "summary": paragraphs[0][:220],
            "facts": [], "costs": [], "gameText": [{"heading": head, "paragraphs": paragraphs}], "blocks": [], "xref": [], "companion": [],
            "source": {"kind": "game", "url": None, "edited": None, "version": GAME_VERSION, "license": None},
            "alignment": {"status": "game", "note": f"In-game encyclopedia text from version {GAME_VERSION}. The wiki has no page for this yet.",
                          "gameName": "exact", "textMatch": True},
            "stub": False, "aliases": [head], "linkTerms": [],
        }
        TITLE_TO_ID[head] = art_id
        PAGES_TITLE[art_id] = head
    else:
        print(f"  atlas entry not attached: {head}")

# Gas resources listed in 1.0 with no wiki page
for gas in sorted(GAS_ONLY):
    art_id = slug(gas)
    if art_id in articles:
        continue
    articles[art_id] = {
        "id": art_id, "title": gas, "category": "resources", "group": None,
        "summary": f"A gas resource listed in the {GAME_VERSION} game files. The wiki has no page for it yet.",
        "facts": [], "costs": [], "gameText": [], "blocks": [
            {"t": "p", "text": (f"{gas} appears in the game’s resource list and in the research “Recipes using {gas}”. " if gas != "Methane" else f"{gas} appears in the game’s resource list. ")
                               + f"Gases are collected by the [[{slug('Gas Extractor')}|Gas Extractor]] and kept in [[{slug('Gas Storage')}|Gas Storage]]."}],
        "xref": [], "companion": [],
        "source": {"kind": "game", "url": None, "edited": None, "version": GAME_VERSION, "license": None},
        "alignment": {"status": "game", "note": f"Name taken from the {GAME_VERSION} game files; no wiki page yet.", "gameName": "exact", "textMatch": None},
        "stub": True, "aliases": [gas], "linkTerms": [],
    }
    TITLE_TO_ID[gas] = art_id
    PAGES_TITLE[art_id] = gas


# ------------------------------------------------------------------------------------------------ handbook (written for this dashboard from the game's own text)
def news(title_pattern: str) -> dict:
    for n in NEWS:
        if re.search(title_pattern, n["title"]):
            return n
    raise SystemExit(f"news not found: {title_pattern}")


def news_url(n: dict) -> str:
    return n["url"].replace("http://", "https://")


rel = news(r"1\.0 is OUT NOW")
hf6 = news(r"^Hotfix 1\.0\.6$")
hf61 = news(r"^Hotfix 1\.06\.1$")
eve = news(r"1\.0 is coming TOMORROW")
day = lambda n: dt.datetime.fromtimestamp(n["date"], dt.UTC).strftime("%Y-%m-%d")  # noqa: E731

HANDBOOK_TITLES = ["What’s new in 1.0", "Online Market", "Credits", "Capitalization", "Contracts and tenders", "Auto-trading", "Bank and reputation",
                   "Points of interest", "Construction costs"]
for _t in HANDBOOK_TITLES:  # registered first so handbook pages can link to each other
    TITLE_TO_ID.setdefault(_t, slug(_t))

A = lambda t: f"[[{TITLE_TO_ID[t]}|{t}]]"  # noqa: E731  link to an article by exact title
Al = lambda t, label: f"[[{TITLE_TO_ID[t]}|{label}]]"  # noqa: E731

HANDBOOK = [
    {
        "title": "What’s new in 1.0",
        "summary": "Planning Mode, roads, rebuilt logistics and the finished story, plus what hotfixes 1.0.6 and 1.0.6.1 changed.",
        "linkTerms": ["1.0"],
        "companion": [],
        "blocks": [
            {"t": "p", "text": f"The Crust left Early Access on **{RELEASE_DATE}**. Your game reports version **{GAME_VERSION}**, the newest build as of {day(hf61)}."},
            {"t": "h", "level": 2, "text": "Headline changes"},
            {"t": "ul", "items": [
                f"**Planning Mode.** {game_line(r'^Planning Mode allows you to design')}",
                f"**Roads and parking.** {game_line(r'^Roads allow truck routes')} Trucks take the shortest route and use the nearest road.",
                "**Rebuilt logistics.** Developers report up to ~50% better performance on large bases, lower memory use and smaller saves.",
                "**Switch resource types** on a module without rebuilding it or its conveyors, and choose where resources come from and go.",
                "**The complete story** with multiple endings, new maps, new modules, room wall styles and an online leaderboard (base capitalization and its growth rate).",
                "**macOS and Linux** versions, and a Turkish translation.",
            ]},
            {"t": "h", "level": 2, "text": "Early Access saves don’t load in 1.0"},
            {"t": "p", "text": "Logistics and excavation were restructured and roads were added, so old bases can’t be converted. The last Early Access build stays on the Steam beta branch **Previous** (Properties → Betas)."},
            {"t": "h", "level": 2, "text": f"Hotfix 1.0.6 ({day(hf6)})"},
            {"t": "ul", "items": [
                "Remove roads with the Universal Demolition tool; demolishing roads now refunds the credits spent.",
                "Resource veins generate with a larger radius.",
                "Pressing Esc when an urgent story contract appeared no longer blocks the quest.",
                "The credit deduction sound follows the audio settings; settings layout improved; shower balance; localization fixes; two new music tracks.",
                "macOS: hold Space for 5 seconds to skip a video (workaround for black screens).",
            ]},
            {"t": "h", "level": 2, "text": f"Hotfix 1.0.6.1 ({day(hf61)})"},
            {"t": "ul", "items": ["Fixes walls that sometimes got stuck on doors after loading a save."]},
            {"t": "h", "level": 2, "text": "How current is this wiki?"},
            {"t": "p", "text": "__COVERAGE__"},
        ],
        "sources": [
            {"label": f"The Crust – 1.0 is OUT NOW ({day(rel)})", "href": news_url(rel)},
            {"label": f"Hotfix 1.0.6 ({day(hf6)})", "href": news_url(hf6)},
            {"label": f"Hotfix 1.06.1 ({day(hf61)})", "href": news_url(hf61)},
            {"label": f"1.0 is coming tomorrow: save compatibility ({day(eve)})", "href": news_url(eve)},
        ],
        "sourceText": "Steam announcements by Veom Studio; Game.locres (1.0.6.1)",
    },
    {
        "title": "Online Market",
        "summary": "Buy what production lacks and sell surplus. Prices fall as you add supply, and every shipment goes by capsule.",
        "linkTerms": ["Online Market", "market"],
        "companion": [{"label": "Live market prices", "target": "module:resources"}, {"label": "Market alerts", "target": "module:alerts"}],
        "blocks": [
            {"t": "h", "level": 2, "text": "Getting access"},
            {"t": "p", "text": f"{game_line(r'^I have a solution to our problems, Director')}"},
            {"t": "p", "text": f"Research it under Social, then build a {A('Landing Platform')}. {game_line(r'^Everything is ready for trading. You can now sell')}"},
            {"t": "h", "level": 2, "text": "Prices"},
            {"t": "ul", "items": [
                "**Sell price** is the market’s current price, rounded down.",
                "**Buy price** is the current price times a markup that differs by resource (×1.1 to ×1.4 in the data read so far).",
                "Each resource has a **base price** and can only move inside a band around it, for example ×0.5 to ×1.5 for Smart Concrete and ×0.82 to ×1.18 for Quantum Computers.",
                "**Supply** is compared with a normal market volume. Resources well below normal volume sell above base; well above normal, below base.",
                "The market keeps a **30-day price history** for each resource.",
            ]},
            {"t": "p", "text": "_These price rules were read from the running 1.0.6.1 game by CrustWatcher, not from a published formula._"},
            {"t": "h", "level": 2, "text": "Selling well"},
            {"t": "ul", "items": [
                "Selling adds supply, so a large sale gets a lower average price than the quoted one. Split big sales when the price is near its 30-day high.",
                f"Shipments go by capsule and have a transport cost; see {Al('Contracts and tenders', 'contracts')} for why the AI Analyst’s estimates leave it out.",
                f"Your reputation affects market prices; see {A('Bank and reputation')}.",
                f"With {Al('Auto-trading', 'auto-trading')}, visiting ships buy and sell for you when your price is competitive.",
            ]},
        ],
        "sourceText": "Game.locres (1.0.6.1); live market data read by CrustWatcher",
    },
    {
        "title": "Credits",
        "summary": "Your company’s cash. Building, conveyors, wires and capsule shipments all spend it.",
        "linkTerms": ["credits"],
        "companion": [{"label": "Credits and runway", "target": "module:credits"}, {"label": "Income & spending", "target": "module:flows"}],
        "blocks": [
            {"t": "p", "text": "Credits pay for construction, including **conveyors and electrical wires**, and for **capsule shipments** to contracts and the market, which carry transport costs."},
            {"t": "quote", "text": game_line(r"logistics (?:will )?(?:come|comes) to a halt|without funds", )},
            {"t": "h", "level": 2, "text": "Where credits come from"},
            {"t": "p", "text": f"{Al('Contracts and tenders', 'Contract rewards')}, {Al('Online Market', 'market sales')}, {Al('Points of interest', 'points of interest')}, construction refunds and the {Al('Bank and reputation', 'bank')}."},
            {"t": "h", "level": 2, "text": "Where they go"},
            {"t": "p", "text": "Market purchases, construction, colonist salaries, contract and point-of-interest penalties, loan payments, probe purchases, area rent and outpost purchases. These are the categories the game records in its statistics."},
            {"t": "h", "level": 2, "text": "Running low"},
            {"t": "p", "text": f"{game_line(r'^Director, the situation is not as critical as Alice describes')} {game_line(r'^Yes, the payments will include interest')}"},
            {"t": "p", "text": f"CRUST Solutions and the Online Market also sell what you’re missing; see {A('CRUST Solutions')}."},
        ],
        "sourceText": "Game.locres (1.0.6.1); Stats.bin categories",
    },
    {
        "title": "Capitalization",
        "summary": "The game’s valuation of your company: credits plus modules, conveyors, living quarters, drones, vehicles and stock.",
        "linkTerms": ["capitalization", "net worth"],
        "companion": [{"label": "Net worth breakdown", "target": "module:networth"}],
        "blocks": [
            {"t": "p", "text": "Capitalization is what the dashboard calls **net worth**. It counts your credits and what you’ve invested: construction of modules, conveyors and living quarters, module upgrades, drones and vehicles, and stored resources."},
            {"t": "ul", "items": [
                game_line(r"^The player receives 1 capitalization point"),
                game_line(r"^Added the construction cost of living quarters to the capitalization"),
                game_line(r"^Fixed a bug where demolishing conveyors did not subtract their cost from capitalization"),
            ]},
            {"t": "p", "text": "In 1.0 the online **leaderboard** ranks bases by capitalization and by its growth rate."},
            {"t": "h", "level": 2, "text": "Checked against a save"},
            {"t": "p", "text": "Global capitalization equals the sum of the parts the game records plus player credits. Drones are valued at the market’s base price for a drone: 15 drones × 46,000 = 690,000 in the save used to check this."},
        ],
        "sourceText": "Game.locres patch notes (1.0.6.1); Stats.bin; 1.0 release notes",
    },
    {
        "title": "Contracts and tenders",
        "summary": "Deliver resources to organizations for credits, research points and reputation. Late or cancelled contracts cost you.",
        "linkTerms": ["contracts", "contract", "tender system", "tenders"],
        "companion": [{"label": "Contract rewards in Income & spending", "target": "module:flows"}, {"label": "Contract calculator", "target": "module:calculator"}],
        "blocks": [
            {"t": "p", "text": f"Contracts need the {Al('Access To The Tender System (Research)', 'Access to the Tender System')} research (500 Social points) and a {A('Landing Platform')} to ship from."},
            {"t": "quote", "text": game_line(r"^Director, I congratulate you - our lunar production is so popular")},
            {"t": "ul", "items": [
                "Rewards can include credits, research points, relations with the organization and global reputation.",
                "Late and cancelled contracts carry **penalties**, recorded as their own spending category.",
                "The AI Analyst’s profit estimate doesn’t include capsule costs or market demand limits.",
                f"Urgent contracts pay more. {game_line(r'^Certainly this is great news, and by fulfilling Urgent Contracts')}",
            ]},
            {"t": "p", "text": f"The story walks you into your first contracts in {A('A Million Opportunities')}."},
        ],
        "sourceText": "Game.locres (1.0.6.1); The Crust Wiki",
    },
    {
        "title": "Auto-trading",
        "summary": "Standing buy and sell orders filled by visiting ships, run from the Mission Control Center.",
        "linkTerms": ["auto-trading", "auto-sell", "auto-buy"],
        "companion": [{"label": "Market sales in Income & spending", "target": "module:flows"}],
        "blocks": [
            {"t": "p", "text": f"Client ships visit your base and buy your resources automatically when your price is competitive. Orders are managed at the {Al('Flight Control Center', 'Mission Control Center')}."},
            {"t": "ul", "items": [
                game_line(r"^Increases the number of simultaneously open auto-buy or auto-sell orders"),
                game_line(r"^Increases the number of simultaneously open auto-sell orders"),
                game_line(r"^Added a button for selling or buying at market price to auto-trading"),
            ]},
        ],
        "sources": [{"label": "Dev Diary #25: auto-trading, colonists, new resources", "href": "https://veomstudio.com/news/dnevnik-razrabotchikov-25-gazovaya-sistema-uluchshenie-kolonistov-i-novye-resursy/"}],
        "sourceText": "Game.locres (1.0.6.1); Dev Diary #25",
    },
    {
        "title": "Bank and reputation",
        "summary": "Loans with monthly payments from the Commercial Center, priced by your global reputation.",
        "linkTerms": ["loan", "loans", "reputation", "bank"],
        "companion": [{"label": "Loan payments in Income & spending", "target": "module:flows"}],
        "blocks": [
            {"t": "h", "level": 2, "text": "Loans"},
            {"t": "p", "text": f"{game_line(r'^I also remind you about the option to take a loan')}"},
            {"t": "p", "text": "The interest rate depends on your global reputation, and there’s a maximum number of loans."},
            {"t": "h", "level": 2, "text": "Global reputation"},
            {"t": "quote", "text": game_line(r"^Affects the number of colonists in the hiring pool, loans, market prices")},
        ],
        "sourceText": "Game.locres (1.0.6.1)",
    },
    {
        "title": "Points of interest",
        "summary": "Sites found by rovers, repeaters and probes. Studying them earns research points and rewards.",
        "linkTerms": ["points of interest", "point of interest", "probes"],
        "companion": [{"label": "Point-of-interest income", "target": "module:flows"}],
        "blocks": [
            {"t": "p", "text": f"Your {A('Rover Scout')}, the {A('Repeater')} and probes launched from the {Al('Rail Gun', 'Transport Cannon')} find sites across the Moon. Studying them earns research points and rewards; some carry penalties."},
            {"t": "p", "text": f"Science outposts on anomalies add research points every day, for example: _{game_line(r'^\+100 Engineering Science Points daily')}_"},
            {"t": "p", "text": f"The wiki’s {A('Moon location & rewards')} table lists locations and rewards by difficulty. See also {A('Anomalies')}."},
        ],
        "sourceText": "Game.locres (1.0.6.1); The Crust Wiki",
    },
    {
        "title": "Construction costs",
        "summary": "Building spends credits, including conveyors and wires, and counts toward capitalization.",
        "linkTerms": ["construction"],
        "companion": [{"label": "Construction spending", "target": "module:flows"}, {"label": "Buildings & capacity", "target": "module:buildings"}],
        "blocks": [
            {"t": "p", "text": f"Modules cost resources to build and credits to place; conveyors and electrical wires cost credits too. Everything you build counts toward {Al('Capitalization', 'capitalization')}."},
            {"t": "ul", "items": [
                f"Demolishing refunds part of the cost; the {Al('Conveyor belts', 'Complete recycling of conveyors and wires')} research raises conveyor refunds to 100%.",
                "Since hotfix 1.0.6, removing roads with the Universal Demolition tool refunds their credits correctly.",
                f"{game_line(r'^Planning Mode allows you to design')}",
            ]},
        ],
        "sourceText": "Game.locres (1.0.6.1); Steam hotfix 1.0.6 notes; The Crust Wiki",
    },
]

# Game text the old explainers quoted, attached to the matching wiki articles
EXTRA_GAME_TEXT = {
    "Cpu": ("Advisor", [game_line(r"^Director, CPU is the heart of our base"), game_line(r"^An important note, if I may: Data centers are very particular"),
                        game_line(r"^By studying new technologies, we can replace low-efficiency modules")]),
    "Slag": ("Game text", [game_line(r"mountains of slag accumulating behind the smelter")]),
}

for h in HANDBOOK:
    art_id = slug(h["title"])
    TITLE_TO_ID[h["title"]] = art_id
    PAGES_TITLE[art_id] = h["title"]
for h in HANDBOOK:
    art_id = slug(h["title"])
    existing = articles.get(art_id)
    articles[art_id] = {
        "id": art_id, "title": h["title"], "category": "handbook", "group": None, "summary": h["summary"],
        "facts": [], "costs": [], "gameText": existing["gameText"] if existing else [], "blocks": h["blocks"], "xref": [], "companion": h["companion"],
        "source": {"kind": "handbook", "url": None, "edited": dt.date.today().isoformat(), "version": GAME_VERSION, "license": None,
                   "text": h["sourceText"], "links": h.get("sources", [])},
        "alignment": {"status": "handbook", "note": f"Written for this dashboard from version {GAME_VERSION} game text and the 1.0 patch notes.",
                      "gameName": None, "textMatch": None},
        "stub": False, "aliases": [h["title"]] + (existing["aliases"] if existing else []), "linkTerms": h["linkTerms"],
    }
for title, (heading, paragraphs) in EXTRA_GAME_TEXT.items():
    articles[TITLE_TO_ID[title]]["gameText"].append({"heading": heading, "paragraphs": paragraphs})
articles["crust-solutions"]["category"] = "handbook"


# ------------------------------------------------------------------------------------------------ cross references and companion links
used_to_build: dict[str, list[str]] = defaultdict(list)
unlocked_by: dict[str, list[str]] = defaultdict(list)
for art in articles.values():
    if art["category"] == "buildings":
        for cost in art["costs"]:
            if cost["label"] == "Construction cost":
                for item in cost["items"]:
                    if item["id"]:
                        used_to_build[item["id"]].append(art["id"])
    if art["category"] == "research":
        for fact in art["facts"]:
            if fact["label"] == "Unlocks modules":
                for target in re.findall(L + r"([^" + SEP + r"]+)" + SEP, fact["value"]):
                    unlocked_by[target].append(art["id"])
for res_id, builders in used_to_build.items():
    if res_id in articles:
        articles[res_id]["xref"].append({"label": "Used to build", "items": [f"{L}{b}{SEP}{articles[b]['title']}{R}" for b in sorted(set(builders), key=lambda b: articles[b]["title"])]})
for bld_id, research in unlocked_by.items():
    if bld_id in articles and not any(f["label"] == "Unlocked by" for f in articles[bld_id]["facts"]):
        articles[bld_id]["xref"].append({"label": "Unlocked by research", "items": [f"{L}{r}{SEP}{articles[r]['title'].replace(' (Research)', '')}{R}" for r in sorted(set(research))]})

for enum, title in ENUM_TO_TITLE.items():
    art_id = TITLE_TO_ID.get(title)
    if art_id in articles:
        art = articles[art_id]
        art["companion"].append({"label": f"{title} in Resources", "target": f"resource:{enum}"})
        art["resourceKey"] = enum
        if enum not in {"FundamentalResearchPoint", "EngineeringResearchPoint", "SocialResearchPoint"}:
            art["linkTerms"] = sorted({title, *art["linkTerms"]})
    else:
        print(f"  resource without article: {enum} -> {title}")

CONCEPT_COMPANION = {
    "Cpu": ([{"label": "CPU use in Buildings & capacity", "target": "module:buildings"}], ["CPU"]),
    "Drones": ([{"label": "Drone CPU and value", "target": "module:buildings"}], ["drones", "drone"]),
    "Colonists": ([{"label": "Colonist spending", "target": "module:flows"}], ["colonists"]),
    "Research System": ([], ["research points", "science points"]),
    "Landing Platform": ([], ["Landing Platform"]),
    "CPU Data Center": ([], ["Data Centers", "Data Center"]),
    "Power System": ([], ["power"]),
    "Conveyor belts": ([], ["conveyors", "conveyor"]),
    "Smart Concrete Factory": ([], ["Smart Concrete Factory"]),
    "Rail Gun": ([], ["Transport Cannon"]),
    "Flight Control Center": ([], ["Mission Control Center"]),
    "Access To The Tender System (Research)": ([], ["Access to the Tender System"]),
    "CRUST Solutions": ([], ["CRUST Solutions"]),
}
for title, (companion, terms) in CONCEPT_COMPANION.items():
    art = articles[TITLE_TO_ID[title]]
    art["companion"] += companion
    art["linkTerms"] = sorted({*art["linkTerms"], *terms})
for art in articles.values():
    if art["category"] == "buildings":
        art["companion"].append({"label": "Your modules in Buildings & capacity", "target": "module:buildings"})

# Coverage paragraph for "What's new in 1.0"
wiki_arts = [a for a in articles.values() if a["source"]["kind"] == "wiki"]
status_counts = Counter(a["alignment"]["status"] for a in wiki_arts)
edited_after = sum(1 for a in wiki_arts if (a["source"]["edited"] or "") >= RELEASE_DATE)
stubs = sum(1 for a in wiki_arts if a["stub"])
coverage = (
    f"This Wiki holds **{len(wiki_arts)}** articles from The Crust Wiki. Only **{status_counts['verified']}** say they were checked on 1.0; "
    f"**{status_counts['early-access']}** were last checked on Early Access builds and **{status_counts['unversioned']}** don’t say. "
    f"**{edited_after}** were edited since 1.0 launched and **{stubs}** are marked as stubs. Each article shows its status at the top. "
    f"Module and resource names were checked against the 1.0.6.1 game text, and **{sum(1 for a in articles.values() if a['source']['kind'] == 'game' or (a['gameText'] and a['source']['kind'] == 'wiki'))}** "
    f"articles carry the game’s own encyclopedia text, which is current."
)
for b in articles["what-s-new-in-1-0"]["blocks"]:
    if b.get("text") == "__COVERAGE__":
        b["text"] = coverage


# ------------------------------------------------------------------------------------------------ write
articles = finalize(articles)
order = {c["id"]: i for i, c in enumerate(CATEGORIES)}
entries = sorted(
    ({"id": a["id"], "title": a["title"], "category": a["category"], "group": a["group"], "summary": a["summary"], "status": a["alignment"]["status"],
      "stub": a["stub"], "aliases": a["aliases"], "linkTerms": a["linkTerms"], "resourceKey": a.get("resourceKey"),
      "edited": a["source"]["edited"]} for a in articles.values()),
    key=lambda e: (order[e["category"]], e["group"] or "", e["title"].lower()),
)
recent = sorted((e for e in entries if e["status"] != "handbook" and e["edited"]), key=lambda e: e["edited"], reverse=True)[:8]
index = {
    "generatedAt": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%MZ"),
    "gameVersion": GAME_VERSION,
    "wiki": {"name": "The Crust Wiki", "url": "https://thecrust.wiki.gg/", "license": "CC BY-SA 4.0",
             "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/", "articles": len(wiki_arts)},
    "categories": [{**c, "count": sum(1 for e in entries if e["category"] == c["id"])} for c in CATEGORIES],
    "coverage": {"verified": status_counts["verified"], "earlyAccess": status_counts["early-access"], "unversioned": status_counts["unversioned"],
                 "editedSince1_0": edited_after, "stubs": stubs},
    "recent": [e["id"] for e in recent],
    "entries": entries,
}
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
(OUT / "articles.json").write_text(json.dumps(articles, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

print(f"articles: {len(articles)}  ({', '.join(f'{c['id']} {sum(1 for e in entries if e['category'] == c['id'])}' for c in CATEGORIES)})")
print(f"alignment: {dict(status_counts)}; edited since 1.0: {edited_after}; stubs: {stubs}")
print(f"summaries matching 1.0 game text: {dict(text_checks)}")
print(f"names not found in 1.0 game text ({len(report_missing)}): {', '.join(report_missing)}")
print(f"unrendered templates: {dict(UNKNOWN_TEMPLATES)}; copied building grids dropped: {BOILERPLATE_TABLES[0]}")
print(f"index.json {(OUT / 'index.json').stat().st_size // 1024} KB, articles.json {(OUT / 'articles.json').stat().st_size // 1024} KB")
