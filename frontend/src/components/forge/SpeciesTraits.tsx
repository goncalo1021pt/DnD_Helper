import type { SpeciesData } from "../../lib/species";
import { Blocks } from "../ui/SpellEntry";

// The species' traits in full. They used to surface as a comma-joined list of
// names on the summary rail, which told a player nothing about what picking
// Goliath actually does for them.
export function SpeciesTraits({ data }: { data: SpeciesData }) {
  const traits = data.traits ?? [];
  if (traits.length === 0 && !data.description) return null;
  return (
    <div>
      <div className="label-stamp mb-2 text-[10px] tracking-[2px] text-gold-muted">Traits</div>
      <div className="parchment px-4 py-3.5">
        {data.description && (
          <p className="font-body m-0 mb-3 text-[12.5px] italic leading-relaxed text-ink-body">
            {data.description}
          </p>
        )}
        <div className="flex flex-col gap-2.5">
          {traits.map((t) => (
            <div key={t.name} className="text-[12.5px] leading-relaxed text-ink-body">
              <strong className="font-heading text-ink">{t.name}.</strong>{" "}
              {t.summary && <Blocks text={t.summary} />}
            </div>
          ))}
        </div>
        {data.sizeNote && (
          <div className="mt-3 text-[11.5px] italic text-ink-body">Size: {data.sizeNote}</div>
        )}
      </div>
    </div>
  );
}

export default SpeciesTraits;
