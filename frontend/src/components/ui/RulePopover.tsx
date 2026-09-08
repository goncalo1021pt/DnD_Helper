import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { RulesContent } from "../../api/client";
import { useRules } from "../../hooks";
import { indexRules, ruleTermFor } from "../../lib/rulebook";
import { openReader } from "./Reader";

/*
The Rulebook, opened in place (#199). A term that names a rule entry —
"Versatile" on a weapon card, a "Grappled" chip mid-fight — becomes a quiet
affordance: dotted underline, tap, the actual text. A term the codex doesn't
know stays plain, because a chip that opens an empty page is worse than no
chip at all.
*/

/** Rule entries by lowercase name; one cached query feeds every keyword. */
export function useRuleIndex(): Map<string, RulesContent> {
  const { data } = useRules("rule");
  return useMemo(() => indexRules(data), [data]);
}

const EMPTY_INDEX = new Map<string, RulesContent>();
const spellIndexes = new WeakMap<RulesContent[], Map<string, RulesContent>>();

/**
 * Spell entries by lowercase name (#285). Cached per list rather than per
 * caller: every paragraph on a page asks, and a stat block is many
 * paragraphs. Any signed-in reader may hold the spell list, so a player's
 * Bestiary links exactly as the DM's Den does.
 */
export function useSpellIndex(): Map<string, RulesContent> {
  const { data } = useRules("spell");
  if (!data) return EMPTY_INDEX;
  let index = spellIndexes.get(data);
  if (!index) {
    index = indexRules(data);
    spellIndexes.set(data, index);
  }
  return index;
}

export function RuleTerm({
  term,
  className,
  style,
  children,
}: {
  term: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const rules = useRuleIndex();
  const entry = rules.get(ruleTermFor(term));
  if (!entry) {
    return (
      <span className={className} style={style}>
        {children ?? term}
      </span>
    );
  }
  // The entry opens in the root reader rather than a dialog of this term's
  // own, so a term pressed inside a hover card outlives the card (#285).
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openReader(entry);
      }}
      aria-label={`Rule: ${entry.name}`}
      className={`${className ?? ""} m-0 inline cursor-pointer border-none bg-transparent p-0 underline decoration-dotted decoration-1 underline-offset-2`}
      style={{ color: "inherit", font: "inherit", background: "transparent", ...style }}
    >
      {children ?? term}
    </button>
  );
}

/**
 * A spell named in entry text — the same affordance as a rule term, opening
 * the spell's own entry (#285). The text renderer decides which words are
 * names; this only draws the door.
 */
export function SpellTerm({ entry, children }: { entry: RulesContent; children?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openReader(entry);
      }}
      aria-label={`Spell: ${entry.name}`}
      className="m-0 inline cursor-pointer border-none bg-transparent p-0 underline decoration-dotted decoration-1 underline-offset-2"
      style={{ color: "inherit", font: "inherit", background: "transparent" }}
    >
      {children ?? entry.name}
    </button>
  );
}

/** A comma-joined list of terms, each opening its rule when known. */
export function RuleTermList({ terms }: { terms: string[] }) {
  return (
    <>
      {terms.map((t, i) => (
        <span key={t}>
          {i > 0 && ", "}
          <RuleTerm term={t} />
        </span>
      ))}
    </>
  );
}
