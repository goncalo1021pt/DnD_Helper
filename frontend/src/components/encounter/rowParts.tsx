/* The two smallest marks in the initiative order, shared by every kind of row —
   a lone combatant, a mob, one skeleton inside a mob, and the player's
   read-only view. */
import { useState } from "react";
import type React from "react";
import type { Combatant } from "../../api/client";
import { useUpdateCombatant } from "../../hooks";
import { IconPencil } from "../ui/icons";
import { mobName } from "./entries";
import { HP_STATE_TONE } from "./theme";

export function HpStatePill({ state }: { state: string }) {
  return (
    <span
      className="label-stamp rounded-[2px] px-1.5 py-0.5 text-[8.5px] font-bold tracking-[1px]"
      style={{ color: HP_STATE_TONE[state], background: `${HP_STATE_TONE[state]}1c`, boxShadow: `inset 0 0 0 1px ${HP_STATE_TONE[state]}55` }}
    >
      {state}
    </span>
  );
}

/* ── shared: an initiative pip, current turn highlighted ──────────────── */
export function TurnMark({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span
      className="font-heading flex h-8 w-8 flex-none items-center justify-center rounded-[3px] text-[13px] font-bold tabular-nums"
      style={{
        color: active ? "#1c1108" : "#e0c890",
        background: active ? "#e0a94e" : "rgba(201,162,39,.1)",
        boxShadow: active ? "0 0 10px rgba(224,169,78,.5)" : "inset 0 0 0 1px rgba(201,162,39,.3)",
      }}
    >
      {children}
    </span>
  );
}

/* ── what the party reads, and the switch that decides it (#286) ────────────

The eye beside the name is about PRESENCE: in the initiative order at all, or
absent from it. This is about IDENTITY, which is a different question and used
to have no answer — `player_label` existed, decided the player's view, and
nothing in the app ever set it, so every enemy read "Unknown" for good.

It states the answer rather than symbolising it. A DM should not have to
remember which of two eyes means what, and "the party sees Goblin 1" is shorter
to read than any icon is to decode. The pencil is the reveal label's original
purpose: a dragon the party may see but not yet name is a "Looming Shape".

A mob moves as one — its members share an identity, so naming any names all,
numbered the way the picker numbered them. */
export function RevealName({
  members,
  campaignId,
  encounterId,
}: {
  members: Combatant[];
  campaignId: string;
  encounterId: string;
}) {
  const update = useUpdateCombatant(campaignId, encounterId);
  const [draft, setDraft] = useState<string | null>(null);
  const named = members.some((m) => (m.playerLabel ?? "").trim() !== "");
  const hidden = members.some((m) => m.hidden);
  // A mob's members are numbered ("Aboleth 1"), but the party reads one line
  // saying "Aboleth ×3" — so the chip quotes the name without the number, or
  // it would claim something the party never sees.
  const raw = (members[0].playerLabel ?? "").trim();
  const shown = members.length > 1 ? mobName(raw) : raw;

  /** Apply one name across the mob, numbering it when there is more than one. */
  function setAll(base: string) {
    members.forEach((m, i) => {
      const next = base === "" || members.length === 1 ? base : `${base} ${i + 1}`;
      if ((m.playerLabel ?? "") !== next) {
        update.mutate({ combatantId: m.id, body: { playerLabel: next } });
      }
    });
  }

  if (draft !== null) {
    const commit = () => {
      setAll(draft.trim());
      setDraft(null);
    };
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
        maxLength={60}
        placeholder="What the party calls it"
        title="What the party reads — leave it empty for Unknown"
        className="input-hall h-6 w-40 text-[11px]"
      />
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={() =>
          // Only a mob loses its number here — setAll puts one back per member.
          // A lone line the DM called "Guard 3" keeps the 3.
          setAll(named ? "" : members.length > 1 ? mobName(members[0].name) : members[0].name)
        }
        title={
          hidden
            ? "The party cannot see this one at all yet — the eye decides that. This is the name they will read once you reveal it."
            : named
              ? "The party knows what this is — click to take the name back"
              : "The party sees Unknown — click to name it"
        }
        className="label-stamp rounded-[2px] px-1.5 py-0.5 text-[8.5px] tracking-[1px]"
        style={{
          color: named ? "#8fb15f" : "#9a86b8",
          background: named ? "rgba(143,177,95,.12)" : "rgba(154,134,184,.12)",
          boxShadow: `inset 0 0 0 1px ${named ? "rgba(143,177,95,.4)" : "rgba(154,134,184,.4)"}`,
        }}
      >
        party sees {named ? `“${shown}”` : "Unknown"}
      </button>
      <button
        onClick={() => setDraft(shown)}
        title="Call it something else to the party"
        className="flex-none text-gold-muted transition hover:text-ember-bright"
      >
        <IconPencil size={10} strokeWidth={2} />
      </button>
    </span>
  );
}
