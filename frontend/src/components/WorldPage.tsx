import { useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import type { Location } from "../api/client";
import { useCharacters, useEncounters, useLocations } from "../hooks";
import type { CampaignContext } from "./CampaignView";
import PlacesManager, { indentOf, PlaceLinks } from "./PlacesManager";
import { IconMapPin } from "./ui/icons";

/*
 * Places, out of the quest board and into a room of their own.
 *
 * A place was only ever reachable through a modal on the board, which framed it
 * as a way to file notices. It is not: quests hang in places, encounters are
 * prepared for them, and the veil that hides one hides everything inside it.
 * That makes the place tree a hub the other features point at, so it gets a
 * page — and the page links back out to what hangs there.
 *
 * The DM gets the cartographer's table. Players get the gazetteer: the places
 * they have been let in on, in the same nesting, and nothing about the ones
 * they have not. The filtering is the server's (`ListLocations` resolves the
 * veil up the whole ancestor chain) — this page never sees a veiled place.
 */

/* The players' read-only view: what the party knows of the world so far. */
function Gazetteer({
  campaignId,
  locations,
}: {
  campaignId: string;
  locations: Location[];
}) {
  if (locations.length === 0) {
    return (
      <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
        The map is still blank — your DM has charted nothing you have seen yet.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {locations.map((l) => (
        <div
          key={l.id}
          className="parchment flex flex-wrap items-center gap-3 px-4 py-2.5"
          style={{
            marginLeft: indentOf(l.depth),
            // Indent alone reads as a wobble rather than a hierarchy once the
            // rows are full width; the rule is what makes "inside" legible.
            borderLeft: l.depth > 0 ? "3px solid rgba(138,94,44,.5)" : undefined,
          }}
        >
          <span className="text-[#8a5e2c]">
            <IconMapPin size={14} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-heading text-[14px] font-semibold text-ink">
              {l.name}
            </span>
            {l.description && (
              <span className="font-body block text-[12.5px] italic text-ink-body">
                {l.description}
              </span>
            )}
          </span>
          <PlaceLinks campaignId={campaignId} place={l} />
        </div>
      ))}
    </div>
  );
}

export default function WorldPage() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const { data: locations, isLoading } = useLocations(campaign.id);
  const { data: characters } = useCharacters(campaign.id);
  // The encounter library is DM-only, so the battle counts are too.
  const { data: encounters } = useEncounters(campaign.id, isDM);

  const places = useMemo(() => locations ?? [], [locations]);

  const battles = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of encounters ?? []) {
      if (e.locationId) counts[e.locationId] = (counts[e.locationId] ?? 0) + 1;
    }
    return counts;
  }, [encounters]);

  return (
    <div className="panel-hall px-5 pb-11 pt-8 sm:px-[30px]">
      <div
        className="mb-6 flex flex-wrap items-center justify-between gap-4 pb-3.5"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <div>
          <h2
            className="font-display m-0 text-[clamp(24px,3vw,32px)] font-black text-[#e7d3a6]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
          >
            The World
          </h2>
          <div className="font-accent mt-1 text-[13px] italic text-cream-muted">
            {isDM
              ? "The world as you have charted it — realms, cities, and who is allowed to know they exist."
              : "The world as your party knows it so far."}
          </div>
        </div>
        <span className="label-stamp text-[11px] text-gold-muted">
          {places.length} place{places.length === 1 ? "" : "s"}
        </span>
      </div>

      {isLoading ? (
        <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
          Unrolling the map…
        </div>
      ) : isDM ? (
        <div className="parchment px-5 py-6 sm:px-7">
          <PlacesManager
            campaignId={campaign.id}
            locations={places}
            characters={characters ?? []}
            battles={battles}
          />
        </div>
      ) : (
        <Gazetteer campaignId={campaign.id} locations={places} />
      )}
    </div>
  );
}
