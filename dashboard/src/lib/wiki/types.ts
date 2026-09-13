// Shape of the generated wiki data (tools/build_wiki.py writes src/data/wiki/*.json).
// Text fields use RichText markup; [[article-id|label]] links to another article.

export type WikiCategoryId = "handbook" | "resources" | "buildings" | "research" | "vehicles" | "colony" | "systems" | "story" | "organizations";

/** verified: wiki page checked on 1.0 · early-access: checked on an EA build · unversioned: no version given · game: 1.0 game text only · handbook: written for this dashboard */
export type WikiStatus = "verified" | "early-access" | "unversioned" | "game" | "handbook";

export type WikiEntry = {
  id: string;
  title: string;
  category: WikiCategoryId;
  group: string | null;
  summary: string | null;
  status: WikiStatus;
  stub: boolean;
  aliases: string[];
  /** Words in companion text that should link to this article. */
  linkTerms: string[];
  /** EResourceType name when the article is a resource the companion tracks. */
  resourceKey: string | null;
  edited: string | null;
};

export type WikiIndex = {
  generatedAt: string;
  gameVersion: string;
  wiki: { name: string; url: string; license: string; licenseUrl: string; articles: number };
  categories: { id: WikiCategoryId; label: string; blurb: string; count: number }[];
  coverage: { verified: number; earlyAccess: number; unversioned: number; editedSince1_0: number; stubs: number };
  recent: string[];
  entries: WikiEntry[];
};

export type WikiBlock =
  | { t: "h"; level: number; text: string }
  | { t: "p" | "quote"; text: string }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "table"; caption: string | null; head: string[]; rows: string[][] };

export type WikiArticle = {
  id: string;
  title: string;
  category: WikiCategoryId;
  group: string | null;
  summary: string | null;
  facts: { label: string; value: string }[];
  costs: { label: string; items: { id: string | null; name: string; amount: string }[] }[];
  gameText: { heading: string; paragraphs: string[] }[];
  blocks: WikiBlock[];
  xref: { label: string; items: string[] }[];
  /** Navigation back into the companion: "module:<id>" or "resource:<EResourceType name>". */
  companion: { label: string; target: string }[];
  source: {
    kind: "wiki" | "game" | "handbook";
    url: string | null;
    edited: string | null;
    version: string | null;
    license: string | null;
    text?: string;
    links?: { label: string; href: string }[];
  };
  /** gameName: the title's match in the 1.0 game text · textMatch: the short description matches it word for word · inGameAs: the 1.0 name when it differs */
  alignment: { status: WikiStatus; note: string; gameName: "exact" | "mentioned" | "missing" | null; textMatch: boolean | null; inGameAs: string | null };
  stub: boolean;
  aliases: string[];
  linkTerms: string[];
  resourceKey?: string;
};
