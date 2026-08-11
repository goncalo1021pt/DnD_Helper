/*
The satchel: everything the table has been handed, on the Chronicle page.

Two surfaces, one list. The feed line marks the moment a prop arrived; this
strip is where it stays findable three sessions later, which a scrolling feed
can never be. A player only ever receives handouts they may look at, so the
strip is simply empty for them until the DM hands something over — there is no
locked card, because a veiled prop is not in their copy of the world at all.
*/

import type { Character, Handout } from "../../api/client";
import { handoutImageUrl } from "../../hooks";
import { IconEye, IconEyeOff, IconPencil, IconPlus } from "../ui/icons";

/** What the DM's badge says about who is holding this one. */
function veilState(h: Handout): { label: string; tone: string; icon: "eye" | "eyeOff" } {
  const singled = (h.visibility ?? []).length;
  if (h.visibleToParty) {
    return singled > 0
      ? { label: `All but ${singled}`, tone: "#d0a75a", icon: "eye" }
      : { label: "Revealed", tone: "#8fb15f", icon: "eye" };
  }
  return singled > 0
    ? { label: `${singled} hero${singled === 1 ? "" : "es"}`, tone: "#d0a75a", icon: "eye" }
    : { label: "Veiled", tone: "#a8967a", icon: "eyeOff" };
}

function HandoutCard({
  handout,
  isDM,
  onOpen,
  onManage,
}: {
  handout: Handout;
  isDM: boolean;
  onOpen: () => void;
  onManage: () => void;
}) {
  const state = veilState(handout);

  return (
    <div className="flex w-[150px] flex-none flex-col gap-1.5">
      <button
        onClick={onOpen}
        // Named for the prop, not its caption: the tooltip may say "Sealed in
        // red wax", but "look at the sealed letter" is what the control does.
        aria-label={handout.title}
        title={handout.caption || handout.title}
        className="group relative block cursor-pointer overflow-hidden rounded-[3px] border-none p-0 transition hover:brightness-110"
        style={{
          background: "rgba(0,0,0,.28)",
          boxShadow: "inset 0 0 0 1px rgba(201,162,39,.3)",
        }}
      >
        <img
          src={handoutImageUrl(handout.id)}
          alt={handout.title}
          loading="lazy"
          className="h-[104px] w-full object-cover"
        />
      </button>
      <div className="min-w-0">
        <div className="font-heading truncate text-[12.5px] font-bold text-cream">
          {handout.title}
        </div>
        {handout.caption && (
          <div className="font-accent truncate text-[11px] italic text-cream-muted">
            {handout.caption}
          </div>
        )}
      </div>
      {isDM && (
        <button
          onClick={onManage}
          className="label-stamp flex cursor-pointer items-center justify-center gap-1.5 rounded-[2px] border-none px-2 py-1 text-[9px] tracking-[1px] transition hover:brightness-125"
          style={{
            background: "rgba(201,162,39,.1)",
            boxShadow: "inset 0 0 0 1px rgba(201,162,39,.25)",
            color: state.tone,
          }}
        >
          {state.icon === "eye" ? <IconEye size={11} /> : <IconEyeOff size={11} />}
          {state.label}
          <IconPencil size={10} strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}

export default function HandoutStrip({
  handouts,
  isDM,
  onOpen,
  onManage,
  onAdd,
}: {
  handouts: Handout[];
  isDM: boolean;
  characters: Character[];
  onOpen: (h: Handout) => void;
  onManage: (h: Handout) => void;
  onAdd: () => void;
}) {
  // Nothing to show and nothing to add: a player at a table whose DM has never
  // handed anything over should not be told the feature exists.
  if (!isDM && handouts.length === 0) return null;

  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <span className="label-stamp text-[10px] tracking-[2px] text-gold-muted">Handouts</span>
        {isDM && (
          <button
            onClick={onAdd}
            className="btn-base btn-ghost-gold px-3 py-[7px] text-[11px]"
          >
            <IconPlus size={12} strokeWidth={2} />
            Hand something over
          </button>
        )}
      </div>

      {handouts.length === 0 ? (
        <p className="font-accent text-[13px] italic text-cream-muted">
          The satchel is empty — a letter, a torn map corner, a sigil burned into a
          door, whatever the party should be holding.
        </p>
      ) : (
        <div className="flex gap-3.5 overflow-x-auto pb-2">
          {handouts.map((h) => (
            <HandoutCard
              key={h.id}
              handout={h}
              isDM={isDM}
              onOpen={() => onOpen(h)}
              onManage={() => onManage(h)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
