import { choiceCount, choiceOptions, type SpeciesChoice } from "../../lib/species";
import { Blocks } from "../ui/SpellEntry";

// One species choice as a row of chips — a lineage, a free proficiency, an
// Origin feat. The chosen option's rules text unfolds underneath so a player
// can read what Rock Gnome means before committing to it.
export function SpeciesChoicePicker({
  choice,
  picked,
  onToggle,
  featPool,
  blocked,
}: {
  choice: SpeciesChoice;
  picked: string[];
  onToggle: (option: string) => void;
  featPool: string[];
  /** Option name -> why it can't be taken (already granted elsewhere). */
  blocked?: Map<string, string>;
}) {
  const want = choiceCount(choice);
  const options = choiceOptions(choice, { feats: featPool });
  const remaining = want - picked.length;
  // Only unfold the rules panel for picks that actually have rules to read —
  // an ability pick ("Intelligence") would otherwise render an empty box.
  const chosen = options.filter(
    (o) => picked.includes(o.name) && (o.summary || (o.spells ?? []).length > 0),
  );

  return (
    <div>
      <div className="label-stamp mb-1.5 text-[10px] tracking-[2px] text-gold-muted">
        {choice.name} — choose {want}
        {want > 1 && ` (${picked.length}/${want})`}
        {remaining > 0 && (
          <span className="ml-2 text-ember-bright">
            {remaining} still to pick
          </span>
        )}
      </div>
      {choice.summary && (
        <p className="font-body m-0 mb-2 text-[12px] italic leading-snug text-cream-soft">
          {choice.summary}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const active = picked.includes(o.name);
          const why = blocked?.get(o.name);
          const disabled = !!why && !active;
          return (
            <button
              key={o.name}
              type="button"
              onClick={() => !disabled && onToggle(o.name)}
              disabled={disabled}
              title={why}
              className={`label-stamp cursor-pointer rounded-[2px] border-none px-2.5 py-1.5 text-[10px] tracking-[1px] ${
                disabled ? "cursor-default line-through opacity-50" : ""
              }`}
              style={{
                background: active ? "linear-gradient(180deg,#8b2520,#5e1611)" : "rgba(16,9,5,.4)",
                color: active ? "#f3d9c0" : "#cdba93",
                boxShadow: `inset 0 0 0 1px ${active ? "#3f0f0e" : "rgba(201,162,39,.3)"}`,
              }}
            >
              {o.name}
            </button>
          );
        })}
        {options.length === 0 && (
          <span className="font-body text-[12px] italic text-cream-soft">
            No options are available — check that the pack providing them is imported.
          </span>
        )}
      </div>
      {chosen.length > 0 && (
        <div className="parchment mt-2.5 px-4 py-3">
          {chosen.map((o) => (
            <div key={o.name} className="text-[12.5px] leading-relaxed text-ink-body">
              <strong className="font-heading text-ink">{o.name}.</strong>{" "}
              {o.summary && <Blocks text={o.summary} />}
              {(o.spells ?? []).length > 0 && (
                <div className="mt-1 text-[11.5px] italic">
                  Later:{" "}
                  {(o.spells ?? [])
                    .map((sp) => `${sp.name} at level ${sp.level}`)
                    .join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default SpeciesChoicePicker;
