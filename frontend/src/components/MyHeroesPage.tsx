import { useState } from "react";
import { Link } from "react-router-dom";
import type { Character, SeatConflict } from "../api/client";
import {
  useCampaigns,
  useCreateMyCharacter,
  useDeleteCharacter,
  useMyCharacters,
  useProposeCodex,
  useSeatCharacter,
  useUpdateCharacter,
} from "../hooks";
import { hpColor, initials, medallionFor } from "../lib/party";
import { levelUpHold } from "../lib/progression";
import CharacterForm, { emptyHero } from "./CharacterForm";
import LevelUpModal from "./LevelUpModal";
import AbilityRow from "./ui/AbilityRow";
import FloatingDiceTray from "./ui/DiceTray";
import ParchmentModal from "./ui/ParchmentModal";
import { IconPencil, IconPlus, IconTrash, IconUsers } from "./ui/icons";

/** Strict seating hit a wall: show what the codex hasn't admitted and let
 * the hero's owner send the missing homebrew to the DM in one tap. */
function SeatConflictModal({
  heroName,
  conflict,
  onClose,
}: {
  heroName: string;
  conflict: { campaignId: string; campaignName: string; missing: SeatConflict["missing"] };
  onClose: () => void;
}) {
  const propose = useProposeCodex(conflict.campaignId);
  const proposable = conflict.missing.filter((m) => m.state === "absent");
  const [sent, setSent] = useState(false);

  const stateText = { absent: "not offered yet", proposed: "awaiting the DM", banned: "banned by the DM" };
  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[460px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
        Held at the door
      </div>
      <h3 className="font-display m-0 mb-2 text-center text-2xl font-bold text-ink">
        The Codex Objects
      </h3>
      <p className="font-body m-0 mb-4 text-center text-[13.5px] italic text-ink-body">
        {conflict.campaignName} has not admitted everything {heroName} is made of:
      </p>
      <div className="mb-5 flex flex-col gap-2">
        {conflict.missing.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-3 text-[13.5px]">
            <span>
              <span className="font-heading font-bold">{m.name}</span>
              <span className="label-stamp ml-2 text-[8.5px] tracking-[1px] text-ink-label">{m.kind}</span>
            </span>
            <span className={`label-stamp text-[9px] tracking-[1px] ${m.state === "banned" ? "text-[#8b2520]" : "text-ink-label"}`}>
              {stateText[m.state]}
            </span>
          </div>
        ))}
      </div>
      {sent ? (
        <p className="font-accent m-0 text-center text-[13.5px] italic text-ink-body">
          Sent — once the DM admits it, seat {heroName} again.
        </p>
      ) : (
        <div className="flex items-center justify-end gap-3">
          <button onClick={onClose} className="btn-base btn-ghost-ink px-5 py-[11px] text-xs">
            Close
          </button>
          {proposable.length > 0 && (
            <button
              onClick={() =>
                propose.mutate(
                  proposable.map((m) => m.id),
                  { onSuccess: () => setSent(true) },
                )
              }
              disabled={propose.isPending}
              className="btn-base btn-gold clip-octagon h-11 px-5 text-[13px]"
            >
              {propose.isPending ? "Sending…" : "Send to the DM"}
            </button>
          )}
        </div>
      )}
    </ParchmentModal>
  );
}

function HeroCard({ character }: { character: Character }) {
  const { data: campaigns } = useCampaigns();
  const seat = useSeatCharacter();
  const update = useUpdateCharacter(character.campaignId ?? "");
  const del = useDeleteCharacter(character.campaignId ?? "");
  const [editing, setEditing] = useState(false);
  const [levelling, setLevelling] = useState(false);
  const [seatChoice, setSeatChoice] = useState("");
  const [conflict, setConflict] = useState<{
    campaignId: string;
    campaignName: string;
    missing: SeatConflict["missing"];
  } | null>(null);

  const color = hpColor(character.hpCurrent, character.hpMax);
  const pct = character.hpMax > 0 ? (character.hpCurrent / character.hpMax) * 100 : 0;
  const seated = !!character.campaignId;
  const hold = levelUpHold(
    character,
    campaigns?.find((m) => m.campaign.id === character.campaignId)?.campaign,
  );

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
          <Link
            to={`/questboard/heroes/${character.id}`}
            className="font-display block truncate text-[17px] font-bold leading-tight text-ink no-underline hover:text-[#8b2520]"
          >
            {character.name}
          </Link>
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

      {/* sheet (wizard-forged heroes) */}
      {character.sheet && (
        <div className="mt-3.5">
          <AbilityRow abilities={character.sheet.abilities} />
          {character.sheet.skills.length > 0 && (
            <div className="label-stamp mt-2 text-[8.5px] leading-relaxed tracking-[1px] text-ink-label">
              {character.sheet.skills.join(" · ")}
            </div>
          )}
        </div>
      )}

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
                  {
                    onSuccess: () => setSeatChoice(""),
                    onError: (err) => {
                      const c = err as unknown as SeatConflict;
                      if (c?.missing?.length) {
                        setConflict({
                          campaignId: seatChoice,
                          campaignName:
                            (campaigns ?? []).find((m) => m.campaign.id === seatChoice)
                              ?.campaign.name ?? "the campaign",
                          missing: c.missing,
                        });
                      }
                    },
                  },
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
        {character.sheet && character.level < 20 && (
          hold ? (
            <span
              className="label-stamp mr-auto rounded-[2px] px-2 py-1.5 text-[8.5px] tracking-[1px]"
              style={{ color: "#7a5626", background: "rgba(120,86,42,.12)", boxShadow: "inset 0 0 0 1px rgba(120,80,30,.35)" }}
              title="The DM controls when the party rises"
            >
              ⧗ {hold}
            </span>
          ) : (
            <button
              onClick={() => setLevelling(true)}
              className="btn-base btn-wax mr-auto px-3.5 py-2 text-[10px]"
            >
              Level up ↑
            </button>
          )
        )}
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

      {conflict && (
        <SeatConflictModal
          heroName={character.name}
          conflict={conflict}
          onClose={() => setConflict(null)}
        />
      )}

      {levelling && (
        <LevelUpModal character={character} onClose={() => setLevelling(false)} />
      )}

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
    <div className="panel-hall px-5 sm:px-[30px] pb-11 pt-8">
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
        <div className="flex flex-wrap items-center gap-4">
          <button
            onClick={() => setForging(true)}
            className="label-stamp cursor-pointer border-none bg-transparent text-[11px] font-semibold text-gold-muted transition hover:text-ember-bright"
          >
            Quick add
          </button>
          <Link
            to="/questboard/heroes/forge"
            className="btn-base btn-gold clip-octagon h-10 px-5 text-[13px] no-underline"
          >
            <IconPlus size={15} strokeWidth={2} />
            Forge a Hero
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="font-accent px-5 py-[70px] text-center text-base italic text-[#9c855e]">
          Opening the ledger…
        </div>
      ) : heroes && heroes.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(290px,100%),1fr))] gap-6">
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

      {/* Dice at hand for rolling HP when leveling up from here. */}
      <FloatingDiceTray />
    </div>
  );
}
