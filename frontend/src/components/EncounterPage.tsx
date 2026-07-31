import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  useActiveEncounter,
  useCreateEncounter,
  useDeleteEncounter,
  useEncounter,
  useEncounters,
  useLocations,
  useRollCombatant,
  useStandDownEncounters,
} from "../hooks";
import type { CampaignContext } from "./CampaignView";
import { IconPlus, IconTrash } from "./ui/icons";
import { EncounterRunner } from "./encounter/EncounterRunner";
import { FilingBar } from "./encounter/FilingBar";
import { PlaceSelect } from "./encounter/PlaceSelect";
import { mobName, toEntries } from "./encounter/entries";
import { HpStatePill, TurnMark } from "./encounter/rowParts";
import { GROUP_MODES, shelve, type GroupMode } from "./encounter/filing";
import { HP_STATE_TONE, RED_BTN } from "./encounter/theme";

function DMEncounters({ campaign }: { campaign: CampaignContext["campaign"] }) {
  const { data: list } = useEncounters(campaign.id, true);
  const { data: locations } = useLocations(campaign.id);
  const create = useCreateEncounter(campaign.id);
  const del = useDeleteEncounter(campaign.id);
  const standDownAll = useStandDownEncounters(campaign.id);
  const [openId, setOpenId] = useState<string | null>(null);
  const [name, setName] = useState("");
  // Filing for the next fight prepared. Deliberately sticky: a DM laying out a
  // night's worth of combats types the session once, not once per encounter.
  const [tag, setTag] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<GroupMode>("tag");
  const places = useMemo(() => locations ?? [], [locations]);

  function prepare() {
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), tag: tag.trim() || undefined, locationId: placeId || null },
      { onSuccess: (enc) => { setName(""); if (enc) setOpenId(enc.id); } },
    );
  }

  // Search runs over the whole filing, not just the name: "vallaki" finds the
  // fights prepared there even when the DM never put it in a title.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list ?? [];
    return (list ?? []).filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.tag.toLowerCase().includes(q) ||
        (e.locationName ?? "").toLowerCase().includes(q),
    );
  }, [list, search]);
  const shelves = useMemo(() => shelve(filtered, groupBy), [filtered, groupBy]);

  // Several fights can run at once — a split party is two encounters — so this
  // is a count, not a lookup. The library still opens on a running one by
  // default when there's exactly one obvious candidate.
  const running = useMemo(() => (list ?? []).filter((e) => e.status === "active"), [list]);
  const activeId = running[0]?.id ?? null;
  const selectedId = openId ?? activeId;
  const { data: detail } = useEncounter(selectedId ?? undefined);

  if (selectedId && detail) {
    return (
      <div>
        <button onClick={() => setOpenId(null)} className="label-stamp mb-3 text-[11px] text-gold-muted hover:text-ember-bright">
          ← All encounters
        </button>
        <div className="mb-3 flex items-baseline gap-3">
          <h3 className="font-display m-0 text-[22px] font-black text-[#e7d3a6]">{detail.encounter.name}</h3>
          <span className="label-stamp text-[10px] tracking-[1.5px] text-gold-muted">{detail.encounter.status}</span>
        </div>
        <FilingBar campaignId={campaign.id} enc={detail.encounter} />
        <EncounterRunner campaign={campaign} detail={detail} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") prepare(); }}
          placeholder="Prepare a new encounter — name it…"
          className="input-hall min-w-0 flex-1 basis-[220px]"
        />
        <input
          value={tag}
          maxLength={60}
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") prepare(); }}
          placeholder="Session or act…"
          title="Files it in the library — reused for the next one you prepare"
          className="input-hall w-[170px]"
        />
        {places.length > 0 && (
          <PlaceSelect locations={places} value={placeId} onChange={setPlaceId} className="w-[190px]" />
        )}
        <button
          onClick={prepare}
          disabled={!name.trim() || create.isPending}
          className="btn-base btn-gold clip-octagon h-10 px-5 text-[13px]"
        >
          <IconPlus size={14} /> Prepare
        </button>
      </div>

      {/* Even with the library shelved, hunting down which of several running
          fights still holds a player is a chore. This releases them all. */}
      {running.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="label-stamp text-[10px] tracking-[1.5px] text-gold-muted">
            {running.length} fight{running.length === 1 ? "" : "s"} running
          </span>
          <button
            onClick={() => {
              if (confirm(`Stand down ${running.length} running encounter${running.length === 1 ? "" : "s"}? Every summoned hero is released and initiative is cleared.`)) {
                standDownAll.mutate();
              }
            }}
            disabled={standDownAll.isPending}
            title="End every running encounter and release every summoned hero"
            className="btn-base h-9 px-4 text-[12px] disabled:opacity-40"
            style={RED_BTN}
          >
            ⏹ Stand down all
          </button>
        </div>
      )}

      {(list ?? []).length === 0 ? (
        <div className="font-accent px-5 py-[50px] text-center text-base italic text-[#9c855e]">
          No encounters yet — prepare one above, then trigger it at the table.
        </div>
      ) : (
        <>
          {/* A campaign that runs long turns this library into a scroll, so it
              is searchable and shelved by whichever axis the DM files on. */}
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, session, or place…"
              className="input-hall min-w-0 flex-1 basis-[220px] sm:max-w-[300px]"
            />
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupMode)}
              className="input-hall w-[180px] cursor-pointer"
            >
              {GROUP_MODES.map(([mode, label]) => (
                <option key={mode} value={mode}>{label}</option>
              ))}
            </select>
          </div>
          <div className="label-stamp mb-4 text-[10px] tracking-[1.5px] text-gold-muted">
            {filtered.length} of {(list ?? []).length} encounters
            {search && (
              <button
                onClick={() => setSearch("")}
                className="ml-2 cursor-pointer border-none bg-transparent p-0 text-[10px] tracking-[1.5px] text-ember-bright underline"
              >
                Clear search
              </button>
            )}
          </div>

          {shelves.length === 0 ? (
            <div className="font-accent px-5 py-[50px] text-center text-base italic text-[#9c855e]">
              No encounter answers that call.
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {shelves.map(([label, group]) => (
                <section key={label || "all"}>
                  {label && (
                    <div className="label-stamp mb-2.5 text-[10px] tracking-[2.5px] text-gold-muted">
                      {label} · {group.length}
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {group.map((e) => {
                      // The shelf already names the axis it grouped on; the card
                      // shows the other one, so nothing is said twice.
                      const aside = groupBy === "tag" ? e.locationName : groupBy === "place" ? e.tag : [e.tag, e.locationName].filter(Boolean).join(" · ");
                      return (
                        <div key={e.id} className="parchment flex items-center justify-between px-4 py-3">
                          <button onClick={() => setOpenId(e.id)} className="min-w-0 flex-1 text-left">
                            <div className="font-display truncate text-[15px] font-bold text-ink">{e.name}</div>
                            <div className="label-stamp mt-0.5 text-[9px] tracking-[1px] text-ink-label">
                              {e.combatantCount} combatant{e.combatantCount === 1 ? "" : "s"} · {e.status}
                              {aside ? ` · ${aside}` : ""}
                            </div>
                          </button>
                          <div className="flex flex-none items-center gap-2">
                            {e.status === "active" && (
                              <span className="h-2 w-2 rounded-full bg-[#8fb15f]" style={{ boxShadow: "0 0 8px #8fb15f" }} title="Running" />
                            )}
                            <button onClick={() => { if (confirm(`Discard "${e.name}"?`)) del.mutate(e.id); }} className="btn-base btn-ghost-red p-1.5" title="Discard">
                              <IconTrash size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ═══ Player: the read-only tracker ════════════════════════════════════════ */

function PlayerEncounter({ campaignId }: { campaignId: string }) {
  const { data: detail, isLoading } = useActiveEncounter(campaignId);
  const roll = useRollCombatant(campaignId, detail?.encounter.id ?? "");

  if (isLoading) {
    return <div className="font-accent px-5 py-[50px] text-center text-base italic text-[#9c855e]">Listening for battle…</div>;
  }
  if (!detail) {
    return (
      <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
        No encounter is running. When your DM triggers one, the initiative order appears here.
      </div>
    );
  }
  const enc = detail.encounter;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h3 className="font-display m-0 text-[22px] font-black text-[#e7d3a6]">{enc.name}</h3>
        <span className="label-stamp text-[10px] tracking-[1.5px] text-gold-muted">Round {enc.round}</span>
      </div>
      <div className="flex max-w-[560px] flex-col gap-1.5">
        {/* Mobs read as one line for players too — the party sees "Skeleton ×5"
            acting at once, not five entries. PCs are never grouped, so the
            "you"/roll affordances below always fall on a lone combatant. */}
        {toEntries(detail.combatants).map((e) => {
          const c = e.members[0];
          const mob = e.members.length > 1;
          // Worst state in the pack, so "bloodied" shows while any of them is.
          const state = mob
            ? e.members.some((m) => m.hpState === "healthy")
              ? e.members.some((m) => m.hpState !== "healthy") ? "bloodied" : "healthy"
              : e.members.every((m) => m.hpState === "down") ? "down" : "bloodied"
            : c.hpState;
          return (
            <div
              key={e.key}
              className="flex items-center gap-3 rounded-[3px] px-3 py-2"
              style={{
                background: c.current ? "rgba(224,169,78,.12)" : "rgba(0,0,0,.14)",
                boxShadow: c.current ? "inset 0 0 0 1px rgba(224,169,78,.5)" : "inset 0 0 0 1px rgba(201,162,39,.16)",
              }}
            >
              <TurnMark active={c.current}>{c.initiative ?? "—"}</TurnMark>
              <span className="font-heading flex-1 truncate text-[13.5px] font-semibold text-cream">
                {mob ? mobName(c.name) : c.name}
                {mob && <span className="label-stamp ml-1.5 text-[9px] tracking-[1px] text-ember-bright">×{e.members.length}</span>}
                {c.isMine && <span className="label-stamp ml-2 text-[8px] tracking-[1px] text-ember-bright">you</span>}
              </span>
              {!mob && c.isMine && c.hpCurrent != null ? (
                <span className="font-heading text-[13px] font-bold tabular-nums" style={{ color: HP_STATE_TONE[c.hpState] }}>
                  {c.hpCurrent}/{c.hpMax}
                </span>
              ) : (
                <HpStatePill state={state} />
              )}
              {!mob && c.isMine && c.initiative == null && (
                <button onClick={() => roll.mutate(c.id)} className="btn-base btn-wax h-7 px-2.5 text-[10px]">
                  🎲 Roll
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function EncounterPage() {
  const { campaign, role } = useOutletContext<CampaignContext>();
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
            Encounters
          </h2>
          <div className="font-accent mt-1 text-[13px] italic text-cream-muted">
            {role === "dm"
              ? "Prepare battles ahead of time, then trigger them at the table."
              : "The battle at hand — initiative order and whose turn it is."}
          </div>
        </div>
      </div>
      {role === "dm" ? <DMEncounters campaign={campaign} /> : <PlayerEncounter campaignId={campaign.id} />}
    </div>
  );
}
