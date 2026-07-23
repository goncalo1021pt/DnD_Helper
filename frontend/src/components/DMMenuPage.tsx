import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { Ban, Campaign, Member } from "../api/client";
import {
  useBanMember,
  useBans,
  useCharacters,
  useDeclareMilestone,
  useGrantXP,
  useKickMember,
  useMembers,
  useRevokeMilestone,
  useSetMaxLevel,
  useSetProgression,
  useUnbanMember,
} from "../hooks";
import { formatWhen } from "../lib/dates";
import { initials, medallionFor } from "../lib/party";
import type { CampaignContext } from "./CampaignView";
import ParchmentModal from "./ui/ParchmentModal";
import RoleBadge from "./ui/RoleBadge";

/* Small round face for a member: their avatar, or inked initials on a medallion. */
function Face({ name, image, id }: { name: string; image?: string | null; id: string }) {
  if (image) {
    return (
      <img
        src={image}
        alt=""
        className="h-10 w-10 flex-none rounded-full object-cover"
        style={{ border: "1px solid rgba(201,162,39,.4)" }}
      />
    );
  }
  return (
    <div
      className="font-heading flex h-10 w-10 flex-none items-center justify-center rounded-full text-sm font-bold text-cream"
      style={{ background: medallionFor(id), border: "1px solid rgba(201,162,39,.4)" }}
    >
      {initials(name)}
    </div>
  );
}

type Pending =
  | { act: "kick"; member: Member }
  | { act: "ban"; member: Member };

/*
 * Table Rules: how heroes advance here. Progression mode, the level
 * ceiling, and the DM's XP/milestone grants — moved out of the
 * Chronicle block, which grew into a chat surface.
 */
function TableRulesSection({ campaign }: { campaign: Campaign }) {
  const setProgression = useSetProgression(campaign.id);
  const setMaxLevel = useSetMaxLevel(campaign.id);
  const milestone = useDeclareMilestone(campaign.id);
  const revoke = useRevokeMilestone(campaign.id);
  const grantXP = useGrantXP(campaign.id);
  const { data: characters } = useCharacters(campaign.id);
  const [granting, setGranting] = useState(false);
  const [confirmingMilestone, setConfirmingMilestone] = useState(false);
  const [xpAmount, setXpAmount] = useState("");
  const [xpReason, setXpReason] = useState("");
  const [xpTargets, setXpTargets] = useState<string[]>([]);
  const progression = campaign.progression ?? "milestone";

  return (
    <section className="panel-hall px-6 pb-6 pt-5">
      <div
        className="mb-4 flex flex-wrap items-baseline justify-between gap-3 pb-3"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <h2
          className="font-display m-0 text-[21px] font-black text-[#e7d3a6]"
          style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
        >
          Table Rules
        </h2>
        <span className="label-stamp text-[11px] text-gold-muted">
          how heroes advance here
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-5">
        <label className="flex flex-col gap-1.5">
          <span className="label-stamp text-[10px] tracking-[1.5px] text-gold-muted">
            Advancement
          </span>
          <select
            value={progression}
            onChange={(e) => setProgression.mutate(e.target.value as "milestone" | "xp")}
            className="input-hall h-9 w-40 text-[12px]"
          >
            <option value="milestone">Milestone</option>
            <option value="xp">XP</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="label-stamp text-[10px] tracking-[1.5px] text-gold-muted">
            Level ceiling
          </span>
          <select
            value={campaign.maxLevel ?? ""}
            onChange={(e) =>
              setMaxLevel.mutate(e.target.value === "" ? null : Number(e.target.value))
            }
            disabled={setMaxLevel.isPending}
            className="input-hall h-9 w-40 text-[12px]"
          >
            <option value="">Standard (20)</option>
            {Array.from({ length: 19 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                Level {n}
              </option>
            ))}
          </select>
        </label>

        {progression === "milestone" ? (
          <button
            onClick={() => setConfirmingMilestone(true)}
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
      </div>

      <div className="font-accent mt-3 text-[13px] italic text-cream-muted">
        {progression === "milestone"
          ? "Heroes rise only when you declare a milestone; heroes at the ceiling are passed over."
          : "XP is advisory — heroes level when their total says so, never past the ceiling."}
      </div>

      {/* the party's rise — who stands where, and who waits on the DM */}
      {(characters ?? []).length > 0 && (
        <div className="mt-4 pt-3" style={{ borderTop: "1px solid rgba(201,162,39,.18)" }}>
          <div className="label-stamp mb-2 text-[10px] tracking-[1.5px] text-gold-muted">
            The party's rise
          </div>
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {(characters ?? []).map((c) => {
              const atCeiling = campaign.maxLevel != null && c.level >= campaign.maxLevel;
              const pending = c.pendingLevels ?? 0;
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3">
                  <span className="font-heading min-w-0 max-w-[220px] flex-1 truncate text-[13.5px] font-bold text-cream">
                    {c.name}
                  </span>
                  <span className="label-stamp text-[10px] tracking-[1px] text-cream-soft">
                    Lv {c.level}
                  </span>
                  {atCeiling ? (
                    <span className="label-stamp text-[9px] tracking-[1px] text-[#c98a6a]">
                      at the ceiling
                    </span>
                  ) : pending > 0 ? (
                    <span className="label-stamp text-[9px] tracking-[1px]" style={{ color: "#ecc673" }}>
                      ▲ {pending} level-up{pending > 1 ? "s" : ""} waiting
                    </span>
                  ) : (
                    <span className="label-stamp text-[9px] tracking-[1px] text-cream-muted">
                      {progression === "milestone"
                        ? "no milestone banked"
                        : `${(c.xp ?? 0).toLocaleString()} XP`}
                    </span>
                  )}
                  {progression === "milestone" && (
                    <span className="ml-auto flex flex-none items-center gap-1.5">
                      <button
                        onClick={() => revoke.mutate([c.id])}
                        disabled={revoke.isPending || pending < 1}
                        title="Take back one unspent level-up"
                        className="label-stamp cursor-pointer rounded-[2px] px-2 py-1 text-[11px] text-cream-soft transition hover:brightness-125 disabled:cursor-default disabled:opacity-35"
                        style={{ background: "rgba(139,37,32,.22)", border: "1px solid rgba(139,37,32,.5)" }}
                      >
                        −
                      </button>
                      <button
                        onClick={() => milestone.mutate({ characterIds: [c.id] })}
                        disabled={milestone.isPending || atCeiling}
                        title="Grant this hero one level-up"
                        className="label-stamp cursor-pointer rounded-[2px] px-2 py-1 text-[11px] text-cream-soft transition hover:brightness-125 disabled:cursor-default disabled:opacity-35"
                        style={{ background: "rgba(201,162,39,.16)", border: "1px solid rgba(201,162,39,.4)" }}
                      >
                        +
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {confirmingMilestone && (
        <ParchmentModal onClose={() => setConfirmingMilestone(false)}>
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            Table Rules
          </div>
          <h3 className="font-display m-0 mb-3 text-center text-2xl font-bold text-ink">
            Declare a Milestone?
          </h3>
          <p className="font-body mb-4 text-[13.5px] leading-relaxed text-ink-body">
            Every seated hero below the ceiling banks one level-up to spend on
            their sheet. Change your mind? Take unspent ones back with the − in
            The Party's Rise.
          </p>
          <div className="flex items-center justify-end gap-4">
            <button
              onClick={() => setConfirmingMilestone(false)}
              className="label-stamp cursor-pointer border-none bg-transparent px-2 text-[12px] text-ink-label transition hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={() =>
                milestone.mutate({}, { onSuccess: () => setConfirmingMilestone(false) })
              }
              disabled={milestone.isPending}
              className="btn-base btn-gold clip-octagon h-10 px-6 text-[12px] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {milestone.isPending ? "Declaring…" : "Declare it"}
            </button>
          </div>
        </ParchmentModal>
      )}

      {granting && (
        <ParchmentModal onClose={() => setGranting(false)} maxWidth="max-w-[440px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            Table Rules
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
    </section>
  );
}

/**
 * The DM Menu: the table's ledger of players. See who sits at the table,
 * show someone the door (kick), or bar them from returning (ban).
 */
export default function DMMenuPage() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const { data: members, isLoading } = useMembers(campaign.id);
  const { data: bans } = useBans(campaign.id, isDM);
  const kick = useKickMember(campaign.id);
  const ban = useBanMember(campaign.id);
  const unban = useUnbanMember(campaign.id);
  const [pending, setPending] = useState<Pending | null>(null);

  if (!isDM) {
    return (
      <p className="font-accent text-base italic text-[#9c855e]">
        The DM's menu is theirs alone — take your seat with the party.
      </p>
    );
  }

  function confirm() {
    if (!pending) return;
    const done = { onSuccess: () => setPending(null) };
    if (pending.act === "kick") kick.mutate(pending.member.userId, done);
    else ban.mutate(pending.member.userId, done);
  }

  const acting = kick.isPending || ban.isPending;
  const failed = (kick.isError && "The kick failed") || (ban.isError && "The ban failed");

  return (
    <div className="grid gap-7">
      <TableRulesSection campaign={campaign} />

      {/* the table — everyone seated */}
      <section className="panel-hall px-6 pb-6 pt-5">
        <div
          className="mb-4 flex flex-wrap items-baseline justify-between gap-3 pb-3"
          style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
        >
          <h2
            className="font-display m-0 text-[21px] font-black text-[#e7d3a6]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
          >
            The Table
          </h2>
          <span className="label-stamp text-[11px] text-gold-muted">
            {members ? `${members.length} seated` : ""}
          </span>
        </div>

        {isLoading ? (
          <p className="font-accent text-[15px] italic text-cream-muted">
            Counting the chairs…
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-2.5 p-0">
            {(members ?? []).map((m) => (
              <li
                key={m.userId}
                className="flex flex-wrap items-center gap-3.5 rounded-[3px] px-3 py-2.5"
                style={{ background: "rgba(0,0,0,.22)", border: "1px solid rgba(201,162,39,.16)" }}
              >
                <Face name={m.name} image={m.image} id={m.userId} />
                <div className="min-w-0 flex-1">
                  <div className="font-heading truncate text-[15px] font-bold text-cream">
                    {m.name}
                  </div>
                  <div className="label-stamp text-[10px] tracking-[1px] text-gold-muted">
                    At the table since {formatWhen(new Date(m.joinedAt))}
                  </div>
                </div>
                <RoleBadge role={m.role} />
                {m.role === "player" && (
                  <div className="flex flex-none items-center gap-2">
                    <button
                      onClick={() => setPending({ act: "kick", member: m })}
                      title="Remove them from the table — they may return with the invite code"
                      className="label-stamp cursor-pointer rounded-[2px] px-2.5 py-1.5 text-[10px] tracking-[1px] text-cream-soft transition hover:brightness-125"
                      style={{ background: "rgba(201,162,39,.14)", border: "1px solid rgba(201,162,39,.35)" }}
                    >
                      Kick
                    </button>
                    <button
                      onClick={() => setPending({ act: "ban", member: m })}
                      title="Remove them and bar the door — the invite code stops working for them"
                      className="label-stamp cursor-pointer rounded-[2px] px-2.5 py-1.5 text-[10px] tracking-[1px] text-[#e8c4b8] transition hover:brightness-125"
                      style={{ background: "rgba(139,37,32,.28)", border: "1px solid rgba(139,37,32,.6)" }}
                    >
                      Ban
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* the banished — barred from rejoining */}
      <section className="panel-hall px-6 pb-6 pt-5">
        <div
          className="mb-4 flex flex-wrap items-baseline justify-between gap-3 pb-3"
          style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
        >
          <h2
            className="font-display m-0 text-[21px] font-black text-[#e7d3a6]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
          >
            The Banished
          </h2>
          <span className="label-stamp text-[11px] text-gold-muted">
            barred from the invite code
          </span>
        </div>

        {(bans ?? []).length === 0 ? (
          <p className="font-accent text-[15px] italic text-cream-muted">
            No names on the blacklist — the door stands open.
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-2.5 p-0">
            {(bans as Ban[]).map((b) => (
              <li
                key={b.userId}
                className="flex flex-wrap items-center gap-3.5 rounded-[3px] px-3 py-2.5"
                style={{ background: "rgba(0,0,0,.22)", border: "1px solid rgba(139,37,32,.35)" }}
              >
                <Face name={b.name} image={b.image} id={b.userId} />
                <div className="min-w-0 flex-1">
                  <div className="font-heading truncate text-[15px] font-bold text-cream">
                    {b.name}
                  </div>
                  <div className="label-stamp text-[10px] tracking-[1px] text-gold-muted">
                    Banished {formatWhen(new Date(b.bannedAt))}
                  </div>
                </div>
                <button
                  onClick={() => unban.mutate(b.userId)}
                  disabled={unban.isPending}
                  className="label-stamp cursor-pointer rounded-[2px] px-2.5 py-1.5 text-[10px] tracking-[1px] text-cream-soft transition hover:brightness-125 disabled:opacity-55"
                  style={{ background: "rgba(143,177,95,.14)", border: "1px solid rgba(143,177,95,.4)" }}
                >
                  Lift ban
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pending && (
        <ParchmentModal onClose={() => setPending(null)}>
          <h3 className="font-display mb-2 mt-0 text-[20px] font-black text-ink">
            {pending.act === "kick"
              ? `Show ${pending.member.name} the door?`
              : `Banish ${pending.member.name}?`}
          </h3>
          <p className="font-body mb-4 text-[13.5px] leading-relaxed text-ink-body">
            {pending.act === "kick" ? (
              <>
                They leave the table: their heroes return to their My Heroes
                shelf, and their claims on open quests are released. They may
                rejoin with the invite code.
              </>
            ) : (
              <>
                They leave the table the same way a kick works — heroes
                unseated, open claims released — and the invite code stops
                admitting them until you lift the ban.
              </>
            )}
          </p>
          {failed && (
            <p className="font-body mb-3 text-sm italic text-[#8b2520]">
              {failed} — the table stands as it was.
            </p>
          )}
          <div className="flex items-center justify-end gap-4">
            <button
              onClick={() => setPending(null)}
              className="label-stamp cursor-pointer border-none bg-transparent px-2 text-[12px] text-ink-label transition hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={confirm}
              disabled={acting}
              className="btn-base clip-octagon h-10 px-6 text-[12px] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "#8b2520", color: "#f3e6c8" }}
            >
              {pending.act === "kick" ? "Kick them" : "Ban them"}
            </button>
          </div>
        </ParchmentModal>
      )}
    </div>
  );
}
