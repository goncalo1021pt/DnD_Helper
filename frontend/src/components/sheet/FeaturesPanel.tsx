/*
Everything the hero has, and where each of it came from.

#131 was that this list read the class and the subclass and nothing else — not
species traits, not the background, not feats — so a Gnome was told they were a
Gnome and never told what it did for them. Gathering them stays in the page,
which is where the libraries are; showing them belongs here.
*/

import type { Feature } from "../../lib/derive";
import { Blocks } from "../ui/SpellEntry";
import SectionLabel from "./SectionLabel";

/** A feature, plus the thing that granted it — the class, the species, a feat. */
export type SheetFeature = Feature & { from: string };

export default function FeaturesPanel({ features }: { features: SheetFeature[] }) {
  if (features.length === 0) return null;
  return (
  <section>
    <SectionLabel>Features</SectionLabel>
    <div className="parchment flex flex-col gap-2.5 px-4 py-4">
      {features.map((f, i) => (
        <div key={i} className="text-[13px]">
          <span className="font-heading font-bold text-ink">{f.name}</span>
          <span className="label-stamp ml-2 text-[8px] tracking-[1px] text-ink-label">
            {/* A species trait has no level, and stamping one on it
                would be inventing a fact about the rules. */}
            {f.from}
            {f.level ? ` ${f.level}` : ""}
          </span>
          {f.summary && (
            <div className="leading-relaxed text-ink-body">
              <Blocks text={f.summary} />
            </div>
          )}
        </div>
      ))}
    </div>
  </section>
  );
}
