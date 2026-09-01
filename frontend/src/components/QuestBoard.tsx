import { useMemo, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import type { Location } from "../api/client";
import { useCharacters, useCreateQuest, useLocations, useQuests } from "../hooks";
import type { CampaignContext } from "./CampaignView";
import { LocationPicker } from "./LocationPicker";
import QuestCard from "./QuestCard";
import QuestForm, { emptyQuest } from "./QuestForm";
import FloatingDiceTray from "./ui/DiceTray";
import ParchmentModal from "./ui/ParchmentModal";
import { IconCheckSquare, IconFolder, IconMapPin, IconPlus } from "./ui/icons";

/* Every place at or below the chosen one — picking a realm shows the notices in
   its cities too, which is what "show me Portugal" ought to mean. */
function locationAndDescendants(locations: Location[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  // Locations arrive parents-first, so one pass settles the whole subtree.
  for (const l of locations) {
    if (l.parentId && ids.has(l.parentId)) ids.add(l.id);
  }
  return ids;
}

export default function QuestBoard() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const { data: quests, isLoading } = useQuests(campaign.id);
  const { data: locations } = useLocations(campaign.id);
  const { data: characters } = useCharacters(campaign.id);
  const createQuest = useCreateQuest(campaign.id);
  const [posting, setPosting] = useState(false);

  // The place filter lives in the URL rather than in state, so the World page
  // can hand someone a board already narrowed to one corner of the map — and so
  // that corner survives a reload or a shared link.
  const [params, setParams] = useSearchParams();
  const place = params.get("place") ?? "";
  const setPlace = (next: string) =>
    setParams(next ? { place: next } : {}, { replace: true });

  const places = useMemo(() => locations ?? [], [locations]);

  const shown = useMemo(() => {
    if (!quests) return [];
    if (!place) return quests;
    if (place === "none") return quests.filter((q) => !q.locationId);
    const within = locationAndDescendants(places, place);
    return quests.filter((q) => q.locationId && within.has(q.locationId));
  }, [quests, places, place]);

  const availableCount = shown.filter((q) => q.status === "available").length;
  const activeCount = shown.filter((q) => q.status === "active").length;
  const myClaims = shown.filter((q) => q.claimedByMe).length;

  return (
    <div className="panel-hall px-5 pb-28 pt-8 sm:px-[30px] sm:pb-11">
      {/* board header strip */}
      <div
        className="mb-[26px] flex flex-wrap items-center justify-between gap-4 pb-3.5"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <div className="flex flex-wrap items-baseline gap-3.5">
          <h2
            className="font-display m-0 text-[clamp(24px,3vw,32px)] font-black text-[#e7d3a6]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
          >
            The Quest Board
          </h2>
          <span className="label-stamp text-xs text-gold-muted">
            {availableCount} open · {activeCount} afoot
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* The world has its own room now — the board keeps a door to it
              because filing a notice is where you notice a place is missing. */}
          <Link
            to={`/questboard/campaigns/${campaign.id}/world`}
            className="btn-base btn-ghost-gold clip-octagon h-10 px-4 text-[13px] no-underline"
          >
            <IconMapPin size={15} strokeWidth={2} />
            The World
          </Link>
          {isDM ? (
            <button
              onClick={() => setPosting(true)}
              className="btn-base btn-gold clip-octagon h-10 px-5 text-[13px]"
            >
              <IconPlus size={15} strokeWidth={2} />
              Post a Quest
            </button>
          ) : (
            <div className="chip-hall px-[15px] py-[9px]">
              <span className="text-gold-hair">
                <IconCheckSquare size={16} />
              </span>
              <span className="label-stamp text-[11px] font-semibold text-[#e6d5af]">
                {myClaims} claimed by you
              </span>
            </div>
          )}
        </div>
      </div>

      {/* place filter — one scalable picker in place of a wall of buttons (#290) */}
      {places.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2.5">
          <span className="label-stamp text-[10px] tracking-[2px] text-gold-muted">
            Where
          </span>
          <LocationPicker
            locations={places}
            value={place}
            onChange={setPlace}
            showCounts
            surface="hall"
            specials={[
              { key: "", label: "Everywhere" },
              { key: "none", label: "Unpinned" },
            ]}
          />
        </div>
      )}

      {isLoading ? (
        <div className="font-accent px-5 py-[70px] text-center text-base italic text-[#9c855e]">
          Unrolling the notices…
        </div>
      ) : shown.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(312px,100%),1fr))] gap-x-[26px] gap-y-[34px]">
          {shown.map((q) => (
            <QuestCard
              key={q.id}
              quest={q}
              role={role}
              campaignId={campaign.id}
              locations={places}
              characters={characters ?? []}
            />
          ))}
        </div>
      ) : (
        <div className="px-5 py-[70px] text-center">
          <div className="mb-4 inline-flex text-[#7a5e34]">
            <IconFolder size={46} strokeWidth={1.4} />
          </div>
          <div className="font-display text-2xl text-[#cdb582]">
            {place ? "Nothing posted here" : "No quests posted"}
          </div>
          <div className="font-accent mt-2 text-base italic text-[#9c855e]">
            {place ? "— try another corner of the map. —" : "— the board awaits. —"}
          </div>
        </div>
      )}

      {posting && (
        <ParchmentModal onClose={() => setPosting(false)} maxWidth="max-w-[560px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Dungeon Master's Quill
          </div>
          <h3 className="font-display m-0 mb-5 text-center text-2xl font-bold text-ink">
            Nail Up a Notice
          </h3>
          <QuestForm
            initial={emptyQuest}
            mode="create"
            locations={places}
            isPending={createQuest.isPending}
            errorText={
              createQuest.isError
                ? ((createQuest.error as { error?: string } | null)?.error ??
                  "The notice would not pin — check the fields and try again.")
                : undefined
            }
            onCancel={() => setPosting(false)}
            onSubmit={(v) =>
              createQuest.mutate(v, { onSuccess: () => setPosting(false) })
            }
          />
        </ParchmentModal>
      )}

      <FloatingDiceTray campaignId={campaign.id} />
    </div>
  );
}
