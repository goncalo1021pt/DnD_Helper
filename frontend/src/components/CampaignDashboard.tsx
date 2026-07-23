import { useState, type ReactNode } from "react";
import { Link, useOutletContext } from "react-router-dom";
import type { Character } from "../api/client";
import {
  useCharacters,
  useCodex,
  useDeclareMilestone,
  useEvents,
  useGrantXP,
  useQuests,
  useSetProgression,
  useUpdateCharacter,
} from "../hooks";
import { EventLine } from "./ChroniclePage";
import ParchmentModal from "./ui/ParchmentModal";
import { hpColor, initials, medallionFor } from "../lib/party";
import type { CampaignContext } from "./CampaignView";
import { DiceTowerPanel } from "./ui/DiceTray";
import NextGatheringCard from "./ui/NextGatheringCard";
import { IconDragon, IconUsers } from "./ui/icons";

/* One row of the DM's Screen: icon chip, title over a whisper, chevron. */
function ScreenRow({
  to,
  icon,
  title,
  sub,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3.5 rounded-[3px] px-3 py-2.5 no-underline transition hover:bg-[rgba(201,162,39,.08)]"
    >
      <span
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[8px] text-ember-bright"
        style={{ background: "rgba(201,162,39,.12)", border: "1px solid rgba(201,162,39,.22)" }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-heading block text-[14px] font-bold text-cream">
          {title}
        </span>
        <span className="font-accent block truncate text-[12.5px] italic text-cream-muted">
          {sub}
        </span>
      </span>
      <span className="text-gold-muted">›</span>
    </Link>
  );
}

/*
 * The DM's Screen: the compact menu of DM-only tools, tucked in the right
 * rail. New DM tools become rows here, not new dashboard blocks.
 */
function DMScreenPanel() {
  return (
    <section className="panel-hall px-3 pb-3 pt-4">
      <div className="label-stamp mb-2 flex items-baseline justify-between px-3 text-[11px]">
        <span className="font-semibold tracking-[2px] text-gold-muted">
          The DM's Screen
        </span>
        <span className="text-[10px] text-ink-label">yours alone</span>
      </div>
      <ScreenRow
        to="dm"
        icon={<IconUsers strokeWidth={1.8} />}
        title="DM Menu"
        sub="Who sits at your table — kick or ban"
      />
      <ScreenRow
        to="den"
        icon={<IconDragon strokeWidth={1.8} />}
        title="The Monster Den"
        sub="Your private menagerie, statted and searchable"
      />
    </section>
  );
}

/* Small stable tilt for the mini notices, from the quest id. */
function slipRotation(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 1000;
  return `${(((h % 21) / 20) * 2 - 1).toFixed(2)}deg`;
}

function BlockHeader({
  title,
  meta,
  to,
  linkLabel,
}: {
  title: string;
  meta?: string;
  to: string;
  linkLabel: string;
}) {
  return (
    <div
      className="mb-4 flex flex-wrap items-baseline justify-between gap-3 pb-3"
      style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <h2
          className="font-display m-0 text-[21px] font-black text-[#e7d3a6]"
          style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
        >
          {title}
        </h2>
        {meta && <span className="label-stamp text-[11px] text-gold-muted">{meta}</span>}
      </div>
      <Link
        to={to}
        className="label-stamp text-[11px] font-semibold text-ember-bright no-underline transition hover:text-cream"
      >
        {linkLabel} →
      </Link>
    </div>
  );
}

/* Compact roster row: medallion, name, HP bar, quick ±HP for editors. */
function PartyRow({
  character,
  canEdit,
  campaignId,
}: {
  character: Character;
  canEdit: boolean;
  campaignId: string;
}) {
  const update = useUpdateCharacter(campaignId);
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
    <div className="chip-hall w-full gap-3 px-3 py-2.5">
      <div
        className="font-heading relative flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[3px] text-[12px] font-bold text-[#f3e6c8]"
        style={{
          background: medallionFor(character.id),
          boxShadow: "inset 0 0 0 1.5px rgba(201,162,39,.5)",
        }}
      >
        {initials(character.name) || "?"}
        <span
          className="font-heading absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[8.5px] font-bold text-ember-bright"
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
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-heading truncate text-[13px] font-semibold text-cream">
            {character.name}
          </span>
          <span
            className="text-[12px] font-semibold tabular-nums"
            style={{ color: color === "#8b2520" ? "#d68a72" : color === "#b07a2e" ? "#d8a44e" : "#8fb15f" }}
          >
            {character.hpCurrent}/{character.hpMax}
          </span>
        </div>
        <div
          className="mt-1.5 h-[5px] w-full rounded-[2px]"
          style={{ background: "rgba(0,0,0,.45)" }}
        >
          <div
            className="h-full rounded-[2px] transition-all"
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
      </div>

      {canEdit && (
        <div className="flex flex-none gap-1">
          <button
            onClick={() => adjustHp(-1)}
            disabled={update.isPending || character.hpCurrent <= 0}
            title="Take 1 damage"
            className="btn-base h-7 w-7 rounded-[2px] text-[13px] text-[#d68a72]"
            style={{ boxShadow: "inset 0 0 0 1px rgba(139,37,32,.5)" }}
          >
            −
          </button>
          <button
            onClick={() => adjustHp(1)}
            disabled={update.isPending || character.hpCurrent >= character.hpMax}
            title="Heal 1"
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

/**
 * The campaign hall: one page showing the state of the campaign at a glance,
 * with the heavy tools (board, party ledger) linking out to solo pages.
 */
export default function CampaignDashboard() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const { data: codex } = useCodex(campaign.id);
  const { data: events } = useEvents(campaign.id, "all", 5);
  const milestone = useDeclareMilestone(campaign.id);
  const setProgression = useSetProgression(campaign.id);
  const grantXP = useGrantXP(campaign.id);
  const [granting, setGranting] = useState(false);
  const [xpAmount, setXpAmount] = useState("");
  const [xpReason, setXpReason] = useState("");
  const [xpTargets, setXpTargets] = useState<string[]>([]);
  const progression = campaign.progression ?? "milestone";
  const codexAdmitted = (codex ?? []).filter((e) => e.status === "enabled").length;
  const codexWaiting = (codex ?? []).filter((e) => e.status === "proposed").length;
  const isDM = role === "dm";
  const { data: quests } = useQuests(campaign.id);
  const { data: characters } = useCharacters(campaign.id);

  const availableCount = quests?.filter((q) => q.status === "available").length ?? 0;
  const activeCount = quests?.filter((q) => q.status === "active").length ?? 0;
  const newest = (quests ?? []).filter((q) => q.status === "available").slice(0, 2);

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.9fr)_minmax(300px,1fr)]">
      {/* left column */}
      <div className="flex flex-col gap-6">
        {/* quest board block */}
        <section className="panel-hall px-6 pb-7 pt-5">
          <BlockHeader
            title="The Quest Board"
            meta={`${availableCount} open · ${activeCount} afoot`}
            to="board"
            linkLabel="Open the board"
          />
          {newest.length > 0 ? (
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 pt-1 sm:grid-cols-2">
              {newest.map((q) => (
                <Link
                  key={q.id}
                  to="board"
                  className="parchment block px-4 pb-3.5 pt-3 no-underline transition hover:-translate-y-0.5"
                  style={{ transform: `rotate(${slipRotation(q.id)})` }}
                >
                  <div className="font-display truncate text-[15px] font-bold text-ink">
                    {q.title}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px]">
                    <span className="label-stamp tracking-[1px] text-ink-label">
                      {q.difficulty}
                    </span>
                    {q.giver && (
                      <span className="font-accent truncate italic text-ink-body">
                        — {q.giver}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="font-accent py-3 text-[15px] italic text-cream-muted">
              {quests && quests.length > 0
                ? "Nothing open — every notice is spoken for."
                : "The board awaits its first notice."}
            </div>
          )}
        </section>

        {/* party block */}
        <section className="panel-hall px-6 pb-7 pt-5">
          <BlockHeader
            title="The Party"
            meta={
              characters && characters.length > 0
                ? `${characters.length} adventurer${characters.length === 1 ? "" : "s"}`
                : undefined
            }
            to="party"
            linkLabel="Manage the party"
          />
          {characters && characters.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {characters.map((c) => (
                <PartyRow
                  key={c.id}
                  character={c}
                  canEdit={c.mine || isDM}
                  campaignId={campaign.id}
                />
              ))}
            </div>
          ) : (
            <div className="font-accent py-3 text-[15px] italic text-cream-muted">
              No adventurers yet — take a seat in the party ledger.
            </div>
          )}
        </section>

        {/* bestiary — the party's field journal, open to all at the table */}
        <section className="panel-hall px-6 pb-6 pt-5">
          <BlockHeader
            title="The Bestiary"
            meta="the party's field journal"
            to="bestiary"
            linkLabel="Open the bestiary"
          />
          <div className="font-accent py-1 text-[14px] italic text-cream-muted">
            {isDM
              ? "What your heroes have met — identify each creature and reveal its record, piece by piece."
              : "Log the creatures you face, share notes, and collect the stat blocks the DM hands you."}
          </div>
        </section>

        {/* encounters — the DM's combat tool, shared tracker at the table */}
        <section className="panel-hall px-6 pb-6 pt-5">
          <BlockHeader
            title="Encounters"
            meta={isDM ? "prepare & run combat" : "the initiative order"}
            to="encounters"
            linkLabel={isDM ? "Open encounters" : "See the battle"}
          />
          <div className="font-accent py-1 text-[14px] italic text-cream-muted">
            {isDM
              ? "Prepare battles from the Den and your party, then trigger them and run initiative in-app."
              : "When the DM triggers a fight, the initiative order and whose turn it is show up here."}
          </div>
        </section>

        {/* the map — the campaign atlas, open to all at the table */}
        <section className="panel-hall px-6 pb-6 pt-5">
          <BlockHeader
            title="The Map"
            meta="the world so far"
            to="map"
            linkLabel="Unroll the map"
          />
          <div className="font-accent py-1 text-[14px] italic text-cream-muted">
            {isDM
              ? "Hang your world, pin what matters, and lead the party from region to region."
              : "The lands your party travels — follow the pins the DM has placed."}
          </div>
        </section>

        {/* codex block */}
        <section className="panel-hall px-6 pb-6 pt-5">
          <BlockHeader
            title="The Codex"
            meta={
              codexWaiting > 0
                ? `${codexAdmitted} admitted · ${codexWaiting} waiting at the door`
                : `${codexAdmitted} homebrew admitted`
            }
            to="codex"
            linkLabel="Open the codex"
          />
          <div className="font-accent py-1 text-[14px] italic text-cream-muted">
            {isDM
              ? "Rule on what exists in this world — ban SRD entries, admit homebrew."
              : "What the DM has ruled legal at this table."}
          </div>
        </section>
      </div>

      {/* right rail */}
      <div className="flex flex-col gap-6">
        <NextGatheringCard campaign={campaign} isDM={isDM} />

        {/* chronicle block */}
        <section className="panel-hall px-6 pb-6 pt-5">
          <BlockHeader
            title="The Chronicle"
            meta={progression === "xp" ? "advancing by XP" : "advancing by milestone"}
            to="chronicle"
            linkLabel="Open the chronicle"
          />
          {isDM && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {progression === "milestone" ? (
                <button
                  onClick={() => milestone.mutate(undefined)}
                  disabled={milestone.isPending}
                  className="btn-base btn-gold clip-octagon h-9 px-4 text-[11px]"
                >
                  Milestone reached
                </button>
              ) : (
                <button
                  onClick={() => {
                    setXpTargets((characters ?? []).map((c) => c.id));
                    setGranting(true);
                  }}
                  className="btn-base btn-gold clip-octagon h-9 px-4 text-[11px]"
                >
                  Grant XP
                </button>
              )}
              <select
                value={progression}
                onChange={(e) => setProgression.mutate(e.target.value as "milestone" | "xp")}
                className="input-hall h-9 w-36 text-[12px]"
              >
                <option value="milestone">Milestone</option>
                <option value="xp">XP</option>
              </select>
            </div>
          )}
          {(events ?? []).length > 0 ? (
            <div className="flex flex-col gap-3">
              {(events ?? []).map((e) => (
                <EventLine key={e.id} event={e} />
              ))}
            </div>
          ) : (
            <div className="font-accent py-1 text-[14px] italic text-cream-muted">
              Nothing chronicled yet — deeds will write themselves here.
            </div>
          )}
        </section>

        <DiceTowerPanel />

        {isDM && <DMScreenPanel />}
      </div>

      {granting && (
        <ParchmentModal onClose={() => setGranting(false)} maxWidth="max-w-[440px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Chronicle
          </div>
          <h3 className="font-display m-0 mb-5 text-center text-2xl font-bold text-ink">
            Grant Experience
          </h3>
          <div className="flex flex-col gap-4 text-ink-strong">
            <label className="flex flex-col gap-1.5">
              <span className="field-label">XP (negative to dock)</span>
              <input
                type="number"
                className="input-parchment input-compact w-36"
                value={xpAmount}
                onChange={(e) => setXpAmount(e.target.value)}
                placeholder="250"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Reason (optional)</span>
              <input
                className="input-parchment input-compact"
                value={xpReason}
                maxLength={200}
                onChange={(e) => setXpReason(e.target.value)}
                placeholder="e.g. The wyrm of Emberpeak"
              />
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="field-label">To</span>
              <div className="flex flex-wrap gap-2">
                {(characters ?? []).map((c) => {
                  const on = xpTargets.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() =>
                        setXpTargets((prev) =>
                          on ? prev.filter((id) => id !== c.id) : [...prev, c.id],
                        )
                      }
                      className="label-stamp cursor-pointer rounded-[2px] border-none px-2.5 py-1.5 text-[10px] tracking-[1px]"
                      style={{
                        background: on ? "linear-gradient(180deg,#8b2520,#5e1611)" : "rgba(120,86,42,.13)",
                        color: on ? "#f3d9c0" : "#4a3620",
                        boxShadow: `inset 0 0 0 1px ${on ? "#3f0f0e" : "rgba(120,80,30,.45)"}`,
                      }}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setGranting(false)} className="btn-base btn-ghost-ink px-5 py-[11px] text-xs">
                Cancel
              </button>
              <button
                onClick={() =>
                  grantXP.mutate(
                    {
                      amount: Number(xpAmount),
                      characterIds: xpTargets,
                      reason: xpReason.trim() || undefined,
                    },
                    {
                      onSuccess: () => {
                        setGranting(false);
                        setXpAmount("");
                        setXpReason("");
                      },
                    },
                  )
                }
                disabled={!xpAmount || Number(xpAmount) === 0 || xpTargets.length === 0 || grantXP.isPending}
                className="btn-base btn-gold clip-octagon h-11 px-6 text-sm"
              >
                {grantXP.isPending ? "Granting…" : "Grant"}
              </button>
            </div>
          </div>
        </ParchmentModal>
      )}
    </div>
  );
}
