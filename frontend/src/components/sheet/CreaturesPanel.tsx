/*
The second stat block.

Rangers, Druids, Wizards and Artificers all bring a creature to the table that
is not the hero: a wolf you become, a defender that takes its own turn, a
familiar. The sheet showed one stat block and the beasts lived in the Den —
a DM room — so a Druid could read "you assume a Beast form" and had nowhere in
the app to find out what a wolf's numbers were.

Three things share this panel because at the table they are the same question:

  - a **form** replaces the hero's statistics and keeps their hit points, so it
    shows a Take/Drop toggle and the temporary hit points assuming it grants,
    never a pool of its own;
  - a **companion** and a **summon** are separate creatures, so they carry
    their own hit points and a tracker for them.

Every number is moldable. A companion's book value is a starting point — half
of them scale off the hero's level, and the ones that don't get houseruled — so
the editor writes overrides, the server merges them over the library entry, and
`molded` marks which numbers stopped tracking the book.
*/

import { useState } from "react";
import type {
  CharacterCreature,
  CreatureOption,
  CreatureRole,
  RulesContent,
} from "../../api/client";
import { useAddCreature, useCreatureOptions, useDeleteCreature, useUpdateCreature } from "../../hooks";
import {
  MOLDABLE_ABILITIES as ABILITIES,
  MOLDABLE_FIELDS as MOLDABLE,
  moldPatch,
  moldSeed,
} from "../../lib/creatures";
import ContentEntry from "../ui/ContentEntry";
import ParchmentModal from "../ui/ParchmentModal";
import { IconPlus, IconTrash } from "../ui/icons";
import SectionLabel from "./SectionLabel";

/** The stat block as ContentEntry wants it — a monster entry it can render. */
function asContent(creature: CharacterCreature): RulesContent {
  return {
    id: creature.id,
    kind: "monster",
    source: creature.blockSource === "srd" ? "srd" : "homebrew",
    name: creature.name,
    summary: "",
    data: creature.block,
    mine: true,
  };
}

function optionAsContent(option: CreatureOption): RulesContent {
  return {
    id: option.contentId ?? "",
    kind: "monster",
    source: "srd",
    name: option.name,
    summary: option.summary ?? "",
    data: option.block,
    mine: false,
  };
}

const ROLE_LABEL: Record<CreatureRole, string> = {
  form: "Form",
  companion: "Companion",
  summon: "Summon",
};

function Stamp({ children }: { children: React.ReactNode }) {
  return (
    <span className="label-stamp text-[8px] tracking-[1px] text-ink-label">{children}</span>
  );
}

export default function CreaturesPanel({
  characterId,
  creatures,
  canEdit,
}: {
  characterId: string;
  creatures: CharacterCreature[];
  canEdit: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [reading, setReading] = useState<CharacterCreature | null>(null);
  const [molding, setMolding] = useState<CharacterCreature | null>(null);
  const [preview, setPreview] = useState<CreatureOption | null>(null);
  const update = useUpdateCreature(characterId);
  const remove = useDeleteCreature(characterId);

  // The picker is the only thing that needs the options, and asking for them
  // means resolving every eligible Beast — so it waits until it is opened.
  const { data: options, isLoading: optionsLoading } = useCreatureOptions(characterId, picking);

  const nothingYet = creatures.length === 0;
  if (nothingYet && !canEdit) return null;

  function setHp(creature: CharacterCreature, next: number) {
    const max = creature.hpMax ?? 0;
    update.mutate({
      creatureId: creature.id,
      hpCurrent: Math.min(Math.max(next, 0), max),
    });
  }

  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <SectionLabel>Forms &amp; Companions</SectionLabel>
        {canEdit && (
          <button
            onClick={() => setPicking(true)}
            className="label-stamp mb-2.5 flex cursor-pointer items-center gap-1 rounded-[2px] border-none px-2.5 py-1 text-[9px] tracking-[1px]"
            style={{
              background: "rgba(16,9,5,.4)",
              color: "#cdba93",
              boxShadow: "inset 0 0 0 1px rgba(201,162,39,.3)",
            }}
          >
            <IconPlus size={11} strokeWidth={2} />
            Add
          </button>
        )}
      </div>

      <div className="parchment flex flex-col gap-2.5 px-4 py-4">
        {nothingYet ? (
          <div className="font-accent text-[12.5px] italic text-ink-body">
            Nothing walks beside this hero yet. A Druid's Wild Shape, a familiar, a
            steed or a construct all belong here.
          </div>
        ) : (
          creatures.map((creature) => {
            const isForm = creature.role === "form";
            return (
              <div
                key={creature.id}
                className="rounded-[2px] px-3 py-2.5"
                style={{
                  background: creature.active ? "rgba(201,162,39,.10)" : "rgba(120,86,42,.06)",
                  boxShadow: `inset 0 0 0 1px rgba(120,80,30,${creature.active ? ".45" : ".22"})`,
                }}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <button
                    onClick={() => setReading(creature)}
                    className="cursor-pointer border-none bg-transparent p-0 text-left font-heading text-[13.5px] font-bold text-ink"
                    title="Read the stat block"
                  >
                    {creature.name}
                  </button>
                  <Stamp>{ROLE_LABEL[creature.role]}</Stamp>
                  {creature.grantedBy && <Stamp>· {creature.grantedBy}</Stamp>}
                  {creature.molded.length > 0 && (
                    <span
                      className="label-stamp text-[8px] tracking-[1px] text-[#8b2520]"
                      title={`Set by hand: ${creature.molded.join(", ")}`}
                    >
                      molded
                    </span>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-ink-body">
                  <span>AC {String(creature.block.ac ?? "—")}</span>

                  {isForm ? (
                    <>
                      {/* In a form the hero keeps their own hit points. Saying
                          so is the point: a player who tracks a separate pool
                          here is playing it wrong. */}
                      <span className="italic">
                        keeps your hit points
                        {creature.tempHp ? ` · +${creature.tempHp} temp HP` : ""}
                      </span>
                      {canEdit && (
                        <button
                          onClick={() =>
                            update.mutate({ creatureId: creature.id, active: !creature.active })
                          }
                          className="btn-base btn-ghost-ink px-3 py-1 text-[10.5px]"
                        >
                          {creature.active ? "Drop the form" : "Take the form"}
                        </button>
                      )}
                    </>
                  ) : (
                    creature.hpMax != null && (
                      <span className="flex items-center gap-1.5">
                        <Stamp>HP</Stamp>
                        {canEdit && (
                          <button
                            onClick={() => setHp(creature, (creature.hpCurrent ?? 0) - 1)}
                            className="btn-base btn-ghost-ink h-6 w-6 p-0 text-[13px] leading-none"
                            aria-label={`Damage ${creature.name}`}
                          >
                            −
                          </button>
                        )}
                        <span className="font-heading font-bold tabular-nums text-ink">
                          {creature.hpCurrent ?? 0}/{creature.hpMax}
                        </span>
                        {canEdit && (
                          <button
                            onClick={() => setHp(creature, (creature.hpCurrent ?? 0) + 1)}
                            className="btn-base btn-ghost-ink h-6 w-6 p-0 text-[13px] leading-none"
                            aria-label={`Heal ${creature.name}`}
                          >
                            +
                          </button>
                        )}
                      </span>
                    )
                  )}
                </div>

                {creature.notes && (
                  <div className="font-accent mt-1 text-[11.5px] italic text-ink-body">
                    {creature.notes}
                  </div>
                )}

                {canEdit && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => setMolding(creature)}
                      className="btn-base btn-ghost-ink px-3 py-1 text-[10.5px]"
                    >
                      Mold
                    </button>
                    <button
                      onClick={() => remove.mutate(creature.id)}
                      className="btn-base btn-ghost-ink flex items-center gap-1 px-3 py-1 text-[10.5px]"
                    >
                      <IconTrash size={11} strokeWidth={1.8} />
                      Release
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {reading && (
        <ParchmentModal onClose={() => setReading(null)} maxWidth="max-w-[600px]">
          <ContentEntry entry={asContent(reading)} />
        </ParchmentModal>
      )}

      {molding && (
        <MoldModal
          characterId={characterId}
          creature={molding}
          onClose={() => setMolding(null)}
        />
      )}

      {picking && (
        <PickerModal
          characterId={characterId}
          options={options}
          loading={optionsLoading}
          onClose={() => setPicking(false)}
          onPreview={(option) => setPreview(option)}
        />
      )}
      {preview && (
        <ParchmentModal onClose={() => setPreview(null)} maxWidth="max-w-[600px]">
          <ContentEntry entry={optionAsContent(preview)} />
        </ParchmentModal>
      )}
    </section>
  );
}

/*
Molding: the editor that makes a book value a starting point.

It writes the whole override map every time, because that is the patch's
contract — clearing a field hands the number back to the library entry, which
is the only way to un-mold something once you have touched it.
*/
function MoldModal({
  characterId,
  creature,
  onClose,
}: {
  characterId: string;
  creature: CharacterCreature;
  onClose: () => void;
}) {
  const update = useUpdateCreature(characterId);
  const [name, setName] = useState(creature.name);
  const [notes, setNotes] = useState(creature.notes ?? "");
  /*
  The inputs show the numbers as played — the merged block — so the player
  edits what they can see. What they *mean* by leaving one alone is "don't
  touch this", and that is not the same as "set it to what it currently
  reads": a field already molded must stay molded, and one still tracking the
  book must keep tracking it.

  So the seed is remembered, and only a field that moved off its seed counts as
  an edit. Everything else keeps whatever `overrides` already said, which is
  why the API sends the unmerged map — `block` cannot tell the two apart.
  */
  const [seed] = useState(() => moldSeed(creature.block));
  const [fields, setFields] = useState<Record<string, string>>(seed);

  function save() {
    update.mutate(
      {
        creatureId: creature.id,
        name: name.trim() || creature.name,
        notes,
        overrides: moldPatch(creature.overrides, seed, fields),
      },
      { onSuccess: onClose },
    );
  }

  const field = (key: string, label: string) => (
    <label key={key} className="flex flex-col gap-1">
      <span className="label-stamp text-[8.5px] tracking-[1px] text-ink-label">{label}</span>
      <input
        value={fields[key]}
        onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
        className="input-hall h-8 px-2 text-[12px]"
      />
    </label>
  );

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[460px]">
      <div className="font-display text-[15px] font-bold text-ink">Mold {creature.name}</div>
      <div className="font-accent mt-0.5 text-[11.5px] italic text-ink-body">
        Blank a field to hand that number back to the book — it will follow your
        level again.
      </div>

      <label className="mt-3 flex flex-col gap-1">
        <span className="label-stamp text-[8.5px] tracking-[1px] text-ink-label">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          className="input-hall h-8 px-2 text-[12px]"
        />
      </label>

      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {MOLDABLE.map(([key, label]) => field(key, label))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2.5 sm:grid-cols-6">
        {ABILITIES.map((ab) => field(ab, ab.toUpperCase()))}
      </div>

      <label className="mt-3 flex flex-col gap-1">
        <span className="label-stamp text-[8.5px] tracking-[1px] text-ink-label">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={2000}
          className="input-hall px-2 py-1.5 text-[12px]"
        />
      </label>

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="btn-base btn-ghost-ink px-4 py-2 text-[11px]">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={update.isPending}
          className="btn-base btn-gold clip-octagon px-5 py-2 text-[11px]"
        >
          Save
        </button>
      </div>
    </ParchmentModal>
  );
}

/*
The picker — and the whole of a player's reach into monster stat blocks.

It shows what the hero's own features grant and nothing else: the Beasts under
a Druid's current CR ceiling because Wild Shape says so, the companions a
subclass or feat names. A hero whose features grant neither gets the hand-
written row, which is what a houseruled creature or a DM's improvisation needs.
*/
function PickerModal({
  characterId,
  options,
  loading,
  onClose,
  onPreview,
}: {
  characterId: string;
  options: ReturnType<typeof useCreatureOptions>["data"];
  loading: boolean;
  onClose: () => void;
  onPreview: (option: CreatureOption) => void;
}) {
  const add = useAddCreature(characterId);
  const [search, setSearch] = useState("");
  const [byHand, setByHand] = useState({ name: "", ac: "", hp: "" });

  function take(option: CreatureOption) {
    add.mutate(
      {
        role: option.role,
        contentId: option.contentId,
        name: option.name,
        grantedBy: option.grantedBy,
      },
      { onSuccess: onClose },
    );
  }

  const q = search.trim().toLowerCase();
  const match = (option: CreatureOption) => !q || option.name.toLowerCase().includes(q);

  const row = (option: CreatureOption, key: string) => (
    <div key={key} className="flex items-center gap-2">
      <button
        onClick={() => onPreview(option)}
        className="flex-1 cursor-pointer border-none bg-transparent p-0 text-left text-[12.5px] text-ink"
        title="Read the stat block"
      >
        <span className="font-heading font-bold">{option.name}</span>
        <span className="label-stamp ml-2 text-[8px] tracking-[1px] text-ink-label">
          CR {String((option.block.cr ?? "?")).split(" ")[0]} · AC {String(option.block.ac ?? "—")}
        </span>
      </button>
      <button
        onClick={() => take(option)}
        disabled={add.isPending}
        className="btn-base btn-ghost-ink px-3 py-1 text-[10.5px]"
      >
        Take
      </button>
    </div>
  );

  const forms = options?.forms ?? [];
  const companions = options?.companions ?? [];
  const grantsNothing = !loading && forms.length === 0 && companions.length === 0;

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[560px]">
      <div className="font-display text-[15px] font-bold text-ink">
        What this hero can call on
      </div>

      {loading && (
        <div className="font-accent mt-3 text-[12.5px] italic text-ink-body">
          Reading what your features grant…
        </div>
      )}

      {grantsNothing && (
        <div className="font-accent mt-2 text-[12px] italic text-ink-body">
          No feature on this sheet grants a form or a companion. Write one by hand
          below, or import a pack that ships one.
        </div>
      )}

      {(forms.length > 0 || companions.length > 0) && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="input-hall mt-3 h-8 w-full px-2 text-[12px]"
        />
      )}

      {companions.length > 0 && (
        <div className="mt-3">
          <div className="label-stamp text-[8.5px] tracking-[1px] text-ink-label">
            Companions
          </div>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {companions.filter(match).map((option, i) => row(option, `c${i}`))}
          </div>
        </div>
      )}

      {forms.map((allowance, i) => (
        <div key={`f${i}`} className="mt-3">
          <div className="label-stamp text-[8.5px] tracking-[1px] text-ink-label">
            {allowance.feature} — {allowance.known} known · up to CR{" "}
            {allowance.maxCR < 1 ? `1/${Math.round(1 / allowance.maxCR)}` : allowance.maxCR}
            {allowance.fly ? " · flight allowed" : " · no flying forms yet"}
            {allowance.tempHp > 0 ? ` · +${allowance.tempHp} temp HP` : ""}
          </div>
          <div className="mt-1.5 flex max-h-[240px] flex-col gap-1.5 overflow-y-auto">
            {allowance.options.filter(match).map((option, j) => row(option, `f${i}-${j}`))}
          </div>
        </div>
      ))}

      {/* A houseruled beast, a DM's improvisation, a creature from a book this
          instance does not have — all of them start here. */}
      <div className="mt-4 border-t pt-3" style={{ borderColor: "rgba(90,60,20,.25)" }}>
        <div className="label-stamp text-[8.5px] tracking-[1px] text-ink-label">
          Or write one by hand
        </div>
        <div className="mt-1.5 flex flex-wrap items-end gap-2">
          <input
            value={byHand.name}
            onChange={(e) => setByHand({ ...byHand, name: e.target.value })}
            placeholder="Name"
            maxLength={80}
            className="input-hall h-8 min-w-[120px] flex-1 px-2 text-[12px]"
          />
          <input
            value={byHand.ac}
            onChange={(e) => setByHand({ ...byHand, ac: e.target.value.replace(/\D/g, "") })}
            placeholder="AC"
            className="input-hall h-8 w-14 px-2 text-center text-[12px]"
          />
          <input
            value={byHand.hp}
            onChange={(e) => setByHand({ ...byHand, hp: e.target.value.replace(/\D/g, "") })}
            placeholder="HP"
            className="input-hall h-8 w-14 px-2 text-center text-[12px]"
          />
          <button
            onClick={() =>
              add.mutate(
                {
                  role: "companion",
                  name: byHand.name.trim(),
                  overrides: {
                    ac: Number(byHand.ac) || 10,
                    hp: Number(byHand.hp) || 1,
                  },
                },
                { onSuccess: onClose },
              )
            }
            disabled={!byHand.name.trim() || add.isPending}
            className="btn-base btn-gold clip-octagon h-8 px-4 text-[11px]"
          >
            Add
          </button>
        </div>
      </div>
    </ParchmentModal>
  );
}
