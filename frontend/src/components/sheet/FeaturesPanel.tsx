/*
Everything the hero has, and where each of it came from.

#131 was that this list read the class and the subclass and nothing else — not
species traits, not the background, not feats — so a Gnome was told they were a
Gnome and never told what it did for them. Gathering them stays in the page,
which is where the libraries are; showing them belongs here.

A feature that asks the player to choose says what was chosen right under its
words (#382): a Fighter at the table had no Fighting Style anywhere on the sheet
and nobody could say where it had gone. One still waiting is listed at the top
and offered where it lives.
*/

import type { FeatureChoice } from "../../api/client";
import type { Feature } from "../../lib/derive";
import { owed } from "../../lib/featureChoices";
import { Blocks } from "../ui/SpellEntry";
import SectionLabel from "./SectionLabel";

/** A feature, plus the thing that granted it — the class, the species, a feat. */
export type SheetFeature = Feature & { from: string };

/** The choices a listed feature asks. A feature merged across two classes
 * ("Weapon Mastery — also Paladin") keeps both classes' choices. */
function choicesFor(f: SheetFeature, choices: FeatureChoice[]): FeatureChoice[] {
  return choices.filter((c) => c.feature === f.name && f.from.includes(c.source));
}

export default function FeaturesPanel({
  features,
  choices = [],
  canEdit = false,
  onChoose,
}: {
  features: SheetFeature[];
  choices?: FeatureChoice[];
  canEdit?: boolean;
  onChoose?: (choice: FeatureChoice) => void;
}) {
  if (features.length === 0) return null;
  const waiting = owed(choices);
  return (
  <section>
    <SectionLabel>Features</SectionLabel>
    <div className="parchment flex flex-col gap-2.5 px-4 py-4">
      {waiting.length > 0 && (
        <div
          data-testid="choices-waiting"
          className="rounded-[2px] px-3 py-2 text-[12.5px] text-ink-body"
          style={{ background: "rgba(139,37,32,.08)", boxShadow: "inset 0 0 0 1px rgba(139,37,32,.35)" }}
        >
          <span className="font-heading font-bold text-ink">
            {waiting.length === 1 ? "A choice is waiting" : `${waiting.length} choices are waiting`}
          </span>{" "}
          — {waiting.map((c) => c.name).join(", ")}.
          {!canEdit && <span className="italic"> Only the hero's player or the DM can make them.</span>}
        </div>
      )}
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
          {choicesFor(f, choices).map((c) => {
            const missing = c.count - c.picked.length;
            const changeable = canEdit && (missing > 0 || !!c.swap);
            return (
              <div
                key={c.key}
                data-choice-key={c.key}
                className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]"
              >
                <span className="label-stamp text-[9px] tracking-[1px] text-ink-label">{c.name}</span>
                {c.picked.length > 0 && (
                  <span className="font-heading font-bold text-ink">{c.picked.join(", ")}</span>
                )}
                {missing > 0 && (
                  <span className="italic text-[#8b2520]">
                    {c.picked.length > 0 ? `${missing} more to choose` : "not chosen"}
                  </span>
                )}
                {changeable && onChoose && (
                  <button
                    onClick={() => onChoose(c)}
                    className="btn-base btn-ghost-ink px-2.5 py-1 text-[10px]"
                  >
                    {missing > 0 ? "Choose" : "Change"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  </section>
  );
}
