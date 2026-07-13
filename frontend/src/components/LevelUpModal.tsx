import { useMemo, useState } from "react";
import type { AbilityScores, Character, LevelUpRequest } from "../api/client";
import { useCharacterDetail, useCodex, useLevelUp, useRules } from "../hooks";
import { castingFor, maxSpellLevel, type CasterData } from "../lib/spellcasting";
import { abilityMod } from "./ui/AbilityRow";
import ParchmentModal from "./ui/ParchmentModal";

/**
 * One level, gained: HP by average or roll, subclass at the class's subclass
 * level, ability increases or a feat at ASI levels. Driven entirely by rules
 * content, so homebrew classes level up the same way SRD ones do.
 */

type AbilityKey = keyof AbilityScores;
const ABILITIES: Array<[AbilityKey, string]> = [
  ["str", "STR"], ["dex", "DEX"], ["con", "CON"],
  ["int", "INT"], ["wis", "WIS"], ["cha", "CHA"],
];

interface Feature {
  level?: number;
  name?: string;
  summary?: string;
}

const input = "input-parchment input-compact";

export default function LevelUpModal({
  character,
  onClose,
}: {
  character: Character;
  onClose: () => void;
}) {
  const { data: classes } = useRules("class");
  const { data: subclasses } = useRules("subclass");
  const { data: feats } = useRules("feat");
  // Seated heroes choose only what the campaign's codex has ruled legal.
  const { data: codex } = useCodex(character.campaignId ?? undefined);
  const { data: allSpells } = useRules("spell");
  const { data: detail } = useCharacterDetail(character.id);
  const levelUp = useLevelUp();

  const codexLegal = useMemo(() => {
    if (!character.campaignId) return () => true;
    const status = new Map((codex ?? []).map((e) => [e.content.id, e.status]));
    return (r: { id: string; source: string }) =>
      r.source === "srd"
        ? status.get(r.id) !== "banned"
        : status.get(r.id) === "enabled";
  }, [character.campaignId, codex]);

  const sheet = character.sheet!;
  const klass = classes?.find((c) => c.id === sheet.classId);
  const classData = klass?.data as
    | { hitDie?: number; subclassLevel?: number; asiLevels?: number[]; features?: Feature[] }
    | undefined;

  const newLevel = character.level + 1;
  const hitDie = classData?.hitDie ?? 8;
  const subclassLevel = classData?.subclassLevel ?? 3;
  const asiLevels = classData?.asiLevels?.length ? classData.asiLevels : [4, 8, 12, 16, 19];
  const needsSubclass = newLevel === subclassLevel;
  const isASILevel = asiLevels.includes(newLevel);

  const [hpMode, setHpMode] = useState<"average" | "roll">("average");
  const [hpRoll, setHpRoll] = useState(0);
  const [subclassId, setSubclassId] = useState("");
  const [asiChoice, setAsiChoice] = useState<"asi" | "feat">("asi");
  const [bonus2, setBonus2] = useState<AbilityKey | "">("");
  const [bonus1a, setBonus1a] = useState<AbilityKey | "">("");
  const [bonus1b, setBonus1b] = useState<AbilityKey | "">("");
  const [asiMode, setAsiMode] = useState<"2" | "1/1">("2");
  const [featId, setFeatId] = useState("");
  const [newSpellIds, setNewSpellIds] = useState<string[]>([]);

  const classSubclasses = useMemo(
    () =>
      (subclasses ?? []).filter((s) => {
        const d = s.data as { class?: string };
        return d.class?.toLowerCase() === klass?.name.toLowerCase() && codexLegal(s);
      }),
    [subclasses, klass, codexLegal],
  );
  const generalFeats = useMemo(
    () =>
      (feats ?? []).filter((f) => {
        const d = f.data as { category?: string };
        return d.category !== "origin" && !sheet.feats?.includes(f.name) && codexLegal(f);
      }),
    [feats, sheet.feats, codexLegal],
  );

  // Spell picks: additions allowed up to the new level's caps.
  const casting = castingFor(klass?.data as CasterData | undefined);
  const casterKind = (klass?.data as CasterData | undefined)?.spellcaster ?? "";
  const ownedSpellIds = useMemo(
    () => new Set((detail?.spells ?? []).map((s) => s.id)),
    [detail],
  );
  const ownedCantrips = (detail?.spells ?? []).filter(
    (s) => (s.data as { level?: number }).level === 0,
  ).length;
  const ownedLeveled = (detail?.spells ?? []).length - ownedCantrips;
  const spellChoices = useMemo(() => {
    if (!casting) return [];
    const maxLvl = maxSpellLevel(casterKind, newLevel);
    return (allSpells ?? []).filter((s) => {
      const d = s.data as { classes?: string[]; level?: number };
      const lvl = d.level ?? 99;
      return (
        !ownedSpellIds.has(s.id) &&
        (lvl === 0 || lvl <= maxLvl) &&
        (d.classes ?? []).some((c) => c.toLowerCase() === klass?.name.toLowerCase()) &&
        codexLegal(s)
      );
    });
  }, [casting, casterKind, newLevel, allSpells, ownedSpellIds, klass, codexLegal]);
  const pickedNewCantrips = newSpellIds.filter(
    (id) => ((allSpells ?? []).find((s) => s.id === id)?.data as { level?: number })?.level === 0,
  ).length;
  const pickedNewLeveled = newSpellIds.length - pickedNewCantrips;
  const cantripRoom = casting ? Math.max(casting.cantrips[newLevel - 1] - ownedCantrips, 0) : 0;
  const preparedRoom = casting ? Math.max(casting.prepared[newLevel - 1] - ownedLeveled, 0) : 0;

  // What this level grants, from class + chosen subclass data.
  const gained: Feature[] = useMemo(() => {
    const own = (classData?.features ?? []).filter((f) => f.level === newLevel);
    const sub = classSubclasses.find((s) => s.id === (subclassId || sheet.subclassId));
    const subFeatures = sub
      ? ((sub.data as { features?: Feature[] }).features ?? []).filter((f) => f.level === newLevel)
      : [];
    return [...own, ...subFeatures];
  }, [classData, newLevel, classSubclasses, subclassId, sheet.subclassId]);

  const conMod = abilityMod(
    sheet.abilities.con +
      (asiChoice === "asi"
        ? (asiMode === "2" ? (bonus2 === "con" ? 2 : 0) : (bonus1a === "con" ? 1 : 0) + (bonus1b === "con" ? 1 : 0))
        : 0),
  );
  const hpGain = Math.max((hpMode === "average" ? Math.floor(hitDie / 2) + 1 : hpRoll) + conMod, 1);

  const asiValid =
    !isASILevel ||
    (asiChoice === "feat"
      ? !!featId
      : asiMode === "2"
        ? !!bonus2
        : !!bonus1a && !!bonus1b && bonus1a !== bonus1b);
  const valid =
    (hpMode === "average" || (hpRoll >= 1 && hpRoll <= hitDie)) &&
    (!needsSubclass || !!subclassId) &&
    asiValid;

  function submit() {
    const body: LevelUpRequest = { hpMode };
    if (hpMode === "roll") body.hpRoll = hpRoll;
    if (needsSubclass) body.subclassId = subclassId;
    if (newSpellIds.length > 0) body.spells = newSpellIds;
    if (isASILevel) {
      if (asiChoice === "feat") {
        body.featId = featId;
      } else if (asiMode === "2") {
        body.asi = { [bonus2 as string]: 2 };
      } else {
        body.asi = { [bonus1a as string]: 1, [bonus1b as string]: 1 };
      }
    }
    levelUp.mutate({ characterId: character.id, body }, { onSuccess: onClose });
  }

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[560px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
        {character.name}
      </div>
      <h3 className="font-display m-0 mb-1 text-center text-2xl font-bold text-ink">
        Level {character.level} → {newLevel}
      </h3>
      <div className="font-accent mb-5 text-center text-[13px] italic text-ink-body">
        {klass?.name ?? "…"} · d{hitDie} hit die
      </div>

      <div className="flex flex-col gap-5 text-ink-strong">
        {/* what the level grants */}
        {gained.length > 0 && (
          <div>
            <div className="field-label mb-1.5">Gained at level {newLevel}</div>
            <div className="flex flex-col gap-1.5">
              {gained.map((f, i) => (
                <div key={i} className="text-[13px]">
                  <span className="font-heading font-bold">{f.name}</span>
                  {f.summary && <span className="text-ink-body"> — {f.summary}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* HP */}
        <div>
          <div className="field-label mb-1.5">Hit points</div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setHpMode("average")}
              className={`btn-base px-4 py-2 text-[10.5px] ${hpMode === "average" ? "btn-wax" : "btn-ghost-ink"}`}
            >
              Average ({Math.floor(hitDie / 2) + 1})
            </button>
            <button
              type="button"
              onClick={() => setHpMode("roll")}
              className={`btn-base px-4 py-2 text-[10.5px] ${hpMode === "roll" ? "btn-wax" : "btn-ghost-ink"}`}
            >
              I rolled the die
            </button>
            {hpMode === "roll" && (
              <input
                type="number"
                min={1}
                max={hitDie}
                placeholder={`1-${hitDie}`}
                className={`${input} w-20`}
                value={hpRoll === 0 ? "" : hpRoll}
                onChange={(e) => setHpRoll(e.target.value === "" ? 0 : Number(e.target.value))}
              />
            )}
            <span className="label-stamp text-[10px] tracking-[1px] text-ink-label">
              +{hpGain} HP (incl. CON {conMod >= 0 ? `+${conMod}` : conMod})
            </span>
          </div>
        </div>

        {/* new spells */}
        {casting && (cantripRoom > 0 || preparedRoom > 0) && spellChoices.length > 0 && (
          <div>
            <div className="field-label mb-1.5">
              New spells at level {newLevel}
              <span className="ml-2 font-normal normal-case tracking-normal text-ink-label">
                {cantripRoom > 0 && `cantrips ${pickedNewCantrips}/${cantripRoom} · `}
                spells {pickedNewLeveled}/{preparedRoom}
              </span>
            </div>
            <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto pr-1">
              {spellChoices.map((s) => {
                const lvl = (s.data as { level?: number }).level ?? 0;
                const active = newSpellIds.includes(s.id);
                const atCap =
                  lvl === 0
                    ? pickedNewCantrips >= cantripRoom
                    : pickedNewLeveled >= preparedRoom;
                return (
                  <button
                    key={s.id}
                    type="button"
                    title={s.summary}
                    onClick={() =>
                      setNewSpellIds((prev) =>
                        active
                          ? prev.filter((id) => id !== s.id)
                          : atCap
                            ? prev
                            : [...prev, s.id],
                      )
                    }
                    className={`label-stamp cursor-pointer rounded-[2px] border-none px-2.5 py-1.5 text-[10px] tracking-[1px] ${
                      !active && atCap ? "opacity-45" : ""
                    }`}
                    style={{
                      background: active
                        ? "linear-gradient(180deg,#8b2520,#5e1611)"
                        : "rgba(16,9,5,.4)",
                      color: active ? "#f3d9c0" : "#cdba93",
                      boxShadow: `inset 0 0 0 1px ${active ? "#3f0f0e" : "rgba(201,162,39,.3)"}`,
                    }}
                  >
                    {lvl === 0 ? "◦ " : ""}
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* subclass */}
        {needsSubclass && (
          <div>
            <div className="field-label mb-1.5">Choose a subclass</div>
            <select
              className={`${input} w-full cursor-pointer`}
              value={subclassId}
              onChange={(e) => setSubclassId(e.target.value)}
            >
              <option value="">—</option>
              {classSubclasses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.source === "homebrew" ? ` (homebrew · ${s.creatorName ?? "?"})` : ""}
                </option>
              ))}
            </select>
            {subclassId && (
              <p className="font-body m-0 mt-1.5 text-[12.5px] italic text-ink-body">
                {classSubclasses.find((s) => s.id === subclassId)?.summary}
              </p>
            )}
          </div>
        )}

        {/* ASI / feat */}
        {isASILevel && (
          <div>
            <div className="field-label mb-1.5">Ability increase or feat</div>
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() => setAsiChoice("asi")}
                className={`btn-base px-4 py-2 text-[10.5px] ${asiChoice === "asi" ? "btn-wax" : "btn-ghost-ink"}`}
              >
                Abilities
              </button>
              <button
                type="button"
                onClick={() => setAsiChoice("feat")}
                className={`btn-base px-4 py-2 text-[10.5px] ${asiChoice === "feat" ? "btn-wax" : "btn-ghost-ink"}`}
              >
                A feat
              </button>
            </div>
            {asiChoice === "asi" ? (
              <div className="flex flex-wrap items-center gap-3">
                <select
                  className={`${input} w-36 cursor-pointer`}
                  value={asiMode}
                  onChange={(e) => setAsiMode(e.target.value as "2" | "1/1")}
                >
                  <option value="2">+2 to one</option>
                  <option value="1/1">+1 to two</option>
                </select>
                {asiMode === "2" ? (
                  <select
                    className={`${input} w-28 cursor-pointer`}
                    value={bonus2}
                    onChange={(e) => setBonus2(e.target.value as AbilityKey)}
                  >
                    <option value="">+2 to…</option>
                    {ABILITIES.map(([k, label]) => (
                      <option key={k} value={k} disabled={sheet.abilities[k] + 2 > 20}>
                        {label} ({sheet.abilities[k]})
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    {[
                      [bonus1a, setBonus1a, bonus1b],
                      [bonus1b, setBonus1b, bonus1a],
                    ].map(([value, setter, other], i) => (
                      <select
                        key={i}
                        className={`${input} w-28 cursor-pointer`}
                        value={value as string}
                        onChange={(e) =>
                          (setter as (v: AbilityKey) => void)(e.target.value as AbilityKey)
                        }
                      >
                        <option value="">+1 to…</option>
                        {ABILITIES.map(([k, label]) => (
                          <option
                            key={k}
                            value={k}
                            disabled={k === other || sheet.abilities[k] + 1 > 20}
                          >
                            {label} ({sheet.abilities[k]})
                          </option>
                        ))}
                      </select>
                    ))}
                  </>
                )}
              </div>
            ) : (
              <div>
                <select
                  className={`${input} w-full cursor-pointer`}
                  value={featId}
                  onChange={(e) => setFeatId(e.target.value)}
                >
                  <option value="">Choose a feat…</option>
                  {generalFeats.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                      {f.source === "homebrew" ? ` (homebrew · ${f.creatorName ?? "?"})` : ""}
                    </option>
                  ))}
                </select>
                {featId && (
                  <p className="font-body m-0 mt-1.5 text-[12.5px] italic text-ink-body">
                    {generalFeats.find((f) => f.id === featId)?.summary}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {levelUp.isError && (
          <p className="font-body m-0 text-sm italic text-[#8b2520]">
            {(levelUp.error as { error?: string } | null)?.error ??
              "The level would not take — check the choices."}
          </p>
        )}

        <div className="flex items-center justify-end gap-3">
          <button onClick={onClose} className="btn-base btn-ghost-ink px-5 py-[11px] text-xs">
            Not yet
          </button>
          <button
            onClick={submit}
            disabled={!valid || levelUp.isPending}
            className="btn-base btn-gold clip-octagon h-11 px-6 text-sm"
          >
            {levelUp.isPending ? "Rising…" : `Rise to Level ${newLevel}`}
          </button>
        </div>
      </div>
    </ParchmentModal>
  );
}
