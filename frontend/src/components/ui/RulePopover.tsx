import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { RulesContent } from "../../api/client";
import { useRules } from "../../hooks";
import { indexRules, ruleTermFor } from "../../lib/rulebook";
import ContentEntry from "./ContentEntry";
import ParchmentModal from "./ParchmentModal";

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
  const [open, setOpen] = useState(false);
  const entry = rules.get(ruleTermFor(term));
  if (!entry) {
    return (
      <span className={className} style={style}>
        {children ?? term}
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`Rule: ${entry.name}`}
        className={`${className ?? ""} m-0 inline cursor-pointer border-none bg-transparent p-0 underline decoration-dotted decoration-1 underline-offset-2`}
        style={{ color: "inherit", font: "inherit", background: "transparent", ...style }}
      >
        {children ?? term}
      </button>
      {open && (
        <ParchmentModal onClose={() => setOpen(false)} maxWidth="max-w-[460px]">
          <ContentEntry entry={entry} />
        </ParchmentModal>
      )}
    </>
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
