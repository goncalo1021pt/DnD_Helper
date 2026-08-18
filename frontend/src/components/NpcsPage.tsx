import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import type { Character, Npc, RulesContent } from "../api/client";
import type { CampaignContext } from "./CampaignView";
import {
  useCharacters,
  useClearNpcOverride,
  useClearNpcStatsOverride,
  useCreateNpc,
  useDeleteNpc,
  useLocations,
  useNpcs,
  useRules,
  useSetNpcStatsVisibility,
  useSetNpcVisibility,
  useUpdateNpc,
} from "../hooks";
import ContentEntry from "./ui/ContentEntry";
import ParchmentModal from "./ui/ParchmentModal";
import VisibilityControl from "./VisibilityControl";
import { IconPlus, IconTrash } from "./ui/icons";

/**
 * The Folk (#215): the people of the campaign, and what the party knows of
 * them. The DM drafts a town's worth of faces at home; each person carries two
 * veils — being known at all, and having their numbers readable — worked for
 * the whole party or hero by hero, exactly like a quest notice. Behind a
 * person there can stand a Den stat block or a full character sheet.
 *
 * A player only ever receives the people their veil resolves visible, with
 * stats attached only where the second veil allows — this page does no hiding
 * of its own. What arrives is what they are allowed to know.
 */

/** Unlink sentinel, the way the bestiary unlinks a monster. */
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export default function NpcsPage() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const { data: npcs, isLoading } = useNpcs(campaign.id);
  const { data: places } = useLocations(campaign.id);
  const { data: party } = useCharacters(campaign.id);
  const create = useCreateNpc(campaign.id);
  const [name, setName] = useState("");
  const [where, setWhere] = useState("");
  const [reading, setReading] = useState<RulesContent | null>(null);

  // Grouped by the place they are found in, because that is how a party meets
  // them — "we're in Phandalin, who do we know here?" — and unfiled folk last.
  const byPlace = useMemo(() => {
    const groups = new Map<string, Npc[]>();
    for (const n of npcs ?? []) {
      const key = n.locationName ?? "";
      groups.set(key, [...(groups.get(key) ?? []), n]);
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === "") return 1;
      if (b === "") return -1;
      return a.localeCompare(b);
    });
  }, [npcs]);

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
            The Folk
          </h2>
          <div className="font-accent mt-1 text-[13px] italic text-cream-muted">
            {isDM
              ? "Draft the NPCs of your world at home; reveal who the party has met — and whose numbers they may read."
              : "The people you have met, and what you know of them."}
          </div>
        </div>
      </div>

      {isDM && (
        <form
          className="mb-6 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            create.mutate(
              { name: name.trim(), locationId: where || null },
              { onSuccess: () => { setName(""); setWhere(""); } },
            );
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bring in a person — name them…"
            className="input-hall min-w-0 flex-1 basis-[240px] sm:max-w-[320px]"
          />
          <select
            value={where}
            onChange={(e) => setWhere(e.target.value)}
            aria-label="Where they are found"
            className="input-hall w-[190px]"
          >
            <option value="">Filed nowhere</option>
            {(places ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!name.trim() || create.isPending}
            className="btn-base btn-gold clip-octagon h-10 px-5 text-[13px] disabled:opacity-40"
          >
            <IconPlus size={15} strokeWidth={2} />
            Bring in
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
          Asking after names…
        </div>
      ) : (npcs ?? []).length === 0 ? (
        <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
          {isDM
            ? "Nobody here yet — bring someone in, and file them where the party will meet them."
            : "You have met no one worth writing down yet — the folk you meet are set down here, and what you learn of them with them."}
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          {byPlace.map(([place, folk]) => (
            <section key={place || "nowhere"}>
              <div className="label-stamp mb-2 text-[10px] tracking-[3px] text-gold-muted">
                {place || "Filed nowhere"}
              </div>
              <div className="flex flex-col gap-3">
                {folk.map((n) => (
                  <NpcCard
                    key={n.id}
                    campaignId={campaign.id}
                    npc={n}
                    party={party ?? []}
                    onRead={setReading}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {reading && (
        <ParchmentModal onClose={() => setReading(null)} maxWidth="max-w-[560px]">
          <ContentEntry entry={reading} />
        </ParchmentModal>
      )}
    </div>
  );
}

function NpcCard({
  campaignId,
  npc,
  party,
  onRead,
}: {
  campaignId: string;
  npc: Npc;
  party: Character[];
  onRead: (block: RulesContent) => void;
}) {
  const update = useUpdateNpc(campaignId);
  const remove = useDeleteNpc(campaignId);
  const setVis = useSetNpcVisibility(campaignId);
  const clearVis = useClearNpcOverride(campaignId);
  const setStatsVis = useSetNpcStatsVisibility(campaignId);
  const clearStatsVis = useClearNpcStatsOverride(campaignId);
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState(npc.description);
  const [veilsOpen, setVeilsOpen] = useState(false);

  const hasStats = !!npc.statBlock || !!npc.characterId;

  return (
    <div
      className="rounded-[4px] p-3.5"
      style={{ background: "rgba(0,0,0,.12)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.16)" }}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="font-display text-[16px] font-bold text-[#e7d3a6]">{npc.name}</div>
        {npc.isDM && (
          <div className="flex items-center gap-2">
            {/* The two veils, at a glance. Knowing someone and reading their
                numbers are separate acts, so each gets its own stamp. */}
            <button
              onClick={() => setVis.mutate({ npcId: npc.id, body: { scope: "party", visible: !npc.visibleToParty } })}
              aria-pressed={npc.visibleToParty}
              className="label-stamp rounded-[2px] px-2 py-1 text-[9px] tracking-[1px]"
              style={{
                color: npc.visibleToParty ? "#e6d2a0" : "#8a7b60",
                background: npc.visibleToParty ? "rgba(201,162,39,.12)" : "transparent",
                boxShadow: `inset 0 0 0 1px rgba(201,162,39,${npc.visibleToParty ? ".34" : ".14"})`,
              }}
            >
              {npc.visibleToParty ? "The party knows them" : "Unknown to the party"}
            </button>
            {hasStats && (
              <button
                onClick={() =>
                  setStatsVis.mutate({ npcId: npc.id, body: { scope: "party", visible: !npc.statsVisibleToParty } })
                }
                aria-pressed={npc.statsVisibleToParty}
                className="label-stamp rounded-[2px] px-2 py-1 text-[9px] tracking-[1px]"
                style={{
                  color: npc.statsVisibleToParty ? "#8fb15f" : "#8a7b60",
                  boxShadow: `inset 0 0 0 1px rgba(201,162,39,${npc.statsVisibleToParty ? ".3" : ".14"})`,
                }}
              >
                {npc.statsVisibleToParty ? "Stats open" : "Stats veiled"}
              </button>
            )}
            <button
              onClick={() => setVeilsOpen((on) => !on)}
              aria-expanded={veilsOpen}
              className="btn-base btn-ghost-gold h-7 px-2 py-0 text-[10px]"
            >
              Hero by hero
            </button>
            <button
              onClick={() => setEditingDesc((on) => !on)}
              aria-label={`Describe ${npc.name}`}
              className="btn-base btn-ghost-gold h-7 px-2 py-0 text-[10px]"
            >
              Describe
            </button>
            <button
              onClick={() => {
                if (confirm(`Strike "${npc.name}" from the campaign?`)) {
                  remove.mutate(npc.id);
                }
              }}
              aria-label={`Strike ${npc.name}`}
              className="btn-base btn-ghost-red h-7 px-2 py-0 text-[11px]"
            >
              <IconTrash size={12} strokeWidth={1.8} />
            </button>
          </div>
        )}
      </div>

      {editingDesc ? (
        <div className="mb-2 flex flex-col gap-2">
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={2}
            aria-label={`Description of ${npc.name}`}
            placeholder="Who they are when the party meets them — voice, manner, what they want…"
            className="input-hall min-h-[52px] w-full text-[12.5px]"
          />
          <div className="flex gap-2">
            <button
              onClick={() =>
                update.mutate(
                  { npcId: npc.id, body: { name: npc.name, description: desc } },
                  { onSuccess: () => setEditingDesc(false) },
                )
              }
              disabled={update.isPending}
              className="btn-base btn-gold h-7 px-3 text-[10px]"
            >
              Save
            </button>
            <button
              onClick={() => { setDesc(npc.description); setEditingDesc(false); }}
              className="btn-base btn-ghost-gold h-7 px-3 text-[10px]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        npc.description && (
          <div className="font-accent mb-2 text-[12.5px] italic text-cream-muted">
            {npc.description}
          </div>
        )
      )}

      {/* What stands behind them. For a player these only arrive when the
          stats veil allows, so their presence IS the permission. */}
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        {npc.statBlock && (
          <button
            onClick={() => onRead(npc.statBlock!)}
            className="btn-base btn-ghost-gold h-7 px-2.5 py-0 text-[10px]"
          >
            Read their stat block — {npc.statBlock.name}
          </button>
        )}
        {npc.characterId && (
          <Link
            to={`/questboard/heroes/${npc.characterId}`}
            className="btn-base btn-ghost-gold h-7 px-2.5 py-0 text-[10px] no-underline"
          >
            Open their sheet — {npc.characterName ?? "a hero"}
          </Link>
        )}
        {npc.isDM && hasStats && (
          <button
            onClick={() =>
              update.mutate({
                npcId: npc.id,
                body: {
                  name: npc.name,
                  ...(npc.statBlock ? { contentId: NIL_UUID } : { characterId: NIL_UUID }),
                },
              })
            }
            aria-label={`Detach the stats of ${npc.name}`}
            title="Detach — they go back to being just a name"
            className="cursor-pointer border-none bg-transparent p-0 text-[11px] text-[#c96a5a]"
          >
            ×
          </button>
        )}
        {npc.isDM && !hasStats && (
          <AttachStats campaignId={campaignId} npc={npc} party={party} />
        )}
      </div>

      {npc.isDM && veilsOpen && (
        <div
          className="mt-3 grid gap-4 rounded-[4px] p-3 sm:grid-cols-2"
          style={{ background: "rgba(0,0,0,.14)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.12)" }}
        >
          <div className="flex flex-col gap-2">
            <span className="label-stamp text-[9px] tracking-[2px] text-gold-muted">
              Who knows them
            </span>
            <VisibilityControl
              visibleToParty={npc.visibleToParty ?? false}
              overrides={npc.visibility ?? []}
              characters={party}
              isPending={setVis.isPending || clearVis.isPending}
              onChange={(body) => setVis.mutate({ npcId: npc.id, body })}
              onClearHero={(characterId) => clearVis.mutate({ npcId: npc.id, characterId })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="label-stamp text-[9px] tracking-[2px] text-gold-muted">
              Who reads their stats
            </span>
            {hasStats ? (
              <VisibilityControl
                visibleToParty={npc.statsVisibleToParty ?? false}
                overrides={npc.statsVisibility ?? []}
                characters={party}
                isPending={setStatsVis.isPending || clearStatsVis.isPending}
                onChange={(body) => setStatsVis.mutate({ npcId: npc.id, body })}
                onClearHero={(characterId) => clearStatsVis.mutate({ npcId: npc.id, characterId })}
              />
            ) : (
              <span className="font-accent text-[12px] italic text-cream-muted">
                Nothing stands behind them yet — attach a stat block or a sheet first.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * What stands behind a person: a Den monster found by typing, or the sheet of
 * a hero seated at this campaign. One or the other — the server refuses both.
 */
function AttachStats({
  campaignId,
  npc,
  party,
}: {
  campaignId: string;
  npc: Npc;
  party: Character[];
}) {
  const update = useUpdateNpc(campaignId);
  const { data: monsters } = useRules("monster", npc.isDM);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return (monsters ?? []).filter((m) => m.name.toLowerCase().includes(term)).slice(0, 8);
  }, [q, monsters]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <>
      <div ref={boxRef} className="relative w-[200px]">
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Attach a stat block…"
          aria-label={`Attach a stat block to ${npc.name}`}
          className="input-hall h-8 w-full text-[12px]"
        />
        {open && matches.length > 0 && (
          <div
            className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-[240px] overflow-y-auto rounded-[4px] py-1"
            style={{ background: "#1c1108", boxShadow: "0 12px 30px rgba(0,0,0,.6), inset 0 0 0 1px rgba(201,162,39,.35)" }}
          >
            {matches.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  update.mutate({ npcId: npc.id, body: { name: npc.name, contentId: m.id } });
                  setQ("");
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12.5px] text-cream-soft transition hover:bg-[rgba(201,162,39,.14)]"
              >
                <span className="font-heading">{m.name}</span>
                {m.source !== "srd" && (
                  <span className="label-stamp text-[8px] tracking-[1px] text-gold-muted">homebrew</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) {
            update.mutate({ npcId: npc.id, body: { name: npc.name, characterId: e.target.value } });
          }
        }}
        aria-label={`Attach a sheet to ${npc.name}`}
        className="input-hall h-8 w-[180px] text-[12px]"
      >
        <option value="">…or a seated hero's sheet</option>
        {party.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </>
  );
}
