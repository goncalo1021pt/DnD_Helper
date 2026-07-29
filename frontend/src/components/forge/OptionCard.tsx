import type { RulesContent } from "../../api/client";
import { originStamp } from "../../lib/content";

export function OptionCard({
  entry,
  selected,
  onPick,
  facts,
  tags,
}: {
  entry: RulesContent;
  selected: boolean;
  onPick: () => void;
  facts: string;
  /** What the option gives you, named on the card instead of only after picking. */
  tags?: string[];
}) {
  return (
    <button
      onClick={onPick}
      className="parchment cursor-pointer px-4 pb-3.5 pt-3 text-left transition hover:-translate-y-0.5"
      style={
        selected
          ? { boxShadow: "0 0 0 2.5px #8b2520, 0 14px 26px rgba(0,0,0,.5)" }
          : undefined
      }
    >
      <div className="font-display text-[16px] font-bold text-ink">{entry.name}</div>
      {/* Imported content names the book it came in with, not a flat
          "Homebrew" — a pack's Blood Hunter reads as its own source. Book
          names run long, so the stamp gets its own line. */}
      {entry.source === "homebrew" && (
        <div className="label-stamp mt-0.5 text-[8.5px] tracking-[1px] text-[#8b2520]">
          {originStamp(entry)}
        </div>
      )}
      <div className="label-stamp mt-0.5 text-[9px] tracking-[1px] text-ink-label">
        {facts}
      </div>
      <p className="font-body m-0 mt-1.5 text-[12.5px] italic leading-snug text-ink-body">
        {entry.summary}
      </p>
      {tags && tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.map((t) => (
            <span
              key={t}
              className="label-stamp rounded-[2px] px-1.5 py-0.5 text-[8.5px] tracking-[.5px] text-ink-label"
              style={{ background: "rgba(120,86,42,.14)", boxShadow: "inset 0 0 0 1px rgba(120,80,30,.3)" }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

export default OptionCard;
