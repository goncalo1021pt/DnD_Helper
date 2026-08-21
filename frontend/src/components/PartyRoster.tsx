import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import type { Character, Npc, Party, RulesContent, SeatConflict } from "../api/client";
import {
  useCharacters,
  useSetSpellSlots,
  useCharacterTree,
  useCreateCharacter,
  useDeleteCharacter,
  useMyCharacters,
  useCreateParty,
  useDeleteParty,
  useNpcs,
  useParties,
  useRenameParty,
  useSetCharacterParty,
  useRevealCharacter,
  useSeatCharacter,
  useSetNpcHp,
  useSetPact,
  useTrees,
  useUpdateCharacter,
} from "../hooks";
import { classLine } from "../lib/classes";
import { hpColor, initials, medallionFor } from "../lib/party";
import { nextLevelXP, readyToLevel } from "../lib/progression";
import AbilityRow from "./ui/AbilityRow";
import CharacterForm, { emptyHero } from "./CharacterForm";
import { PartyRoom } from "./party/PartyRoom";
import type { CampaignContext } from "./CampaignView";
import FloatingDiceTray from "./ui/DiceTray";
import ContentEntry from "./ui/ContentEntry";
import ParchmentModal from "./ui/ParchmentModal";
import SeatConflictModal from "./ui/SeatConflictModal";
import {
  IconPencil,
  IconPlus,
  IconTrash,
  IconUsers,
} from "./ui/icons";

/* The character's pact line: tree name + waiting picks, or a DM bind control. */
function PactRow({
  character,
  isDM,
  campaignId,
}: {
  character: Character;
  isDM: boolean;
  campaignId: string;
}) {
  const { data: state } = useCharacterTree(character.id);
  const { data: trees } = useTrees(campaignId);
  const setPact = useSetPact(character.id);
  const [choice, setChoice] = useState("");

  if (!state) return null;

  if (!state.assigned) {
    if (!isDM || !trees || trees.length === 0) return null;
    return (
      <div className="mt-3 flex items-center gap-2">
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="input-parchment input-compact flex-1 cursor-pointer text-[13px]"
        >
          <option value="">Bind to a tree…</option>
          {trees.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => choice && setPact.mutate(choice)}
          disabled={!choice || setPact.isPending}
          className="btn-base btn-ghost-ink h-10 px-3 text-[10px]"
        >
          Bind
        </button>
      </div>
    );
  }

  const remaining = state.picksRemaining ?? 0;
  return (
    <div className="mt-3 flex items-center justify-between gap-2">
      <span className="label-stamp truncate text-[9.5px] tracking-[1.5px] text-ink-label">
        ◆ {state.tree?.tree.name}
      </span>
      <Link
        to={`../characters/${character.id}/web`}
        className="label-stamp flex-none text-[10px] font-semibold text-[#8b2520] no-underline hover:underline"
      >
        {remaining > 0 ? `${remaining} waiting · ` : ""}Open the web →
      </Link>
    </div>
  );
}

/** In-session spell slots, ticked like HP. */
function SlotPips({ character, canEdit }: { character: Character; canEdit: boolean }) {
  const setSlots = useSetSpellSlots(character.id);
  const slots = character.sheet?.spellSlots ?? [];
  function tick(level: number, used: number, max: number, delta: number) {
    const next = Math.min(Math.max(used + delta, 0), max);
    if (next === used) return;
    const arr = new Array(9).fill(0);
    for (const s of slots) arr[s.level - 1] = s.used;
    arr[level - 1] = next;
    setSlots.mutate({ used: arr.slice(0, Math.max(...slots.map((s) => s.level))) });
  }
  return (
    <div className="mt-2 flex flex-col gap-1">
      {slots.map((s) => (
        <div key={s.level} className="flex items-center gap-2">
          <span className="label-stamp w-8 text-[8px] tracking-[1px] text-ink-label">Lv {s.level}</span>
          <div className="flex gap-1">
            {Array.from({ length: s.max }, (_, i) => (
              <button
                key={i}
                disabled={!canEdit}
                onClick={() => tick(s.level, s.used, s.max, i < s.used ? -1 : 1)}
                title={i < s.used ? "spent — click to restore" : "click to spend"}
                className="h-3.5 w-3.5 cursor-pointer rounded-full border-none p-0"
                style={{
                  background: i < s.used ? "#3d2317" : "linear-gradient(180deg,#e0a94e,#9a703a)",
                  boxShadow: "inset 0 0 0 1.2px rgba(61,35,23,.7)",
                  opacity: canEdit ? 1 : 0.7,
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/*
 * A hero behind the table's veil: a name, the player behind it, and nothing
 * else. The card is deliberately quiet — no medallion level, no HP bar, no
 * link to a sheet the server would refuse anyway.
 */
function VeiledCard({ character }: { character: Character }) {
  return (
    <div className="parchment px-[22px] pb-5 pt-[18px]" style={{ opacity: 0.92 }}>
      <div className="flex items-center gap-3.5">
        <div
          className="font-heading flex h-[50px] w-[50px] flex-none items-center justify-center rounded-[3px] text-[19px] font-bold text-[#f3e6c8]"
          style={{
            background: "linear-gradient(160deg,#4a3a2a,#241a12)",
            boxShadow: "inset 0 0 0 1.5px rgba(201,162,39,.35), 0 3px 6px rgba(0,0,0,.35)",
          }}
          title="Veiled"
        >
          ?
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display block truncate text-[17px] font-bold leading-tight text-ink">
            {character.name}
          </div>
          <div className="truncate text-[12.5px] text-ink-body">
            <span className="font-accent italic text-ink-label">
              played by {character.ownerName}
            </span>
          </div>
        </div>
      </div>

      <div
        className="mt-3.5 rounded-[2px] px-3 py-2.5"
        style={{ background: "rgba(60,40,20,.10)", boxShadow: "inset 0 0 0 1px rgba(120,80,30,.28)" }}
      >
        <div className="label-stamp text-[9px] tracking-[1.5px] text-ink-label">
          ◈ Veiled
        </div>
        <div className="font-accent mt-1 text-[12.5px] italic leading-snug text-ink-body">
          Their sheet is the DM's to show — you know them by name alone.
        </div>
      </div>
    </div>
  );
}

/*
 * The veil, from the side that can see through it. The DM gets the lantern —
 * show this hero to the party, or put them alone in the light — and everyone
 * else gets a note saying where their own hero stands.
 */
function VeilRow({
  character,
  isDM,
  campaignId,
}: {
  character: Character;
  isDM: boolean;
  campaignId: string;
}) {
  const reveal = useRevealCharacter(campaignId);
  const shown = character.revealed ?? false;

  if (!isDM) {
    return (
      <div className="label-stamp mt-3 text-[8.5px] leading-relaxed tracking-[1.5px] text-ink-label">
        {shown
          ? "◈ the DM has shown this sheet to the party"
          : "◈ veiled — the party sees only the name"}
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="label-stamp flex-1 text-[8.5px] tracking-[1.5px] text-ink-label">
        {shown ? "◈ in the light" : "◈ veiled from the party"}
      </span>
      <button
        onClick={() => reveal.mutate({ characterId: character.id, revealed: !shown })}
        disabled={reveal.isPending}
        title={shown ? "Veil this hero from the party again" : "Show this hero's sheet to the party"}
        className="btn-base btn-ghost-ink h-8 px-3 text-[10px]"
      >
        {shown ? "Veil" : "Reveal"}
      </button>
    </div>
  );
}

/* Which party a hero rides with (#232). The DM's alone, and a plain picker
   rather than anything cleverer: moving somebody costs them nothing, because
   every grant they were ever given is stamped on their own row. */
function PartyPicker({
  character,
  campaignId,
  parties,
}: {
  character: Character;
  campaignId: string;
  parties: Party[];
}) {
  const move = useSetCharacterParty(campaignId);
  return (
    <select
      value={character.partyId ?? ""}
      disabled={move.isPending}
      onChange={(e) =>
        move.mutate({ characterId: character.id, partyId: e.target.value || null })
      }
      aria-label={`Which party ${character.name} rides with`}
      title="Moving them takes nothing away — what they were shown stays theirs"
      className="input-parchment input-compact w-full cursor-pointer text-[11.5px]"
    >
      <option value="">— rides with no party —</option>
      {parties.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

function CharacterCard({
  character,
  canEdit,
  isDM,
  campaignId,
  veiled,
  progression,
  parties = [],
}: {
  character: Character;
  canEdit: boolean;
  isDM: boolean;
  campaignId: string;
  veiled: boolean;
  progression: string;
  parties?: Party[];
}) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateCharacter(campaignId);
  const del = useDeleteCharacter(campaignId);
  const seat = useSeatCharacter();

  const color = hpColor(character.hpCurrent, character.hpMax);
  const pct = character.hpMax > 0 ? (character.hpCurrent / character.hpMax) * 100 : 0;

  /* The Amend form was written for quick-added heroes. A forged hero carries a
     sheet, and their name, class and level belong to the Forge and the
     level-up — not to a roster form, for anyone. A table-born hero is the DM's
     own scribble, so only the DM rewrites it. HP stays live for both, on the ±
     buttons below. The server refuses the rest either way. */
  const canAmend = canEdit && !character.sheet && (!character.tableBorn || isDM);

  function adjustHp(delta: number) {
    const next = Math.min(Math.max(character.hpCurrent + delta, 0), character.hpMax);
    if (next === character.hpCurrent) return;
    update.mutate({
      characterId: character.id,
      body: {
        name: character.name,
        class: character.class,
        level: character.level,
        hpCurrent: next,
        hpMax: character.hpMax,
      },
    });
  }

  return (
    <div className="parchment px-[22px] pb-5 pt-[18px]">
      <div className="flex items-center gap-3.5">
        {/* medallion */}
        <div
          className="font-heading relative flex h-[50px] w-[50px] flex-none items-center justify-center rounded-[3px] text-[15px] font-bold text-[#f3e6c8]"
          style={{
            background: medallionFor(character.id),
            boxShadow: "inset 0 0 0 1.5px rgba(201,162,39,.5), 0 3px 6px rgba(0,0,0,.35)",
          }}
        >
          {initials(character.name) || "?"}
          <span
            className="font-heading absolute -bottom-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-ember-bright"
            style={{
              background: "#1c1108",
              boxShadow: "inset 0 0 0 1px rgba(201,162,39,.55)",
            }}
            title={`Level ${character.level}`}
          >
            {character.level}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <Link
            to={`/questboard/heroes/${character.id}`}
            className="font-display block truncate text-[17px] font-bold leading-tight text-ink no-underline hover:text-[#8b2520]"
          >
            {character.name}
          </Link>
          <div className="truncate text-[12.5px] text-ink-body">
            {classLine(character)}
            <span className="font-accent italic text-ink-label">
              {" "}
              · played by {character.ownerName}
            </span>
            {character.tableBorn && (
              <span
                className="label-stamp ml-2 text-[8px] tracking-[1px] text-ink-label"
                title="Born of this table — not in anyone's My Heroes"
              >
                of this table
              </span>
            )}
          </div>
        </div>
      </div>

      {/* HP */}
      <div className="mt-3.5">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="label-stamp text-[9.5px] tracking-[1.5px] text-ink-label">
            Hit Points
          </span>
          <span
            className="text-[13px] font-semibold tabular-nums"
            style={{ color }}
          >
            {character.hpCurrent}/{character.hpMax}
          </span>
        </div>
        <div
          className="h-1.5 w-full rounded-[2px]"
          style={{ background: "rgba(0,0,0,.22)" }}
        >
          <div
            className="h-full rounded-[2px] transition-all"
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
      </div>

      {/* progression */}
      {((character.pendingLevels ?? 0) > 0 ||
        (progression === "xp" && character.sheet)) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {(character.pendingLevels ?? 0) > 0 && (
            <span
              className="label-stamp rounded-[2px] px-2 py-1 text-[8.5px] tracking-[1.5px]"
              style={{ color: "#3f2d08", background: "rgba(201,162,39,.35)", boxShadow: "inset 0 0 0 1px rgba(150,110,30,.6)" }}
            >
              ▲ {character.pendingLevels} level-up{(character.pendingLevels ?? 0) > 1 ? "s" : ""} waiting
            </span>
          )}
          {progression === "xp" && character.sheet && (
            <span
              className="label-stamp rounded-[2px] px-2 py-1 text-[8.5px] tracking-[1.5px]"
              style={
                readyToLevel(character.xp ?? 0, character.level)
                  ? { color: "#2f4a12", background: "rgba(143,177,95,.28)", boxShadow: "inset 0 0 0 1px rgba(95,130,55,.55)" }
                  : { color: "#7a5626", background: "rgba(120,86,42,.12)", boxShadow: "inset 0 0 0 1px rgba(120,80,30,.35)" }
              }
            >
              {readyToLevel(character.xp ?? 0, character.level)
                ? "★ ready to level!"
                : `${(character.xp ?? 0).toLocaleString()} / ${nextLevelXP(character.level)?.toLocaleString() ?? "—"} XP`}
            </span>
          )}
        </div>
      )}

      {/* sheet (wizard-forged heroes) */}
      {character.sheet && (
        <div className="mt-3.5">
          <AbilityRow abilities={character.sheet.abilities} />
          {character.sheet.skills.length > 0 && (
            <div className="label-stamp mt-2 text-[8.5px] leading-relaxed tracking-[1px] text-ink-label">
              {character.sheet.skills.join(" · ")}
            </div>
          )}
          {(character.sheet.spellSlots ?? []).length > 0 && (
            <SlotPips character={character} canEdit={canEdit} />
          )}
        </div>
      )}

      <PactRow character={character} isDM={isDM} campaignId={campaignId} />

      {veiled && (
        <VeilRow character={character} isDM={isDM} campaignId={campaignId} />
      )}

      {/* actions */}
      {canEdit && (
        <div className="mt-3.5 flex items-center gap-2">
          <button
            onClick={() => adjustHp(-1)}
            disabled={update.isPending || character.hpCurrent <= 0}
            title="Take 1 damage"
            className="btn-base btn-ghost-red h-8 w-9 text-sm"
          >
            −
          </button>
          <button
            onClick={() => adjustHp(1)}
            disabled={update.isPending || character.hpCurrent >= character.hpMax}
            title="Heal 1"
            className="btn-base btn-ghost-ink h-8 w-9 text-sm"
          >
            +
          </button>
          <span className="flex-1" />
          {canAmend && (
            <button
              onClick={() => setEditing(true)}
              title="Amend the hero"
              className="btn-base btn-ghost-ink p-[9px]"
            >
              <IconPencil strokeWidth={1.8} />
            </button>
          )}
          {character.tableBorn ? (
            /* Born of the table: striking it destroys it — there is no shelf
               to return to. Account heroes can only be unseated here; deleting
               one is the owner's act, from My Heroes. */
            <button
              onClick={() => {
                if (confirm(`Strike "${character.name}" from the roster? Born of this table, they will be gone for good.`))
                  del.mutate(character.id);
              }}
              disabled={del.isPending}
              title="Strike from the roster (table-born: gone for good)"
              className="btn-base btn-ghost-red p-[9px]"
            >
              <IconTrash strokeWidth={1.8} />
            </button>
          ) : character.mine ? (
            <button
              onClick={() =>
                seat.mutate({ characterId: character.id, campaignId: null })
              }
              disabled={seat.isPending}
              title="Unseat — the hero returns to your My Heroes shelf"
              className="btn-base btn-ghost-ink px-3 py-[9px] text-[10px]"
            >
              Unseat
            </button>
          ) : isDM ? (
            /* The DM's bench (#179): unseat without kicking the player. The
               hero returns to the owner's shelf and may be re-seated through
               the usual door — codex and seating approval still apply. */
            <button
              onClick={() => {
                if (confirm(`Bench "${character.name}"? The hero returns to ${character.ownerName}'s My Heroes shelf. They may be re-seated through the usual door.`))
                  seat.mutate({ characterId: character.id, campaignId: null });
              }}
              disabled={seat.isPending}
              title="Bench — the hero returns to its owner's My Heroes shelf"
              className="btn-base btn-ghost-ink px-3 py-[9px] text-[10px]"
            >
              Bench
            </button>
          ) : null}
        </div>
      )}

      {/* Which party they ride with (#232) — the DM's call, and a cheap one:
          moving somebody takes nothing away from them. */}
      {isDM && parties.length > 0 && (
        <div className="mt-2.5">
          <PartyPicker character={character} campaignId={campaignId} parties={parties} />
        </div>
      )}

      {editing && canAmend && (
        <ParchmentModal onClose={() => setEditing(false)} maxWidth="max-w-[480px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Party Ledger
          </div>
          <h3 className="font-display m-0 mb-5 text-center text-2xl font-bold text-ink">
            Amend the Hero
          </h3>
          <CharacterForm
            initial={{
              name: character.name,
              class: character.class,
              level: character.level,
              hpCurrent: character.hpCurrent,
              hpMax: character.hpMax,
            }}
            mode="edit"
            isPending={update.isPending}
            errorText={
              update.isError
                ? ((update.error as { error?: string } | null)?.error ??
                  "The ledger rejected the entry — check the fields and try again.")
                : undefined
            }
            onCancel={() => setEditing(false)}
            onSubmit={(body) =>
              update.mutate(
                { characterId: character.id, body },
                { onSuccess: () => setEditing(false) },
              )
            }
          />
        </ParchmentModal>
      )}
    </div>
  );
}

/* Bring one of your resting heroes from My Heroes to this table. */
function SummonControl({
  campaignId,
  campaignName,
}: {
  campaignId: string;
  campaignName: string;
}) {
  const { data: myHeroes } = useMyCharacters();
  const seat = useSeatCharacter();
  const [choice, setChoice] = useState("");
  /* The codex can refuse a hero at the door. The server says which content it
     objects to; this is where that gets read out instead of thrown away (#128). */
  const [conflict, setConflict] = useState<SeatConflict["missing"] | null>(null);
  /* A barred door answers 202: the request is lodged, not seated. Say so HERE,
     where the player acted — the old silence left the empty state inviting a
     second summon (#247). */
  const [waiting, setWaiting] = useState<string | null>(null);
  const resting = (myHeroes ?? []).filter((h) => !h.campaignId);
  const chosen = resting.find((h) => h.id === choice);

  if (resting.length === 0) return null;
  return (
    <div className="flex flex-col items-end gap-2">
    <div className="flex items-center gap-2">
      <select
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        className="input-hall input-compact w-44 cursor-pointer text-[13px]"
      >
        <option value="">Summon a hero…</option>
        {resting.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name}
          </option>
        ))}
      </select>
      <button
        onClick={() =>
          choice &&
          seat.mutate(
            { characterId: choice, campaignId },
            {
              onSuccess: (result) => {
                setWaiting(result.pending ? (chosen?.name ?? "Your hero") : null);
                setChoice("");
                setConflict(null);
              },
              onError: (err) => {
                setWaiting(null);
                const c = err as unknown as SeatConflict;
                setConflict(c?.missing?.length ? c.missing : []);
              },
            },
          )
        }
        disabled={!choice || seat.isPending}
        className="btn-base btn-ghost-gold h-10 px-3 text-[10px]"
      >
        Summon
      </button>
      </div>

      {waiting !== null && (
        <span className="font-body text-right text-[12px] italic text-gold-muted">
          {waiting} waits at the door — the DM will wave them through.
        </span>
      )}
      {/* Any failure says something. A codex refusal gets the full modal with a
          one-tap proposal; anything else at least admits it happened, rather
          than leaving a button that quietly did nothing. */}
      {conflict !== null && conflict.length === 0 && (
        <span className="font-body text-right text-[12px] italic text-[#e0725f]">
          {(seat.error as { error?: string } | null)?.error ??
            "The summons failed — try again in a moment."}
        </span>
      )}
      {conflict !== null && conflict.length > 0 && (
        <SeatConflictModal
          heroName={chosen?.name ?? "this hero"}
          conflict={{ campaignId, campaignName, missing: conflict }}
          onClose={() => setConflict(null)}
        />
      )}
    </div>
  );
}

/* The parties at this table (#232). Forming, renaming and disbanding all live
   here, because the roster is the only page where "who rides with whom" is the
   subject rather than a detail.

   Disbanding asks nothing and warns nothing, which is the point: a party holds
   no knowledge, so striking one cannot take any away. */
function PartiesBar({ campaignId, parties }: { campaignId: string; parties: Party[] }) {
  const create = useCreateParty(campaignId);
  const rename = useRenameParty(campaignId);
  const disband = useDeleteParty(campaignId);
  const [name, setName] = useState("");

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <span className="label-stamp text-[9px] tracking-[2px] text-gold-muted">
        The parties
      </span>
      {parties.map((p) => (
        <span key={p.id} className="chip-hall gap-2 px-2.5 py-1.5">
          <button
            onClick={() => {
              const next = prompt(`Rename "${p.name}" to…`, p.name);
              if (next && next.trim() && next.trim() !== p.name) {
                rename.mutate({ partyId: p.id, body: { name: next.trim() } });
              }
            }}
            title="Rename this party"
            className="cursor-pointer border-none bg-transparent p-0 font-heading text-[12.5px] font-semibold text-cream"
          >
            {p.name}
          </button>
          <span className="label-stamp text-[8.5px] tracking-[1.5px] text-gold-muted">
            {p.heroCount}
          </span>
          <button
            onClick={() => {
              if (confirm(`Disband "${p.name}"? The heroes stay, and everything they were shown stays theirs.`))
                disband.mutate(p.id);
            }}
            title="Disband — the heroes stay, and so does everything they know"
            aria-label={`Disband ${p.name}`}
            className="cursor-pointer border-none bg-transparent p-0 text-[11px] text-[#c96a5a]"
          >
            ×
          </button>
        </span>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate({ name: name.trim() }, { onSuccess: () => setName("") });
        }}
        className="flex items-center gap-1.5"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Form a party…"
          aria-label="Form a party"
          maxLength={60}
          className="input-hall h-7 w-[150px] text-[11.5px]"
        />
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="btn-base btn-ghost-gold h-7 px-2.5 text-[10px]"
        >
          <IconPlus size={12} /> Form
        </button>
      </form>
    </div>
  );
}

/*
 * Traveling with you (#228): the people who walk beside the party.
 *
 * The paper practice is a line in the margin of the party page — "Sildar
 * travels with you to Phandalin" — so it lives here, below the heroes and
 * plainly apart from them: no medallion, no level, no seat. They are counted
 * among nobody, which is the whole point of #227's discriminator.
 *
 * The bar is for everyone who can see them; the ± is for whoever runs them.
 */
function AllyRow({
  campaignId,
  ally,
  onRead,
}: {
  campaignId: string;
  ally: Npc;
  onRead: (block: RulesContent) => void;
}) {
  const setHp = useSetNpcHp(campaignId);
  const cur = ally.hpCurrent ?? 0;
  const max = ally.hpMax ?? 0;
  const mine = ally.yoursToRun ?? false;
  const color = hpColor(cur, max);
  const pct = max > 0 ? (cur / max) * 100 : 0;

  function adjust(delta: number) {
    const next = Math.min(Math.max(cur + delta, 0), max);
    if (next === cur) return;
    setHp.mutate({ npcId: ally.id, body: { hpCurrent: next } });
  }

  return (
    <div className="chip-hall w-full items-center gap-3 px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-heading truncate text-[14px] font-semibold text-cream">
            {ally.name}
          </span>
          <span className="flex items-center gap-2.5">
            {mine && (
              <span className="label-stamp text-[8.5px] tracking-[1.5px] text-gold-muted">
                yours to run
              </span>
            )}
            {max > 0 && (
              <span
                className="text-[12px] font-semibold tabular-nums"
                style={{
                  color:
                    color === "#8b2520"
                      ? "#d68a72"
                      : color === "#b07a2e"
                        ? "#d8a44e"
                        : "#8fb15f",
                }}
              >
                {cur}/{max}
              </span>
            )}
          </span>
        </div>
        {max > 0 ? (
          <div
            className="mt-1.5 h-[5px] w-full rounded-[2px]"
            style={{ background: "rgba(0,0,0,.45)" }}
          >
            <div
              className="h-full rounded-[2px] transition-all"
              style={{ width: `${pct}%`, background: color }}
            />
          </div>
        ) : (
          // A player is told nothing rather than told there is nothing: with
          // the stats veiled the bar is simply absent, and "no hit points to
          // keep" would be a claim about someone they may not read.
          ally.isDM && (
            <div className="font-accent mt-1 text-[11.5px] italic text-cream-muted">
              Nothing stands behind them yet — no hit points to keep.
            </div>
          )
        )}
        {/* The doors open only where the veils already did: what a viewer may
            read of an ally is decided on the way out, not here. A block the
            server chose to send is meant to be *read* — printing its name and
            stopping there was the roster telling you a secret it would not
            then let you open. */}
        {(ally.characterId || ally.statBlock) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {ally.characterId && (
              <Link
                to={`/questboard/heroes/${ally.characterId}`}
                className="label-stamp text-[9px] tracking-[1.5px] text-gold-muted no-underline hover:text-ember-bright"
              >
                Open their sheet →
              </Link>
            )}
            {ally.statBlock && (
              <button
                onClick={() => onRead(ally.statBlock!)}
                className="label-stamp cursor-pointer border-none bg-transparent p-0 text-[9px] tracking-[1.5px] text-gold-muted hover:text-ember-bright"
              >
                Read their stat block — {ally.statBlock.name} →
              </button>
            )}
          </div>
        )}
      </div>
      {mine && max > 0 && (
        <div className="flex flex-none gap-1">
          <button
            onClick={() => adjust(-1)}
            disabled={setHp.isPending || cur <= 0}
            title={`${ally.name} takes 1 damage`}
            aria-label={`${ally.name} takes 1 damage`}
            className="btn-base h-7 w-7 rounded-[2px] text-[13px] text-[#d68a72]"
            style={{ boxShadow: "inset 0 0 0 1px rgba(139,37,32,.5)" }}
          >
            −
          </button>
          <button
            onClick={() => adjust(1)}
            disabled={setHp.isPending || cur >= max}
            title={`Heal ${ally.name} 1`}
            aria-label={`Heal ${ally.name} 1`}
            className="btn-base h-7 w-7 rounded-[2px] text-[13px] text-gold-hair"
            style={{ boxShadow: "inset 0 0 0 1px rgba(201,162,39,.4)" }}
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}

function TravelingSection({ campaignId, allies }: { campaignId: string; allies: Npc[] }) {
  const [reading, setReading] = useState<RulesContent | null>(null);
  if (allies.length === 0) return null;
  return (
    <section className="mt-8">
      <div
        className="mb-3 flex flex-wrap items-baseline justify-between gap-3 pb-2.5"
        style={{ borderTop: "1px solid rgba(201,162,39,.18)", paddingTop: "22px" }}
      >
        <h3 className="font-display m-0 text-[18px] font-black text-[#e7d3a6]">
          Traveling with you
        </h3>
        <span className="font-accent text-[12.5px] italic text-cream-muted">
          — beside the party, never counted among it. —
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {allies.map((a) => (
          <AllyRow key={a.id} campaignId={campaignId} ally={a} onRead={setReading} />
        ))}
      </div>
      {reading && (
        <ParchmentModal onClose={() => setReading(null)} maxWidth="max-w-[560px]">
          <ContentEntry entry={reading} />
        </ParchmentModal>
      )}
    </section>
  );
}

export default function PartyRoster() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const { data: characters, isLoading } = useCharacters(campaign.id);
  // The Folk who walk with the party. A player only ever receives the people
  // their veil resolves visible, and a traveler is always among them, so this
  // needs no filtering of its own beyond the state itself.
  const { data: folk } = useNpcs(campaign.id);
  const allies = (folk ?? []).filter((n) => n.traveling);
  const { data: partyRoll } = useParties(campaign.id);
  const parties = partyRoll ?? [];

  /* The roster grouped by party, with everyone riding alone at the foot. A
     table that has formed no parties gets exactly one group and no heading —
     the shape it has always had (#232). */
  const groups: Array<{ key: string; name: string; partyId?: string; members: Character[] }> = (() => {
    const heroes = characters ?? [];
    if (parties.length === 0) return [{ key: "all", name: "The Party", members: heroes }];
    const out: Array<{ key: string; name: string; partyId?: string; members: Character[] }> =
      parties.map((p) => ({
      key: p.id,
      name: p.name,
      // Only a real party has a room; "riding with no party" is not a party
      // and has nowhere to talk that the Chronicle is not already (#181).
      partyId: p.id,
      members: heroes.filter((c) => c.partyId === p.id),
    }));
    const loose = heroes.filter((c) => !c.partyId);
    if (loose.length > 0) {
      out.push({ key: "loose", name: "Riding with no party", partyId: undefined, members: loose });
    }
    return out.filter((g) => g.members.length > 0);
  })();
  const create = useCreateCharacter(campaign.id);
  const [adding, setAdding] = useState(false);

  return (
    <div className="panel-hall px-5 pb-28 pt-8 sm:px-[30px] sm:pb-11">
      {/* roster header strip */}
      <div
        className="mb-[26px] flex flex-wrap items-center justify-between gap-4 pb-3.5"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <div className="flex flex-wrap items-baseline gap-3.5">
          <h2
            className="font-display m-0 text-[clamp(24px,3vw,32px)] font-black text-[#e7d3a6]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
          >
            The Party
          </h2>
          {characters && characters.length > 0 && (
            <span className="label-stamp text-xs text-gold-muted">
              {characters.length} adventurer{characters.length === 1 ? "" : "s"}
            </span>
          )}
          {campaign.hiddenSheets && (
            <span
              className="label-stamp rounded-[2px] px-2 py-1 text-[9px] tracking-[1.5px]"
              style={{
                color: "#e0c68f",
                background: "rgba(201,162,39,.14)",
                border: "1px solid rgba(201,162,39,.35)",
              }}
              title={
                isDM
                  ? "You drew the veil — players see only names, except the heroes you reveal"
                  : "The DM drew a veil over the sheets — you read only your own"
              }
            >
              ◈ sheets veiled
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Link
            to="../trees"
            className="label-stamp text-[11px] font-semibold text-ember-bright no-underline transition hover:text-cream"
          >
            The Skill Trees →
          </Link>
          <SummonControl campaignId={campaign.id} campaignName={campaign.name} />
          {isDM && (
            <button
              onClick={() => setAdding(true)}
              title="Add a character born of this table — it will not appear in anyone's My Heroes"
              className="btn-base btn-gold clip-octagon h-10 px-5 text-[13px]"
            >
              <IconPlus size={15} strokeWidth={2} />
              Quick-add
            </button>
          )}
        </div>
      </div>

      {isDM && <PartiesBar campaignId={campaign.id} parties={parties} />}

      {isLoading ? (
        <div className="font-accent px-5 py-[70px] text-center text-base italic text-[#9c855e]">
          Calling the roll…
        </div>
      ) : characters && characters.length > 0 ? (
        <div className="flex flex-col gap-7">
          {groups.map((g) => (
            <section key={g.key}>
              {/* A band only earns a heading once there is more than one, so a
                  table that never splits reads exactly as it did before. */}
              {groups.length > 1 && (
                <div className="mb-3 flex flex-wrap items-baseline gap-3">
                  <h3 className="font-display m-0 text-[16px] font-black text-[#e7d3a6]">
                    {g.name}
                  </h3>
                  <span className="label-stamp text-[9px] tracking-[1.5px] text-gold-muted">
                    {g.members.length} {g.members.length === 1 ? "hero" : "heroes"}
                  </span>
                </div>
              )}
              {/* A party with a name has a room of its own (#181). The heroes
                  riding with nobody are not a party and have nowhere to talk
                  that the Chronicle is not already. */}
              {g.partyId && <PartyRoom partyId={g.partyId} partyName={g.name} />}
              <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(min(290px,100%),1fr))] gap-6">
                {g.members.map((c) =>
                  c.concealed ? (
                    <VeiledCard key={c.id} character={c} />
                  ) : (
                    <CharacterCard
                      key={c.id}
                      character={c}
                      canEdit={c.mine || isDM}
                      isDM={isDM}
                      campaignId={campaign.id}
                      veiled={campaign.hiddenSheets ?? false}
                      progression={campaign.progression ?? "milestone"}
                      parties={parties}
                    />
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="px-5 py-[70px] text-center">
          <div className="mb-4 inline-flex text-[#7a5e34]">
            <IconUsers size={46} strokeWidth={1.4} />
          </div>
          <div className="font-display text-2xl text-[#cdb582]">
            No adventurers yet
          </div>
          <div className="font-accent mt-2 text-base italic text-[#9c855e]">
            — pull up a chair and take a seat. —
          </div>
        </div>
      )}

      <TravelingSection campaignId={campaign.id} allies={allies} />

      {adding && (
        <ParchmentModal onClose={() => setAdding(false)} maxWidth="max-w-[480px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Party Ledger
          </div>
          <h3 className="font-display m-0 mb-2 text-center text-2xl font-bold text-ink">
            Born of this Table
          </h3>
          <p className="font-body m-0 mb-4 text-center text-[13px] italic text-ink-body">
            A quick character for this roster alone — never listed in My
            Heroes, struck for good when removed.
          </p>
          <CharacterForm
            initial={emptyHero}
            mode="create"
            isPending={create.isPending}
            errorText={
              create.isError
                ? ((create.error as { error?: string } | null)?.error ??
                  "The ledger rejected the entry — check the fields and try again.")
                : undefined
            }
            onCancel={() => setAdding(false)}
            onSubmit={(body) =>
              create.mutate(body, { onSuccess: () => setAdding(false) })
            }
          />
        </ParchmentModal>
      )}

      <FloatingDiceTray campaignId={campaign.id} />
    </div>
  );
}
