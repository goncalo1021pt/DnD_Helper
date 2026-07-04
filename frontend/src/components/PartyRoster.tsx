import { useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import type { Character, CharacterInput } from "../api/client";
import {
  useCharacters,
  useCreateCharacter,
  useDeleteCharacter,
  useUpdateCharacter,
} from "../hooks";
import type { CampaignContext } from "./CampaignView";
import ParchmentModal from "./ui/ParchmentModal";
import {
  IconPencil,
  IconPlus,
  IconTrash,
  IconUsers,
} from "./ui/icons";

/* Medallion gradients (from the Emberhall reference); picked by a stable hash. */
const MEDALLIONS = [
  "linear-gradient(140deg,#6b3f2a,#3a2113)",
  "linear-gradient(140deg,#5a3a63,#2f1e36)",
  "linear-gradient(140deg,#3f5530,#22301a)",
  "linear-gradient(140deg,#2f4a55,#16282f)",
  "linear-gradient(140deg,#6a2f2f,#371616)",
  "linear-gradient(140deg,#4a4030,#27210f)",
];

function medallionFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 1000;
  return MEDALLIONS[h % MEDALLIONS.length];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

/* HP color by remaining fraction: healthy sage, worn gold, dying wax-red. */
function hpColor(current: number, max: number): string {
  const pct = max > 0 ? current / max : 0;
  if (pct > 0.6) return "#4d6b39";
  if (pct > 0.3) return "#b07a2e";
  return "#8b2520";
}

interface FormValues {
  name: string;
  class: string;
  level: number;
  hpCurrent: number;
  hpMax: number;
}

function CharacterForm({
  initial,
  mode,
  isPending,
  errorText,
  onSubmit,
  onCancel,
}: {
  initial: FormValues;
  mode: "create" | "edit";
  isPending: boolean;
  errorText?: string;
  onSubmit: (values: CharacterInput) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<FormValues>(initial);

  function set<K extends keyof FormValues>(key: K, val: FormValues[K]) {
    setV((prev) => ({ ...prev, [key]: val }));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!v.name.trim()) return;
    onSubmit({
      name: v.name.trim(),
      class: v.class.trim(),
      level: v.level,
      // A fresh hero arrives at full health.
      hpCurrent: mode === "create" ? v.hpMax : v.hpCurrent,
      hpMax: v.hpMax,
    });
  }

  const input = "input-parchment input-compact";

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 text-ink-strong">
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Name</span>
        <input
          className={`${input} font-heading font-semibold`}
          placeholder="e.g. Thorne Ashmantle"
          value={v.name}
          maxLength={80}
          onChange={(e) => set("name", e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="field-label">Class &amp; ancestry</span>
        <input
          className={input}
          placeholder="e.g. Dragonborn Paladin"
          value={v.class}
          maxLength={80}
          onChange={(e) => set("class", e.target.value)}
        />
      </label>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Level</span>
          <input
            type="number"
            min={1}
            max={20}
            className={input}
            value={v.level}
            onChange={(e) => set("level", Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Max HP</span>
          <input
            type="number"
            min={1}
            max={9999}
            className={input}
            value={v.hpMax}
            onChange={(e) => set("hpMax", Number(e.target.value))}
          />
        </label>
        {mode === "edit" && (
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Current HP</span>
            <input
              type="number"
              min={0}
              max={9999}
              className={input}
              value={v.hpCurrent}
              onChange={(e) => set("hpCurrent", Number(e.target.value))}
            />
          </label>
        )}
      </div>

      <div className="torn-divider" />

      {errorText && (
        <p className="font-body m-0 text-sm italic text-[#8b2520]">{errorText}</p>
      )}

      <div className="flex gap-2.5">
        <button
          type="submit"
          disabled={isPending || !v.name.trim()}
          className="btn-base btn-wax clip-octagon px-6 py-[11px] text-xs"
        >
          {mode === "create" ? "Take a seat" : "Save the hero"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-base btn-ghost-ink px-5 py-[11px] text-xs"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function CharacterCard({
  character,
  canEdit,
  campaignId,
}: {
  character: Character;
  canEdit: boolean;
  campaignId: string;
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
          <div className="font-display truncate text-[17px] font-bold leading-tight text-ink">
            {character.name}
          </div>
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

export default function PartyRoster() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const { data: characters, isLoading } = useCharacters(campaign.id);
  const create = useCreateCharacter(campaign.id);
  const [adding, setAdding] = useState(false);

  return (
    <div className="panel-hall px-[30px] pb-11 pt-8">
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

        <button
          onClick={() => setAdding(true)}
          className="btn-base btn-gold clip-octagon h-10 px-5 text-[13px]"
        >
          <IconPlus size={15} strokeWidth={2} />
          Take a Seat
        </button>
      </div>

      {isLoading ? (
        <div className="font-accent px-5 py-[70px] text-center text-base italic text-[#9c855e]">
          Calling the roll…
        </div>
      ) : characters && characters.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-6">
          {characters.map((c) => (
            <CharacterCard
              key={c.id}
              character={c}
              canEdit={c.mine || isDM}
              campaignId={campaign.id}
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
            initial={{ name: "", class: "", level: 1, hpCurrent: 10, hpMax: 10 }}
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
    </div>
  );
}
