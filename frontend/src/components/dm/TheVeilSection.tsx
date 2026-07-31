import type { Campaign } from "../../api/client";
import { useCharacters, useRevealCharacter } from "../../hooks";

/*
 * The Veil: who at this table may be read, and by whom. Shown only while the
 * veil is drawn — the sheets are otherwise open and there is nothing to lift.
 */
export default function TheVeilSection({ campaign }: { campaign: Campaign }) {
  const { data: characters } = useCharacters(campaign.id);
  const reveal = useRevealCharacter(campaign.id);
  const roster = characters ?? [];
  const shownCount = roster.filter((c) => c.revealed).length;

  if (!campaign.hiddenSheets) return null;

  return (
    <section className="panel-hall px-6 pb-6 pt-5">
      <div
        className="mb-4 flex flex-wrap items-baseline justify-between gap-3 pb-3"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <h2
          className="font-display m-0 text-[21px] font-black text-[#e7d3a6]"
          style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
        >
          The Veil
        </h2>
        <span className="label-stamp text-[11px] text-gold-muted">
          {shownCount === 0
            ? "every sheet hidden"
            : `${shownCount} sheet${shownCount === 1 ? "" : "s"} in the light`}
        </span>
      </div>

      <p className="font-body mb-4 text-[13.5px] leading-relaxed text-cream-muted">
        Players read only their own hero — everyone else is a name. Lift the
        veil on whoever should be known, one at a time or a few at once. Owners
        and you always read a sheet in full.
      </p>

      {roster.length === 0 ? (
        <p className="font-accent text-[15px] italic text-cream-muted">
          No heroes seated — nothing to veil.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2.5 p-0">
          {roster.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-3.5 rounded-[3px] px-3 py-2.5"
              style={{
                background: "rgba(0,0,0,.22)",
                border: `1px solid ${c.revealed ? "rgba(201,162,39,.4)" : "rgba(201,162,39,.16)"}`,
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="font-heading truncate text-[15px] font-bold text-cream">
                  {c.name}
                  <span className="font-accent ml-2 text-[12.5px] font-normal italic text-cream-muted">
                    {c.class || "Adventurer"} · Lv {c.level}
                  </span>
                </div>
                <div className="label-stamp text-[10px] tracking-[1px] text-gold-muted">
                  played by {c.ownerName} ·{" "}
                  {c.revealed ? "the party reads this sheet" : "veiled from the party"}
                </div>
              </div>
              <div className="flex flex-none items-center gap-2">
                <button
                  onClick={() =>
                    reveal.mutate({ characterId: c.id, revealed: !c.revealed })
                  }
                  disabled={reveal.isPending}
                  title={
                    c.revealed
                      ? "Draw the veil back over this hero"
                      : "Show this hero's sheet to the party"
                  }
                  className="label-stamp cursor-pointer rounded-[2px] px-2.5 py-1.5 text-[10px] tracking-[1px] text-cream-soft transition hover:brightness-125 disabled:opacity-55"
                  style={{
                    background: "rgba(201,162,39,.14)",
                    border: "1px solid rgba(201,162,39,.35)",
                  }}
                >
                  {c.revealed ? "Veil" : "Reveal"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

