import { Fragment, type ReactNode } from "react";
import { TERM_RE, WIKI_ENTRIES, termArticle, wikiHref } from "@/lib/wiki/client";

// Tiny markup for advice, explainers and wiki articles, rendered as React elements (never injected as HTML):
//   **bold**   _italic_   ==highlighted term==   ++good figure++   !!bad figure!!
//   [[article-id|label]]  link to a Wiki article      [[https://…|label]]  external link
const TOKEN = /(\[\[[^\]|]+(?:\|[^\]]*)?\]\]|\*\*[^*]+\*\*|==[^=]+==|\+\+[^+]+\+\+|!![^!]+!!|(?<![\w])_[^_]+_(?![\w]))/g;

export function WikiLink({ id, children }: { id: string; children: ReactNode }) {
  const entry = WIKI_ENTRIES.get(id);
  if (!entry) return <>{children}</>;
  return (
    <a className="wiki-link" href={wikiHref(id)} title={`Wiki: ${entry.title}`}>
      {children}
    </a>
  );
}

type Props = {
  text: string;
  /** Link the first mention of each Wiki keyword (resources, modules, systems) to its article. */
  autolink?: boolean;
  /** Article that is already on screen, so it never links to itself. */
  self?: string;
};

export function RichText({ text, autolink = false, self }: Props) {
  const linked = new Set<string>(self ? [self] : []);
  const parts = text.split(TOKEN).filter((p) => p !== "");

  const plain = (p: string, key: number): ReactNode => {
    if (!autolink) return <Fragment key={key}>{p}</Fragment>;
    const out: ReactNode[] = [];
    let last = 0;
    for (const m of p.matchAll(TERM_RE)) {
      const id = termArticle(m[0]);
      if (!id || linked.has(id) || m.index == null) continue;
      linked.add(id);
      out.push(p.slice(last, m.index), <WikiLink key={`${key}-${m.index}`} id={id}>{m[0]}</WikiLink>);
      last = m.index + m[0].length;
    }
    out.push(p.slice(last));
    return <Fragment key={key}>{out}</Fragment>;
  };

  return (
    <>
      {parts.map((p, i) => {
        const wrapped = (open: string, close = open) => p.length > open.length + close.length && p.startsWith(open) && p.endsWith(close);
        if (wrapped("[[", "]]")) {
          const [target, label] = p.slice(2, -2).split("|");
          const text = label ?? WIKI_ENTRIES.get(target)?.title ?? target;
          if (/^https?:\/\//.test(target)) {
            return (
              <a key={i} href={target} target="_blank" rel="noopener noreferrer">
                {text} ↗
              </a>
            );
          }
          linked.add(target);
          return target === self ? <strong key={i}>{text}</strong> : <WikiLink key={i} id={target}>{text}</WikiLink>;
        }
        if (wrapped("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (wrapped("==")) return <mark key={i} className="hl">{p.slice(2, -2)}</mark>;
        if (wrapped("++")) return <strong key={i} className="tone-good">{p.slice(2, -2)}</strong>;
        if (wrapped("!!")) return <strong key={i} className="tone-bad">{p.slice(2, -2)}</strong>;
        if (wrapped("_")) return <em key={i}>{p.slice(1, -1)}</em>;
        return plain(p, i);
      })}
    </>
  );
}
