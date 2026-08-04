import { useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import {
  useCharacters,
  useLeaveCampaign,
  useMyCharacters,
  useMySeatRequests,
  useSeatCharacter,
} from "../hooks";
import type { CampaignContext } from "./CampaignView";
import ParchmentModal from "./ui/ParchmentModal";

/**
 * The Player Menu (#171): the player's counterpart of the DM Menu. Your
 * seat at this table — the heroes you have here, the ones still waiting at
 * the door — and the way out.
 */
export default function PlayerMenuPage() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const navigate = useNavigate();
  const { data: characters } = useCharacters(campaign.id);
  const { data: myHeroes } = useMyCharacters();
  const { data: waiting } = useMySeatRequests();
  const seat = useSeatCharacter();
  const leave = useLeaveCampaign(campaign.id);
  const [confirming, setConfirming] = useState(false);

  if (role === "dm") {
    return (
      <p className="font-accent text-base italic text-[#9c855e]">
        The DM sits behind the screen, not at a player's seat — your tools
        live in the DM Menu.
      </p>
    );
  }

  const mine = (characters ?? []).filter((c) => c.mine && !c.tableBorn);
  const atTheDoor = (waiting ?? []).filter((w) => w.campaignId === campaign.id);
  const heroName = (id: string) =>
    (myHeroes ?? []).find((h) => h.id === id)?.name ?? "A hero of yours";

  return (
    <div className="grid gap-7">
      {/* your seat — the heroes you have at this table */}
      <section className="panel-hall px-6 pb-6 pt-5">
        <div
          className="mb-4 flex flex-wrap items-baseline justify-between gap-3 pb-3"
          style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
        >
          <h2
            className="font-display m-0 text-[21px] font-black text-[#e7d3a6]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
          >
            Your Seat
          </h2>
          <span className="label-stamp text-[11px] text-gold-muted">
            the heroes you have at this table
          </span>
        </div>

        {mine.length === 0 && atTheDoor.length === 0 ? (
          <div className="font-accent py-1 text-[14px] italic text-cream-muted">
            None of your heroes sit here yet — seat one from the Party page,
            or forge one on your{" "}
            <Link to="/questboard/profile" className="text-ember-bright no-underline hover:text-cream">
              My Heroes shelf
            </Link>
            .
          </div>
        ) : (
          <ul className="m-0 grid list-none gap-2.5 p-0">
            {mine.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3">
                <Link
                  to={`/questboard/heroes/${c.id}`}
                  className="font-heading min-w-0 max-w-[260px] flex-1 truncate text-[14px] font-bold text-cream no-underline transition hover:text-ember-bright"
                >
                  {c.name}
                </Link>
                <span className="label-stamp text-[10px] tracking-[1px] text-cream-soft">
                  Lv {c.level} · {c.class || "Adventurer"}
                </span>
                <span className="ml-auto flex flex-none items-center gap-2">
                  <Link
                    to={`/questboard/heroes/${c.id}`}
                    className="btn-base btn-ghost-ink px-3 py-[7px] text-[10px] no-underline"
                  >
                    Open the sheet
                  </Link>
                  <button
                    onClick={() => seat.mutate({ characterId: c.id, campaignId: null })}
                    disabled={seat.isPending}
                    title="Unseat — the hero returns to your My Heroes shelf"
                    className="btn-base btn-ghost-ink px-3 py-[7px] text-[10px]"
                  >
                    Unseat
                  </button>
                </span>
              </li>
            ))}
            {atTheDoor.map((w) => (
              <li key={w.characterId} className="flex flex-wrap items-center gap-3">
                <span className="font-heading min-w-0 max-w-[260px] flex-1 truncate text-[14px] font-bold text-cream-muted">
                  {heroName(w.characterId)}
                </span>
                <span className="label-stamp text-[10px] tracking-[1px] text-gold-muted">
                  ⧗ waiting at the door
                </span>
                <span className="ml-auto flex flex-none items-center gap-2">
                  <button
                    onClick={() => seat.mutate({ characterId: w.characterId, campaignId: null })}
                    disabled={seat.isPending}
                    title="Withdraw the request — the hero stays on your shelf"
                    className="btn-base btn-ghost-ink px-3 py-[7px] text-[10px]"
                  >
                    Withdraw
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* leave the table */}
      <section
        className="panel-hall px-6 pb-6 pt-5"
        style={{ border: "1px solid rgba(139,37,32,.4)" }}
      >
        <div
          className="mb-4 flex flex-wrap items-baseline justify-between gap-3 pb-3"
          style={{ borderBottom: "1px solid rgba(139,37,32,.3)" }}
        >
          <h2
            className="font-display m-0 text-[21px] font-black text-[#e8a493]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
          >
            Leave the Table
          </h2>
        </div>

        <p className="font-body mb-4 text-[13.5px] leading-relaxed text-cream-muted">
          Walk away from this campaign. Your heroes return to your My Heroes
          shelf, your claims on open quests are released, and the places you
          were let in on forget you. The invite code admits you back, unless
          the DM bars it.
        </p>

        <button
          onClick={() => setConfirming(true)}
          className="label-stamp cursor-pointer rounded-[2px] px-3 py-2 text-[11px] tracking-[1px] text-[#e8c4b8] transition hover:brightness-125"
          style={{ background: "rgba(139,37,32,.28)", border: "1px solid rgba(139,37,32,.6)" }}
        >
          Leave this campaign
        </button>

        {confirming && (
          <ParchmentModal onClose={() => setConfirming(false)}>
            <h3 className="font-display mb-2 mt-0 text-[20px] font-black text-ink">
              Leave {campaign.name}?
            </h3>
            <p className="font-body mb-4 text-[13.5px] leading-relaxed text-ink-body">
              Your heroes return to My Heroes and your quest claims are
              released. Nothing of yours is destroyed — but rejoining takes
              the invite code, and reseating a hero goes through the usual
              door.
            </p>
            {leave.isError && (
              <p className="font-body mb-3 text-sm italic text-[#8b2520]">
                The leaving failed — you are still at the table.
              </p>
            )}
            <div className="flex items-center justify-end gap-4">
              <button
                onClick={() => setConfirming(false)}
                className="label-stamp cursor-pointer border-none bg-transparent px-2 text-[12px] text-ink-label transition hover:text-ink"
              >
                Stay seated
              </button>
              <button
                onClick={() =>
                  leave.mutate(undefined, { onSuccess: () => navigate("/questboard") })
                }
                disabled={leave.isPending}
                className="btn-base clip-octagon h-10 px-6 text-[12px] disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: "#8b2520", color: "#f3e6c8" }}
              >
                {leave.isPending ? "Leaving…" : "Leave the table"}
              </button>
            </div>
          </ParchmentModal>
        )}
      </section>
    </div>
  );
}
