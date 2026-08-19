
import { useMemo } from "react";
import type { EncounterDetail } from "../../api/client";
import { useRollInitiative, useUpdateEncounter } from "../../hooks";
import type { CampaignContext } from "../CampaignView";
import { AddCombatant } from "./AddCombatant";
import { CombatantRow } from "./CombatantRow";
import { DifficultyMeter } from "./DifficultyMeter";
import { toEntries } from "./entries";
import { GroupRow } from "./GroupRow";
import { MonsterBrowser } from "./MonsterBrowser";
import { NEUTRAL_BTN, RED_BTN } from "./theme";

export function EncounterRunner({ campaign, detail }: { campaign: CampaignContext["campaign"]; detail: EncounterDetail }) {
  // Two lives: while it's building, the D&D-Beyond-style two-pane builder;
  // once triggered, the full-width initiative tracker.
  return detail.encounter.status === "active" ? (
    <ActiveTracker campaign={campaign} detail={detail} />
  ) : (
    <BuildLayout campaign={campaign} detail={detail} />
  );
}

/* The running fight — round counter, turn stepper, and the live combatant list. */
export function ActiveTracker({ campaign, detail }: { campaign: CampaignContext["campaign"]; detail: EncounterDetail }) {
  const enc = detail.encounter;
  const combatants = detail.combatants;
  const update = useUpdateEncounter(campaign.id);
  const rollAll = useRollInitiative(campaign.id, enc.id);

  // Turns advance one ENTRY at a time, and a mob is a single entry — otherwise
  // a pack of eight skeletons would eat eight presses of "Next turn". The
  // stored turnIndex still points at a row, so we translate: find the entry
  // holding the current row, move one entry, then land on that entry's first
  // member.
  const entries = useMemo(() => toEntries(combatants), [combatants]);
  const starts = useMemo(() => {
    const out: number[] = [];
    let i = 0;
    for (const e of entries) { out.push(i); i += e.members.length; }
    return out;
  }, [entries]);

  function step(dir: 1 | -1) {
    if (entries.length === 0) return;
    // The last start at or before turnIndex is the entry currently acting.
    let cur = 0;
    for (let i = 0; i < starts.length; i++) if (starts[i] <= enc.turnIndex) cur = i;
    let next = cur + dir;
    let round = enc.round;
    if (next >= entries.length) { next = 0; round += 1; }
    if (next < 0) { next = entries.length - 1; round = Math.max(1, round - 1); }
    update.mutate({ encounterId: enc.id, body: { turnIndex: starts[next], round } });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={() => rollAll.mutate()} className="btn-base btn-wax h-9 px-4 text-[12px]">
          🎲 Roll all initiative
        </button>
        <div className="chip-hall px-3 py-1.5">
          <span className="label-stamp text-[9px] tracking-[1.5px] text-gold-muted">Round</span>
          <span className="font-heading text-sm font-bold text-ember-bright tabular-nums">{enc.round}</span>
        </div>
        <button
          onClick={() => step(-1)}
          disabled={enc.round === 1 && enc.turnIndex === 0}
          title="Previous turn"
          className="btn-base h-9 px-3 text-[12px] disabled:opacity-40"
          style={NEUTRAL_BTN}
        >
          ‹ Prev
        </button>
        <button onClick={() => step(1)} className="btn-base btn-wax h-9 px-4 text-[12px]">Next turn ›</button>
        <button
          onClick={() => update.mutate({ encounterId: enc.id, body: { status: "inactive" } })}
          title="Stand the fight down — releases the party and clears initiative; the monsters stay prepared"
          className="btn-base h-9 px-3 text-[12px]"
          style={RED_BTN}
        >
          Stand down
        </button>
      </div>

      <AddCombatant
        campaignId={campaign.id}
        encounterId={enc.id}
        existingCharacterIds={combatants.filter((c) => c.kind === "pc" && c.characterId).map((c) => c.characterId as string)}
        existingNpcIds={combatants.filter((c) => c.npcId).map((c) => c.npcId as string)}
      />

      <div className="mt-3 flex flex-col gap-1.5">
        {entries.map((e) =>
          e.members.length > 1 ? (
            <GroupRow
              key={e.key}
              members={e.members}
              active={e.members.some((m) => m.current)}
              campaignId={campaign.id}
              encounterId={enc.id}
              editable
            />
          ) : (
            <CombatantRow
              key={e.key}
              c={e.members[0]}
              active={e.members[0].current}
              campaignId={campaign.id}
              encounterId={enc.id}
            />
          ),
        )}
      </div>
    </div>
  );
}

/* Building an encounter: the Den on the left to browse and add, the fight
   being assembled on the right, ready to trigger. Stacks on a phone. */
export function BuildLayout({ campaign, detail }: { campaign: CampaignContext["campaign"]; detail: EncounterDetail }) {
  const enc = detail.encounter;
  const combatants = detail.combatants;
  const update = useUpdateEncounter(campaign.id);
  const canTrigger = combatants.length > 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
      {/* LEFT — the Den */}
      <div
        className="rounded-[4px] p-3"
        style={{ background: "rgba(0,0,0,.1)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.14)" }}
      >
        <MonsterBrowser campaignId={campaign.id} encounterId={enc.id} />
      </div>

      {/* RIGHT — the fight taking shape */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <div className="label-stamp text-[11px] tracking-[3px] text-gold-muted">In this encounter</div>
          <div className="label-stamp text-[9px] tracking-[1px] text-gold-muted">
            {combatants.length} joined
          </div>
        </div>
        {/* No initiative here — not the input on each row, not a "roll all".
            An order rolled before the fight exists is one the DM has to
            remember not to trust; it belongs to the tracker alone. */}
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            onClick={() => update.mutate({ encounterId: enc.id, body: { status: "active" } })}
            disabled={!canTrigger}
            title={canTrigger ? "Begin the fight" : "Add someone to the fight first"}
            className="btn-base btn-gold clip-octagon h-9 px-4 text-[12px] disabled:opacity-40"
          >
            ▶ Trigger
          </button>
        </div>

        <DifficultyMeter campaignId={campaign.id} combatants={combatants} />

        <AddCombatant campaignId={campaign.id} encounterId={enc.id} monster={false} party={false} />

        <div className="mt-3 flex flex-col gap-1.5">
          {combatants.length === 0 ? (
            <div className="font-accent py-6 text-center text-[13px] italic text-cream-muted">
              Empty so far — pick monsters from the Den, or add a custom foe. Your party joins once you trigger the fight.
            </div>
          ) : (
            toEntries(combatants).map((e) =>
              e.members.length > 1 ? (
                <GroupRow key={e.key} members={e.members} active={false} campaignId={campaign.id} encounterId={enc.id} editable showInitiative={false} />
              ) : (
                <CombatantRow key={e.key} c={e.members[0]} active={false} campaignId={campaign.id} encounterId={enc.id} showInitiative={false} />
              ),
            )
          )}
        </div>
      </div>
    </div>
  );
}
