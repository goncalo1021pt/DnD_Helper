
import { useState } from "react";
import { useAddCombatant, useCharacters, useNpcs, useParties } from "../../hooks";
import { IconPlus } from "../ui/icons";
import { MonsterSearch } from "./MonsterSearch";

export function AddCombatant({
  campaignId,
  encounterId,
  monster = true,
  party = true,
  existingCharacterIds = [],
  existingNpcIds = [],
}: {
  campaignId: string;
  encounterId: string;
  monster?: boolean;
  party?: boolean;
  existingCharacterIds?: string[];
  existingNpcIds?: string[];
}) {
  const add = useAddCombatant(campaignId, encounterId);
  const { data: chars } = useCharacters(campaignId);
  // The Folk who walk with the party (#228) sit on the party's side of the
  // order, so they are offered beside the heroes rather than among the
  // monsters — and only the ones who actually travel.
  const { data: folk } = useNpcs(campaignId);
  const { data: parties } = useParties(campaignId);
  const [kind, setKind] = useState<"monster" | "pc" | "ally" | "custom">(monster ? "monster" : party ? "pc" : "custom");
  const [pcPick, setPcPick] = useState("");
  const [allyPick, setAllyPick] = useState("");
  const [custom, setCustom] = useState({ label: "", hpMax: "", ac: "", initMod: "" });
  const availableChars = (chars ?? []).filter((c) => !existingCharacterIds.includes(c.id));
  const availableAllies = (folk ?? []).filter(
    (n) => n.traveling && !existingNpcIds.includes(n.id),
  );

  function addIt() {
    if (kind === "pc" && pcPick) {
      add.mutate({ kind: "pc", characterId: pcPick });
      setPcPick("");
    } else if (kind === "ally" && allyPick) {
      add.mutate({ kind: "ally", npcId: allyPick });
      setAllyPick("");
    } else if (kind === "custom" && custom.label.trim()) {
      add.mutate({
        kind: "custom",
        label: custom.label.trim(),
        hpMax: parseInt(custom.hpMax, 10) || 1,
        ac: parseInt(custom.ac, 10) || 10,
        initMod: parseInt(custom.initMod, 10) || 0,
      });
      setCustom({ label: "", hpMax: "", ac: "", initMod: "" });
    }
  }

  // Summon every hero not already in the fight, in one go — as distinct from
  // picking one at a time above. With parties formed (#232) the same button
  // narrows to one of them, which is the whole point of a table of twelve:
  // "the Harbour Crew are here" instead of eight clicks.
  function summonParty(partyId?: string) {
    availableChars
      .filter((c) => !partyId || c.partyId === partyId)
      .forEach((c) => add.mutate({ kind: "pc", characterId: c.id }));
  }

  return (
    <div className="chip-hall flex flex-wrap items-center gap-2 px-3 py-2.5">
      {/* A summon can now be refused — a hero already fighting in another
          encounter is not free to join this one — so the reason has to reach
          the DM, or the button just looks broken. */}
      {add.isError && (
        <p className="font-body m-0 w-full text-[12px] italic text-[#d68a72]">
          {(add.error as { error?: string } | null)?.error ?? "That one would not join the fight."}
        </p>
      )}
      <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="input-hall h-9 w-28 text-[12px]">
        {monster && <option value="monster">Monster</option>}
        {party && <option value="pc">Party</option>}
        {party && availableAllies.length > 0 && <option value="ally">Ally</option>}
        <option value="custom">Custom</option>
      </select>

      {monster && kind === "monster" && <MonsterSearch campaignId={campaignId} encounterId={encounterId} />}
      {party && kind === "pc" && (
        <>
          <select value={pcPick} onChange={(e) => setPcPick(e.target.value)} className="input-hall h-9 min-w-[160px] flex-1 text-[12px]">
            <option value="">Choose a hero…</option>
            {availableChars.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button onClick={addIt} disabled={!pcPick || add.isPending} className="btn-base btn-gold clip-octagon h-9 px-4 text-[12px]">
            <IconPlus size={13} /> Summon member
          </button>
          <button
            onClick={() => summonParty()}
            disabled={availableChars.length === 0 || add.isPending}
            title="Add every hero not already in the fight, all at once"
            className="btn-base btn-wax h-9 px-4 text-[12px] disabled:opacity-40"
          >
            <IconPlus size={13} /> Summon all
          </button>
          {(parties ?? []).length > 0 && (
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) summonParty(e.target.value);
              }}
              aria-label="Summon one party"
              title="Add everyone riding with one party, all at once"
              className="input-hall h-9 w-[150px] text-[12px]"
            >
              <option value="">…or one party</option>
              {(parties ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </>
      )}
      {party && kind === "ally" && (
        <>
          <select value={allyPick} onChange={(e) => setAllyPick(e.target.value)} className="input-hall h-9 min-w-[160px] flex-1 text-[12px]">
            <option value="">Choose a traveler…</option>
            {availableAllies.map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
          <button onClick={addIt} disabled={!allyPick || add.isPending} className="btn-base btn-gold clip-octagon h-9 px-4 text-[12px]">
            <IconPlus size={13} /> Call them in
          </button>
        </>
      )}
      {kind === "custom" && (
        <>
          <input value={custom.label} onChange={(e) => setCustom({ ...custom, label: e.target.value })} placeholder="Name" className="input-hall h-9 min-w-[120px] flex-1 text-[12px]" />
          <input value={custom.hpMax} onChange={(e) => setCustom({ ...custom, hpMax: e.target.value.replace(/\D/g, "") })} placeholder="HP" className="input-hall h-9 w-14 text-center text-[12px]" />
          <input value={custom.ac} onChange={(e) => setCustom({ ...custom, ac: e.target.value.replace(/\D/g, "") })} placeholder="AC" className="input-hall h-9 w-14 text-center text-[12px]" />
          <input value={custom.initMod} onChange={(e) => setCustom({ ...custom, initMod: e.target.value.replace(/[^\d-]/g, "") })} placeholder="+init" className="input-hall h-9 w-14 text-center text-[12px]" />
          <button onClick={addIt} disabled={!custom.label.trim() || add.isPending} className="btn-base btn-gold clip-octagon h-9 px-4 text-[12px]">
            <IconPlus size={13} /> Add
          </button>
        </>
      )}
    </div>
  );
}
