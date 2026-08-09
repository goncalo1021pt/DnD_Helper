import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import type { Character, SeatConflict } from "../api/client";
import {
  useCharacters,
  useSetSpellSlots,
  useCharacterTree,
  useCreateCharacter,
  useDeleteCharacter,
  useMyCharacters,
  useRevealCharacter,
  useSeatCharacter,
  useSetPact,
  useTrees,
  useUpdateCharacter,
} from "../hooks";
import { hpColor, initials, medallionFor } from "../lib/party";
import { nextLevelXP, readyToLevel } from "../lib/progression";
import AbilityRow from "./ui/AbilityRow";
import CharacterForm, { emptyHero } from "./CharacterForm";
import type { CampaignContext } from "./CampaignView";
import FloatingDiceTray from "./ui/DiceTray";
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
    setSlots.mutate(arr.slice(0, Math.max(...slots.map((s) => s.level))));
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

function CharacterCard({
  character,
  canEdit,
  isDM,
  campaignId,
  veiled,
  progression,
}: {
  character: Character;
  canEdit: boolean;
  isDM: boolean;
  campaignId: string;
  veiled: boolean;
  progression: string;
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
            {character.class || "Adventurer"}
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
  const resting = (myHeroes ?? []).filter((h) => !h.campaignId);
  const chosen = resting.find((h) => h.id === choice);

  if (resting.length === 0) return null;
  return (
    <div className="flex flex-col items-end gap-2">
    <div className="flex items-center gap-2">
      <select
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        className="input-parchment input-compact w-44 cursor-pointer text-[13px]"
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
              onSuccess: () => {
                setChoice("");
                setConflict(null);
              },
              onError: (err) => {
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

export default function PartyRoster() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const { data: characters, isLoading } = useCharacters(campaign.id);
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

      {isLoading ? (
        <div className="font-accent px-5 py-[70px] text-center text-base italic text-[#9c855e]">
          Calling the roll…
        </div>
      ) : characters && characters.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(290px,100%),1fr))] gap-6">
          {characters.map((c) =>
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
              />
            ),
          )}
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
