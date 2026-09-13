"use client";

import { Suspense, use, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { showResource } from "@/components/live/PrefsProvider";
import { RichText, WikiLink } from "@/components/ui/RichText";
import { openModule, splitModuleHash, useModuleHash } from "@/lib/client/moduleHash";
import { stripMarkup } from "@/lib/crust/markup";
import { WIKI_ENTRIES, WIKI_INDEX, WIKI_MODULE, loadArticles, wikiHref } from "@/lib/wiki/client";
import type { WikiArticle, WikiBlock, WikiCategoryId, WikiEntry, WikiStatus } from "@/lib/wiki/types";

const STATUS: Record<WikiStatus, { label: string; cls: string; hint: string }> = {
  verified: { label: "Checked on 1.0", cls: "is-current", hint: "Wiki editors checked this page on a 1.0 build." },
  game: { label: "1.0 game text", cls: "is-current", hint: "Taken from the game’s own 1.0.6.1 text." },
  handbook: { label: "Handbook", cls: "is-handbook", hint: "Written for this dashboard from 1.0 game text and patch notes." },
  "early-access": { label: "Early Access data", cls: "is-dated", hint: "Last checked before 1.0; figures may have changed." },
  unversioned: { label: "Version not stated", cls: "is-unknown", hint: "The wiki page doesn’t say which version it describes." },
};

const CATEGORY_LABEL = new Map(WIKI_INDEX.categories.map((c) => [c.id, c.label]));
const NEWS_ID = "what-s-new-in-1-0";

export function StatusTag({ status }: { status: WikiStatus }) {
  const s = STATUS[status];
  return (
    <span className={`wiki-status ${s.cls}`} title={s.hint}>
      {s.label}
    </span>
  );
}

function searchEntries(query: string): WikiEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return WIKI_INDEX.entries
    .map((e) => {
      const t = e.title.toLowerCase();
      const aliases = e.aliases.map((a) => a.toLowerCase());
      let score =
        t === q ? 100 : t.startsWith(q) ? 80 : aliases.some((a) => a.startsWith(q)) ? 70 : t.includes(q) ? 55 : aliases.some((a) => a.includes(q)) ? 45 : (e.summary ?? "").toLowerCase().includes(q) ? 25 : 0;
      // Research pages share names with the modules they unlock; show the module first
      if (score && e.category === "research") score -= 6;
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.e.title.localeCompare(b.e.title))
    .slice(0, 40)
    .map((x) => x.e);
}

function EntryRow({ entry, showCategory = false }: { entry: WikiEntry; showCategory?: boolean }) {
  return (
    <li>
      <a className="wiki-row" href={wikiHref(entry.id)}>
        <span className="wiki-row-title">{entry.title}</span>
        <span className="wiki-row-tags">
          {showCategory && <span className="wiki-row-cat">{CATEGORY_LABEL.get(entry.category)}</span>}
          {entry.stub && <span className="wiki-status is-unknown">Stub</span>}
          <StatusTag status={entry.status} />
        </span>
        {entry.summary && <span className="wiki-row-summary">{entry.summary}</span>}
      </a>
    </li>
  );
}

function WikiHome() {
  const news = WIKI_ENTRIES.get(NEWS_ID);
  const cov = WIKI_INDEX.coverage;
  const gameOnly = WIKI_INDEX.entries.filter((e) => e.status === "game").length;
  const handbook = WIKI_INDEX.entries.filter((e) => e.category === "handbook" && e.id !== NEWS_ID);
  const recent = WIKI_INDEX.recent.map((id) => WIKI_ENTRIES.get(id)).filter((e): e is WikiEntry => Boolean(e));
  const currency: [WikiStatus, number][] = [
    ["verified", cov.verified],
    ["game", gameOnly],
    ["early-access", cov.earlyAccess],
    ["unversioned", cov.unversioned],
  ];

  return (
    <div className="wiki-home">
      {news && (
        <a className="wiki-feature" href={wikiHref(news.id)}>
          <span className="wiki-feature-kicker">Game version {WIKI_INDEX.gameVersion}</span>
          <span className="wiki-feature-title">{news.title}</span>
          <span className="wiki-feature-text">{news.summary}</span>
        </a>
      )}

      <section className="wiki-panel" aria-labelledby="wiki-currency">
        <h2 id="wiki-currency" className="wiki-panel-title">
          How current the articles are
        </h2>
        <ul className="wiki-currency">
          {currency.map(([status, n]) => (
            <li key={status}>
              <span className="wiki-currency-n">{n}</span>
              <StatusTag status={status} />
            </li>
          ))}
        </ul>
        <p className="wiki-note">
          The Crust Wiki was mostly written during Early Access, and 1.0 rebuilt logistics and excavation. Every article shows its status. Where the game’s own 1.0 encyclopedia
          covers a topic, its text appears first. {cov.stubs} wiki articles are still stubs, and {cov.editedSince1_0} were edited since 1.0 launched.
        </p>
      </section>

      <div className="wiki-cat-grid">
        {WIKI_INDEX.categories.map((c) => (
          <a key={c.id} className="wiki-cat" href={wikiHref(`c/${c.id}`)}>
            <span className="wiki-cat-label">{c.label}</span>
            <span className="wiki-cat-count">{c.count}</span>
            <span className="wiki-cat-blurb">{c.blurb}</span>
          </a>
        ))}
      </div>

      <div className="grid-2">
        <section className="wiki-panel" aria-labelledby="wiki-handbook">
          <h2 id="wiki-handbook" className="wiki-panel-title">
            Director’s handbook
          </h2>
          <ul className="wiki-rows">
            {handbook.map((e) => (
              <EntryRow key={e.id} entry={e} />
            ))}
          </ul>
        </section>
        <section className="wiki-panel" aria-labelledby="wiki-recent">
          <h2 id="wiki-recent" className="wiki-panel-title">
            Recently edited on the wiki
          </h2>
          <ul className="wiki-rows">
            {recent.map((e) => (
              <li key={e.id}>
                <a className="wiki-row" href={wikiHref(e.id)}>
                  <span className="wiki-row-title">{e.title}</span>
                  <span className="wiki-row-tags">
                    <span className="wiki-row-cat">{e.edited}</span>
                    <StatusTag status={e.status} />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function CategoryView({ id }: { id: WikiCategoryId }) {
  const category = WIKI_INDEX.categories.find((c) => c.id === id);
  const groups = useMemo(() => {
    const map = new Map<string, WikiEntry[]>();
    for (const e of WIKI_INDEX.entries) {
      if (e.category !== id) continue;
      const g = e.group ?? "";
      map.set(g, [...(map.get(g) ?? []), e]);
    }
    return [...map.entries()];
  }, [id]);
  if (!category) return <p className="empty">There’s no category called “{id}”.</p>;

  return (
    <div className="wiki-category">
      <nav className="wiki-crumbs" aria-label="Breadcrumb">
        <a href={wikiHref()}>Wiki</a>
        <span aria-hidden>/</span>
        <span aria-current="page">{category.label}</span>
      </nav>
      <header className="wiki-article-head">
        <h2 className="wiki-title">{category.label}</h2>
        <p className="wiki-lede">{category.blurb}</p>
      </header>
      {groups.map(([group, entries]) => (
        <section key={group || "all"} className="wiki-group" aria-label={group || category.label}>
          {group && <h3 className="wiki-group-title">{group}</h3>}
          <ul className="wiki-rows">
            {entries.map((e) => (
              <EntryRow key={e.id} entry={e} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function WikiBlockView({ block, self }: { block: WikiBlock; self: string }) {
  switch (block.t) {
    case "h": {
      const H = `h${Math.min(5, block.level + 1)}` as "h3" | "h4" | "h5";
      return <H className="wiki-h">{block.text}</H>;
    }
    case "p":
      return (
        <p className="wiki-p">
          <RichText text={block.text} self={self} />
        </p>
      );
    case "quote":
      return (
        <blockquote className="wiki-quote">
          <RichText text={block.text} self={self} />
        </blockquote>
      );
    case "ul":
    case "ol": {
      const List = block.t;
      return (
        <List className="wiki-list">
          {block.items.map((item, i) => (
            <li key={i}>
              <RichText text={item} self={self} />
            </li>
          ))}
        </List>
      );
    }
    case "table":
      return (
        <div className="table-wrap wiki-table-wrap">
          <table className="data-table wiki-table">
            {block.caption && <caption>{block.caption}</caption>}
            {block.head.length > 0 && (
              <thead>
                <tr>
                  {block.head.map((h, i) => (
                    <th key={i} scope="col">
                      <RichText text={h} self={self} />
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>
                      <RichText text={cell} self={self} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function CompanionLink({ label, target }: { label: string; target: string }) {
  const [kind, value] = target.split(":");
  if (kind === "module") {
    return (
      <a className="wiki-companion-link" href={`#${value}`}>
        {label}
      </a>
    );
  }
  return (
    <button
      type="button"
      className="wiki-companion-link"
      onClick={() => showResource(value)}
    >
      {label}
    </button>
  );
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="wiki-box">
      <h3 className="wiki-box-title">{title}</h3>
      {children}
    </div>
  );
}

function Attribution({ a }: { a: WikiArticle }) {
  const s = a.source;
  if (s.kind === "wiki") {
    return (
      <footer className="wiki-attribution">
        From{" "}
        <a href={s.url ?? WIKI_INDEX.wiki.url} target="_blank" rel="noopener noreferrer">
          {a.title} on {WIKI_INDEX.wiki.name} ↗
        </a>
        {s.edited && `, last edited ${s.edited}`}
        {s.version && `, written for game version ${s.version}`}. Text available under{" "}
        <a href={WIKI_INDEX.wiki.licenseUrl} target="_blank" rel="noopener noreferrer">
          {WIKI_INDEX.wiki.license} ↗
        </a>
        ; reformatted for this dashboard, with images and navigation boxes left out.
        {a.gameText.length > 0 && ` In-game text from version ${WIKI_INDEX.gameVersion} (Game.locres).`}
      </footer>
    );
  }
  if (s.kind === "game") {
    return <footer className="wiki-attribution">Text from The Crust {s.version} game files (Game.locres). The wiki has no page for this yet.</footer>;
  }
  return (
    <footer className="wiki-attribution">
      Written for this dashboard. Sources: {s.text}.
      {s.links?.map((l) => (
        <span key={l.href}>
          {" "}
          <a href={l.href} target="_blank" rel="noopener noreferrer">
            {l.label} ↗
          </a>
        </span>
      ))}
    </footer>
  );
}

function ArticleView({ id }: { id: string }) {
  const all = use(loadArticles());
  const a = all[id];
  if (!a) {
    return (
      <p className="empty">
        No article with the id “{id}”. <a href={wikiHref()}>Back to the Wiki</a>
      </p>
    );
  }
  const hasAside = a.companion.length > 0 || a.facts.length > 0 || a.costs.length > 0;
  // When the summary is the article's opening paragraph, don't print it twice
  const lede = a.summary ? stripMarkup(a.summary) : null;
  const blocks = a.blocks.filter((b, i) => !(i < 3 && b.t === "p" && lede && stripMarkup(b.text) === lede));

  return (
    <article className="wiki-article" aria-labelledby="wiki-article-title">
      <nav className="wiki-crumbs" aria-label="Breadcrumb">
        <a href={wikiHref()}>Wiki</a>
        <span aria-hidden>/</span>
        <a href={wikiHref(`c/${a.category}`)}>{CATEGORY_LABEL.get(a.category)}</a>
        {a.group && (
          <>
            <span aria-hidden>/</span>
            <span>{a.group}</span>
          </>
        )}
      </nav>
      <header className="wiki-article-head">
        <h2 id="wiki-article-title" className="wiki-title">
          {a.title}
        </h2>
        <div className="wiki-status-row">
          <StatusTag status={a.alignment.status} />
          {a.stub && <span className="wiki-status is-unknown">Stub</span>}
          {a.alignment.inGameAs && <span className="wiki-status is-note">In 1.0: {a.alignment.inGameAs}</span>}
          {a.alignment.textMatch && a.source.kind === "wiki" && <span className="wiki-status is-note">Description matches the 1.0 game text</span>}
          <span className="wiki-status-note">{a.alignment.note}</span>
        </div>
        {a.summary && (
          <p className="wiki-lede">
            <RichText text={a.summary} self={a.id} />
          </p>
        )}
      </header>

      <div className={`wiki-article-body${hasAside ? " has-aside" : ""}`}>
        <div className="wiki-content">
          {a.gameText.map((g) => (
            <section key={g.heading} className="wiki-gametext" aria-label={`In-game text: ${g.heading}`}>
              <h3 className="wiki-gametext-label">
                {g.heading === "Advisor" ? "Advisor messages" : g.heading === "Game text" ? "In-game text" : `In-game encyclopedia: ${g.heading}`}
                <span className="wiki-gametext-ver">v{WIKI_INDEX.gameVersion}</span>
              </h3>
              {g.paragraphs.map((p, i) => (
                <p key={i} className="wiki-p">
                  {p}
                </p>
              ))}
            </section>
          ))}
          {blocks.map((b, i) => (
            <WikiBlockView key={i} block={b} self={a.id} />
          ))}
          {blocks.length === 0 && a.gameText.length === 0 && <p className="empty">The wiki page has no text yet beyond the facts shown here.</p>}
          {a.xref.map((x) => (
            <section key={x.label} className="wiki-xref-section" aria-label={x.label}>
              <h3 className="wiki-h">{x.label}</h3>
              <ul className="wiki-xref">
                {x.items.map((item, i) => (
                  <li key={i}>
                    <RichText text={item} self={a.id} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {hasAside && (
          <aside className="wiki-infobox" aria-label={`${a.title}: facts and links`}>
            {a.companion.length > 0 && (
              <Box title="In your colony">
                <div className="wiki-companion">
                  {a.companion.map((c) => (
                    <CompanionLink key={c.target + c.label} {...c} />
                  ))}
                </div>
              </Box>
            )}
            {a.facts.length > 0 && (
              <Box title="Facts">
                <dl className="wiki-facts">
                  {a.facts.map((f) => (
                    <div key={f.label}>
                      <dt>{f.label}</dt>
                      <dd>
                        <RichText text={f.value} self={a.id} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </Box>
            )}
            {a.costs.map((c) => (
              <Box key={c.label} title={c.label}>
                <ul className="wiki-costs">
                  {c.items.map((item) => (
                    <li key={item.name}>
                      <span className="wiki-cost-amount">{item.amount}</span>
                      {item.id ? <WikiLink id={item.id}>{item.name}</WikiLink> : item.name}
                    </li>
                  ))}
                </ul>
              </Box>
            ))}
          </aside>
        )}
      </div>
      <Attribution a={a} />
    </article>
  );
}

/** The Wiki: a reference archive for The Crust 1.0, separate from your colony's numbers. */
export function WikiModule() {
  const [moduleId, path] = splitModuleHash(useModuleHash());
  const inWiki = moduleId === WIKI_MODULE;
  const view = inWiki ? path : "";
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const results = useMemo(() => searchEntries(deferred), [deferred]);
  const category = view.startsWith("c/") ? (view.slice(2) as WikiCategoryId) : null;
  const articleId = view && !category ? view : null;
  const searching = query.trim() !== "";

  // New article: start at its top
  useEffect(() => {
    if (inWiki && path) window.scrollTo({ top: 0 });
  }, [inWiki, path]);

  return (
    <div
      className="wiki"
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest("a[href^='#']")) setQuery("");
      }}
    >
      <aside className="wiki-rail">
        <div className="wiki-search" role="search">
          <span className="command-prompt" aria-hidden>
            ⌕
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) {
                openModule(`${WIKI_MODULE}/${results[0].id}`);
                setQuery("");
              }
            }}
            placeholder="Search the Wiki"
            aria-label="Search wiki articles by title, name or summary"
            spellCheck={false}
          />
        </div>
        <nav aria-label="Wiki categories">
          <ul className="wiki-cats">
            <li>
              <a href={wikiHref()} aria-current={inWiki && !view ? "page" : undefined}>
                <span>Wiki home</span>
              </a>
            </li>
            {WIKI_INDEX.categories.map((c) => (
              <li key={c.id}>
                <a href={wikiHref(`c/${c.id}`)} aria-current={category === c.id ? "page" : undefined}>
                  <span>{c.label}</span>
                  <span className="count">{c.count}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <p className="wiki-rail-note">
          Articles from{" "}
          <a href={WIKI_INDEX.wiki.url} target="_blank" rel="noopener noreferrer">
            {WIKI_INDEX.wiki.name} ↗
          </a>{" "}
          ({WIKI_INDEX.wiki.license}), checked against the game’s {WIKI_INDEX.gameVersion} text. Built {WIKI_INDEX.generatedAt.slice(0, 10)}.
        </p>
      </aside>

      <div className="wiki-main">
        {searching ? (
          <section aria-live="polite" aria-label="Search results">
            <p className="wiki-note">
              {results.length ? `${results.length === 40 ? "First 40" : results.length} article${results.length === 1 ? "" : "s"} for “${query.trim()}”. Enter opens the first.` : `No articles match “${query.trim()}”.`}
            </p>
            <ul className="wiki-rows">
              {results.map((e) => (
                <EntryRow key={e.id} entry={e} showCategory />
              ))}
            </ul>
          </section>
        ) : articleId ? (
          <Suspense fallback={<p className="empty">Opening the archive…</p>}>
            <ArticleView id={articleId} />
          </Suspense>
        ) : category ? (
          <CategoryView id={category} />
        ) : (
          <WikiHome />
        )}
      </div>
    </div>
  );
}
