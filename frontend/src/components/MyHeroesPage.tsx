import { useState } from "react";
import type { Character } from "../api/client";
import {
  useCampaigns,
  useCreateMyCharacter,
  useDeleteCharacter,
  useMyCharacters,
  useSeatCharacter,
  useUpdateCharacter,
} from "../hooks";
import { hpColor, initials, medallionFor } from "../lib/party";
import CharacterForm, { emptyHero } from "./CharacterForm";
import ParchmentModal from "./ui/ParchmentModal";
import { IconPencil, IconPlus, IconTrash, IconUsers } from "./ui/icons";

function HeroCard({ character }: { character: Character }) {
  const { data: campaigns } = useCampaigns();
  const seat = useSeatCharacter();
  const update = useUpdateCharacter(character.campaignId ?? "");
  const del = useDeleteCharacter(character.campaignId ?? "");
  const [editing, setEditing] = useState(false);
  const [seatChoice, setSeatChoice] = useState("");

  const color = hpColor(character.hpCurrent, character.hpMax);
  const pct = character.hpMax > 0 ? (character.hpCurrent / character.hpMax) * 100 : 0;
  const seated = !!character.campaignId;

  return (
    <div className="parchment px-[22px] pb-5 pt-[18px]">
      <div className="flex items-center gap-3.5">
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
            style={{ background: "#1c1108", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.55)" }}
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
          </div>
        </div>
      </div>

      {/* HP */}
      <div className="mt-3.5">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="label-stamp text-[9.5px] tracking-[1.5px] text-ink-label">
            Hit Points
          </span>
          <span className="text-[13px] font-semibold tabular-nums" style={{ color }}>
            {character.hpCurrent}/{character.hpMax}
          </span>
        </div>
        <div className="h-1.5 w-full rounded-[2px]" style={{ background: "rgba(0,0,0,.22)" }}>
          <div
            className="h-full rounded-[2px]"
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
      </div>

      {/* seat */}
      <div className="mt-3.5">
        {seated ? (
          <div className="flex items-center justify-between gap-2">
            <span className="label-stamp truncate text-[9.5px] tracking-[1.5px] text-ink-label">
              ⚑ seated at {character.campaignName ?? "a campaign"}
            </span>
            <button
              onClick={() =>
                seat.mutate({ characterId: character.id, campaignId: null })
              }
              disabled={seat.isPending}
              className="btn-base btn-ghost-ink flex-none px-3 py-1.5 text-[10px]"
            >
              Unseat
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={seatChoice}
              onChange={(e) => setSeatChoice(e.target.value)}
              className="input-parchment input-compact flex-1 cursor-pointer text-[13px]"
            >
              <option value="">Resting — seat at…</option>
              {(campaigns ?? []).map((m) => (
                <option key={m.campaign.id} value={m.campaign.id}>
                  {m.campaign.name}
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                seatChoice &&
                seat.mutate(
                  { characterId: character.id, campaignId: seatChoice },
                  { onSuccess: () => setSeatChoice("") },
                )
              }
              disabled={!seatChoice || seat.isPending}
              className="btn-base btn-ghost-ink h-10 px-3 text-[10px]"
            >
              Seat
            </button>
          </div>
        )}
      </div>

      {/* actions */}
      <div className="mt-3.5 flex items-center justify-end gap-2">
        <button
          onClick={() => setEditing(true)}
          title="Edit"
          className="btn-base btn-ghost-ink p-[9px]"
        >
          <IconPencil strokeWidth={1.8} />
        </button>
        <button
          onClick={() => {
            if (confirm(`Strike "${character.name}" from your heroes?`))
              del.mutate(character.id);
          }}
          disabled={del.isPending}
          title="Remove"
          className="btn-base btn-ghost-red p-[9px]"
        >
          <IconTrash strokeWidth={1.8} />
        </button>
      </div>

      {editing && (
        <ParchmentModal onClose={() => setEditing(false)} maxWidth="max-w-[480px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            My Heroes
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
                  "The ledger rejected the entry — check the fields.")
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

/** The account-level roster: every hero you own, seated or resting. */
export default function MyHeroesPage() {
  const { data: heroes, isLoading } = useMyCharacters();
  const create = useCreateMyCharacter();
  const [forging, setForging] = useState(false);

  return (
    <div className="panel-hall px-[30px] pb-11 pt-8">
      <div
        className="mb-[26px] flex flex-wrap items-center justify-between gap-4 pb-3.5"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <div className="flex flex-wrap items-baseline gap-3.5">
          <h2
            className="font-display m-0 text-[clamp(24px,3vw,32px)] font-black text-[#e7d3a6]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
          >
            My Heroes
          </h2>
          {heroes && heroes.length > 0 && (
            <span className="label-stamp text-xs text-gold-muted">
              {heroes.length} in the ledger
            </span>
          )}
        </div>
        <button
          onClick={() => setForging(true)}
          className="btn-base btn-gold clip-octagon h-10 px-5 text-[13px]"
        >
          <IconPlus size={15} strokeWidth={2} />
          Forge a Hero
        </button>
      </div>

      {isLoading ? (
        <div className="font-accent px-5 py-[70px] text-center text-base italic text-[#9c855e]">
          Opening the ledger…
        </div>
      ) : heroes && heroes.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-6">
          {heroes.map((h) => (
            <HeroCard key={h.id} character={h} />
          ))}
        </div>
      ) : (
        <div className="px-5 py-[70px] text-center">
          <div className="mb-4 inline-flex text-[#7a5e34]">
            <IconUsers size={46} strokeWidth={1.4} />
          </div>
          <div className="font-display text-2xl text-[#cdb582]">
            No heroes yet
          </div>
          <div className="font-accent mt-2 text-base italic text-[#9c855e]">
            — forge your first, then seat them at a table. —
          </div>
        </div>
      )}

      {forging && (
        <ParchmentModal onClose={() => setForging(false)} maxWidth="max-w-[480px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            My Heroes
          </div>
          <h3 className="font-display m-0 mb-5 text-center text-2xl font-bold text-ink">
            Forge a Hero
          </h3>
          <CharacterForm
            initial={emptyHero}
            mode="create"
            isPending={create.isPending}
            errorText={
              create.isError
                ? ((create.error as { error?: string } | null)?.error ??
                  "The forge rejected it — check the fields.")
                : undefined
            }
            onCancel={() => setForging(false)}
            onSubmit={(body) =>
              create.mutate(body, { onSuccess: () => setForging(false) })
            }
          />
        </ParchmentModal>
      )}
    </div>
  );
}
