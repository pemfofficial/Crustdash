import { WikiLink } from "@/components/ui/RichText";
import { wikiForResource } from "@/lib/wiki/client";

/** A fact-grid entry pointing a tracked resource at its Wiki article (nothing when there's no article). */
export function WikiFact({ resourceKey, label }: { resourceKey: string; label: string }) {
  const entry = wikiForResource(resourceKey);
  if (!entry) return null;
  return (
    <div className="fact">
      <dt>In the Wiki</dt>
      <dd>
        <WikiLink id={entry.id}>How {label.trim()} is made and used</WikiLink>
      </dd>
    </div>
  );
}
