import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { Ban, Member } from "../api/client";
import {
  useBanMember,
  useBans,
  useKickMember,
  useMembers,
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
