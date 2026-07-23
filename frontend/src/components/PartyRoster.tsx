import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import type { Character } from "../api/client";
import {
  useCharacters,
  useSetSpellSlots,
  useCharacterTree,
  useCreateCharacter,
  useDeleteCharacter,
  useMyCharacters,
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

function CharacterCard({
  character,
  canEdit,
  isDM,
  campaignId,
  progression,
}: {
  character: Character;
  canEdit: boolean;
  isDM: boolean;
  campaignId: string;
  progression: string;
}) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateCharacter(campaignId);
  const del = useDeleteCharacter(campaignId);

  const color = hpColor(character.hpCurrent, character.hpMax);
  const pct = character.hpMax > 0 ? (character.hpCurrent / character.hpMax) * 100 : 0;

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
          <button
            onClick={() => setEditing(true)}
            title="Edit"
            className="btn-base btn-ghost-ink p-[9px]"
          >
            <IconPencil strokeWidth={1.8} />
          </button>
          <button
            onClick={() => {
              if (confirm(`Strike "${character.name}" from the roster?`))
                del.mutate(character.id);
            }}
            disabled={del.isPending}
            title="Remove"
            className="btn-base btn-ghost-red p-[9px]"
          >
            <IconTrash strokeWidth={1.8} />
          </button>
        </div>
      )}

      {editing && (
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
function SummonControl({ campaignId }: { campaignId: string }) {
  const { data: myHeroes } = useMyCharacters();
  const seat = useSeatCharacter();
  const [choice, setChoice] = useState("");
  const resting = (myHeroes ?? []).filter((h) => !h.campaignId);

  if (resting.length === 0) return null;
  return (
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
            { onSuccess: () => setChoice("") },
          )
        }
        disabled={!choice || seat.isPending}
        className="btn-base h-10 px-3 text-[10px]"
        style={{
          background: "rgba(16,9,5,.4)",
          boxShadow: "inset 0 0 0 1px rgba(201,162,39,.35)",
          color: "#e6d5af",
        }}
      >
        Summon
      </button>
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
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Link
            to="../trees"
            className="label-stamp text-[11px] font-semibold text-ember-bright no-underline transition hover:text-cream"
          >
            The Skill Trees →
          </Link>
          <SummonControl campaignId={campaign.id} />
          <button
            onClick={() => setAdding(true)}
            className="btn-base btn-gold clip-octagon h-10 px-5 text-[13px]"
          >
            <IconPlus size={15} strokeWidth={2} />
            Take a Seat
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="font-accent px-5 py-[70px] text-center text-base italic text-[#9c855e]">
          Calling the roll…
        </div>
      ) : characters && characters.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(290px,100%),1fr))] gap-6">
          {characters.map((c) => (
            <CharacterCard
              key={c.id}
              character={c}
              canEdit={c.mine || isDM}
              isDM={isDM}
              campaignId={campaign.id}
              progression={campaign.progression ?? "milestone"}
            />
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

      {adding && (
        <ParchmentModal onClose={() => setAdding(false)} maxWidth="max-w-[480px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Party Ledger
          </div>
          <h3 className="font-display m-0 mb-5 text-center text-2xl font-bold text-ink">
            Take a Seat at the Table
          </h3>
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

      <FloatingDiceTray />
    </div>
  );
}
