import type { ReactNode } from "react";
import { Link, useOutletContext } from "react-router-dom";
import type { Character, Role } from "../api/client";
import {
  useCharacters,
  useCodex,
  useEvents,
  useLocations,
  useNpcs,
  useQuests,
  useUpdateCharacter,
} from "../hooks";
import { EventLine } from "./ChroniclePage";
import { hpColor, initials, medallionFor } from "../lib/party";
import { hallBlocks, screenRows, type Section } from "../lib/sections";
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

/* The face each screen row wears; anything unlisted falls back to the folk. */
const SCREEN_ICONS: Record<string, ReactNode> = {
  den: <IconDragon strokeWidth={1.8} />,
  dm: <IconUsers strokeWidth={1.8} />,
  player: <IconUsers strokeWidth={1.8} />,
};

/*
 * The DM's Screen — and, for a player, its mirror: the door to their own seat
 * at this table. Both are the same panel with different rows, and the rows
 * come from `lib/sections`, so a new role-only tool lands here by declaring
 * itself rather than by being remembered (#231).
 */
function ScreenPanel({ role }: { role: Role }) {
  const rows = screenRows(role);
  const isDM = role === "dm";
  return (
    <section className="panel-hall px-3 pb-3 pt-4">
      <div className="label-stamp mb-2 flex items-baseline justify-between px-3 text-[11px]">
        <span className="font-semibold tracking-[2px] text-gold-muted">
          {isDM ? "The DM's Screen" : "Your Pack"}
        </span>
        <span className="text-[10px] text-ink-label">
          {isDM ? "yours alone" : "yours to carry"}
        </span>
      </div>
      {rows.map((s) => (
        <ScreenRow
          key={s.key}
          to={s.to}
          icon={SCREEN_ICONS[s.key] ?? <IconUsers strokeWidth={1.8} />}
          title={s.hall.kind === "screen" ? s.hall.title : s.label}
          sub={s.hall.kind === "screen" ? s.hall.sub : ""}
        />
      ))}
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

/*
 * One block on the Hall. Most are a header over a single whispered line, and
 * those draw themselves from the section's own copy; the three with something
 * live to show (the board, the party, the chronicle) hand their body in.
 */
function HallBlock({
  section,
  role,
  meta,
  children,
}: {
  section: Section;
  role: Role;
  meta?: string;
  children?: ReactNode;
}) {
  if (section.hall.kind !== "block") return null;
  const { title, linkLabel, body } = section.hall;
  const tall = body === "custom";
  return (
    <section className={`panel-hall px-6 pt-5 ${tall ? "pb-7" : "pb-6"}`}>
      <BlockHeader
        title={title}
        meta={meta}
        to={section.to}
        linkLabel={linkLabel[role]}
      />
      {body === "custom" ? (
        children
      ) : (
        <div className="font-accent py-1 text-[14px] italic text-cream-muted">
          {body[role]}
        </div>
      )}
    </section>
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

  // Behind the table's veil there is nothing to show but the name.
  if (character.concealed) {
    return (
      <div className="chip-hall w-full gap-3 px-3 py-2.5">
        <div
          className="font-heading flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[3px] text-[15px] font-bold text-[#f3e6c8]"
          style={{
            background: "linear-gradient(160deg,#4a3a2a,#241a12)",
            boxShadow: "inset 0 0 0 1.5px rgba(201,162,39,.35)",
          }}
          title="Veiled"
        >
          ?
        </div>
        <div className="min-w-0 flex-1">
          <span className="font-heading block truncate text-[13px] font-semibold text-cream">
            {character.name}
          </span>
          <span className="label-stamp text-[9px] tracking-[1.5px] text-gold-muted">
            veiled — played by {character.ownerName}
          </span>
        </div>
      </div>
    );
  }

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
          {/* #178: the party row is a door to the sheet, not just a name */}
          <Link
            to={`/questboard/heroes/${character.id}`}
            className="font-heading truncate text-[13px] font-semibold text-cream no-underline transition hover:text-ember-bright"
          >
            {character.name}
          </Link>
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
  const progression = campaign.progression ?? "milestone";
  const codexAdmitted = (codex ?? []).filter((e) => e.status === "enabled").length;
  const codexWaiting = (codex ?? []).filter((e) => e.status === "proposed").length;
  const isDM = role === "dm";
  const { data: quests } = useQuests(campaign.id);
  const { data: characters } = useCharacters(campaign.id);
  const { data: locations } = useLocations(campaign.id);
  const { data: npcs } = useNpcs(campaign.id);
  const placeCount = locations?.length ?? 0;
  const folkCount = npcs?.length ?? 0;

  const availableCount = quests?.filter((q) => q.status === "available").length ?? 0;
  const activeCount = quests?.filter((q) => q.status === "active").length ?? 0;
  const newest = (quests ?? []).filter((q) => q.status === "available").slice(0, 2);

  /* The stamp beside each block's title — a count where there is one to make,
     a standing subtitle where there is not. Absent is fine; the header simply
     goes without. */
  const metas: Record<string, string | undefined> = {
    board: `${availableCount} open · ${activeCount} afoot`,
    party:
      characters && characters.length > 0
        ? `${characters.length} adventurer${characters.length === 1 ? "" : "s"}`
        : undefined,
    world:
      placeCount > 0 ? `${placeCount} charted` : isDM ? "nothing charted yet" : undefined,
    map: "the world so far",
    npcs:
      folkCount > 0
        ? `${folkCount} ${isDM ? "filed" : "known"}`
        : isDM
          ? "nobody yet"
          : undefined,
    vendors: isDM ? "who trades where" : "what is for sale",
    trees: "story-woven powers",
    encounters: isDM ? "prepare & run combat" : "the initiative order",
    bestiary: "the party's field journal",
    codex:
      codexWaiting > 0
        ? `${codexAdmitted} admitted · ${codexWaiting} waiting at the door`
        : `${codexAdmitted} homebrew admitted`,
    chronicle: progression === "xp" ? "advancing by XP" : "advancing by milestone",
  };

  /* The three blocks with something live to show. Everything else is its own
     whisper, written once in `lib/sections`. */
  const bodies: Record<string, ReactNode> = {
    board:
      newest.length > 0 ? (
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
      ),
    party:
      characters && characters.length > 0 ? (
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
      ),
    chronicle:
      (events ?? []).length > 0 ? (
        <div className="flex flex-col gap-3">
          {(events ?? []).map((e) => (
            <EventLine key={e.id} event={e} />
          ))}
        </div>
      ) : (
        <div className="font-accent py-1 text-[14px] italic text-cream-muted">
          Nothing chronicled yet — deeds will write themselves here.
        </div>
      ),
  };

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.9fr)_minmax(300px,1fr)]">
      {/* left column — the rooms, in the order `lib/sections` writes them */}
      <div className="flex flex-col gap-6">
        {hallBlocks(role, "left").map((s) => (
          <HallBlock key={s.key} section={s} role={role} meta={metas[s.key]}>
            {bodies[s.key]}
          </HallBlock>
        ))}
      </div>

      {/* right rail */}
      <div className="flex flex-col gap-6">
        <NextGatheringCard campaign={campaign} isDM={isDM} />

        {hallBlocks(role, "right").map((s) => (
          <HallBlock key={s.key} section={s} role={role} meta={metas[s.key]}>
            {bodies[s.key]}
          </HallBlock>
        ))}

        <DiceTowerPanel campaignId={campaign.id} />

        <ScreenPanel role={role} />
      </div>
    </div>
  );
}
