import { useMemo, useState } from "react";
import type { AbilityScores, Character, LevelUpRequest } from "../api/client";
import { useCharacterDetail, useCodex, useLevelUp, useRules } from "../hooks";
import {
  casterSourceFor,
  castingFor,
  maxSpellLevel,
  spellOnClassList,
  type CasterData,
} from "../lib/spellcasting";
import { abilityMod } from "../lib/abilities";
import ParchmentModal from "./ui/ParchmentModal";
import SpellHover from "./ui/SpellHover";
import SpellSwapModal, { canSwapOn, type Swap } from "./ui/SpellSwapModal";
import { Blocks } from "./ui/SpellEntry";

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

  /*
    Which class takes this level (#190).

    Defaults to the one they started as, which for almost every hero is the
    only one they have — the picker below only appears once there is a choice
    to make. Everything after this reads the CHOSEN class: its hit die, its
    subclass level, its ASI levels, all indexed by the hero's level in that
    class rather than their total (PHB 2024, p.44).
  */
  const held = sheet.classes ?? [];
  const [takingIn, setTakingIn] = useState<string>(sheet.classId ?? "");
  const klass = classes?.find((c) => c.id === takingIn);
  const classData = klass?.data as
    | {
        hitDie?: number;
        subclassLevel?: number;
        asiLevels?: number[];
        features?: Feature[];
        primaryAbility?: string[];
        multiclass?: { prerequisite?: { any?: string[]; all?: string[] }; proficiencies?: string[] };
      }
    | undefined;

  const newLevel = character.level + 1;
  // The level in the chosen class — 1 when it is a class they do not yet hold.
  const classLevel = (held.find((k) => k.classId === takingIn)?.level ?? 0) + 1;
  const hitDie = classData?.hitDie ?? 8;
  const subclassLevel = classData?.subclassLevel ?? 3;
  const asiLevels = classData?.asiLevels?.length ? classData.asiLevels : [4, 8, 12, 16, 19];
  const needsSubclass = classLevel === subclassLevel;
  const isASILevel = asiLevels.includes(classLevel);

  // Every class the hero could put this level into: the ones they hold, plus
  // any whose prerequisite they meet. The server checks this again — this is
  // so the list does not offer a door that will be shut in their face.
  const openClasses = useMemo(() => {
    const scores = sheet.abilities as unknown as Record<string, number>;
    const meets = (r: { data: unknown }) => {
      const d = r.data as {
        primaryAbility?: string[];
        multiclass?: { prerequisite?: { any?: string[]; all?: string[] } };
      };
      const any = d.multiclass?.prerequisite?.any ?? [];
      const all = d.multiclass?.prerequisite?.all ?? (any.length ? [] : d.primaryAbility ?? []);
      const at13 = (a: string) => (scores[a.slice(0, 3).toLowerCase()] ?? 0) >= 13;
      if (any.length) return any.some(at13);
      return all.every(at13);
    };
    // Multiclassing also asks it of what they already are.
    const currentHold = held.every((k) => {
      const entry = classes?.find((c) => c.id === k.classId);
      return entry ? meets(entry) : true;
    });
    return (classes ?? []).filter((c) => {
      if (held.some((k) => k.classId === c.id)) return true;
      return currentHold && meets(c) && codexLegal(c);
    });
  }, [classes, held, sheet.abilities, codexLegal]);

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
        // Origin feats come from backgrounds; the ASI feat is the "Abilities"
        // choice next door; epic boons wait for level 19.
        if (d.category === "origin" || f.name === "Ability Score Improvement") return false;
        if (d.category === "epic-boon" && newLevel < 19) return false;
        return !sheet.feats?.includes(f.name) && codexLegal(f);
      }),
    [feats, sheet.feats, codexLegal, newLevel],
  );

  // Bard, Sorcerer and Warlock trade a spell as they rise rather than on a
  // Long Rest; the trade has to travel with the level-up itself.
  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [swapping, setSwapping] = useState(false);

  // Spell picks: additions allowed up to the new level's caps. The casting may
  // ride on the subclass rather than the class — held already, or being chosen
  // this very level: an Eldritch Knight picks Wizard cantrips in the same
  // breath as the subclass (#220).
  const heldSubclassId = held.find((k) => k.classId === takingIn)?.subclassId;
  const subEntry = classSubclasses.find((s) => s.id === (subclassId || heldSubclassId));
  const casterSource = casterSourceFor(klass, subEntry);
  const casting = castingFor(casterSource?.data as CasterData | undefined);
  const casterKind = (casterSource?.data as CasterData | undefined)?.spellcaster ?? "";
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
        spellOnClassList(s, casterSource) &&
        codexLegal(s)
      );
    });
  }, [casting, casterKind, newLevel, allSpells, ownedSpellIds, casterSource, codexLegal]);
  const pickedNewCantrips = newSpellIds.filter(
    (id) => ((allSpells ?? []).find((s) => s.id === id)?.data as { level?: number })?.level === 0,
  ).length;
  const pickedNewLeveled = newSpellIds.length - pickedNewCantrips;
  const cantripRoom = casting ? Math.max(casting.cantrips[newLevel - 1] - ownedCantrips, 0) : 0;
  const preparedRoom = casting ? Math.max(casting.prepared[newLevel - 1] - ownedLeveled, 0) : 0;

  // What this level grants, from class + chosen subclass data. Indexed by the
  // level in THIS class, not the hero's total — a Rogue 5 taking their first
  // Wizard level gets Wizard 1's features (#190).
  const gained: Feature[] = useMemo(() => {
    const own = (classData?.features ?? []).filter((f) => f.level === classLevel);
    const heldSubclass = held.find((k) => k.classId === takingIn)?.subclassId;
    const sub = classSubclasses.find((s) => s.id === (subclassId || heldSubclass));
    const subFeatures = sub
      ? ((sub.data as { features?: Feature[] }).features ?? []).filter((f) => f.level === classLevel)
      : [];
    return [...own, ...subFeatures];
  }, [classData, classLevel, classSubclasses, subclassId, held, takingIn]);

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
    // Always named, even when there is only one: the server would guess right,
    // but a level going into the wrong class is not a mistake worth risking on
    // an inference (#190).
    if (takingIn) body.classId = takingIn;
    if (hpMode === "roll") body.hpRoll = hpRoll;
    if (needsSubclass) body.subclassId = subclassId;
    if (newSpellIds.length > 0) body.spells = newSpellIds;
    if (swaps.length > 0) body.spellSwaps = swaps;
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
        {/* Which class takes the level. Hidden when there is nothing to
            choose — a hero with one class and no door open to a second sees
            the level-up they always saw. */}
        {openClasses.length > 1 && (
          <label className="block">
            <span className="field-label mb-1.5 block">This level goes to</span>
            <select
              value={takingIn}
              onChange={(e) => {
                setTakingIn(e.target.value);
                // The new class has its own subclass level and ASI levels, so
                // anything chosen against the old one is no longer an answer.
                setSubclassId("");
                setFeatId("");
                setNewSpellIds([]);
              }}
              className="input-parchment input-compact w-full cursor-pointer"
            >
              {openClasses.map((c) => {
                const have = held.find((k) => k.classId === c.id);
                return (
                  <option key={c.id} value={c.id}>
                    {c.name} {have ? `${have.level} → ${have.level + 1}` : "— a new calling"}
                  </option>
                );
              })}
            </select>
            {!held.some((k) => k.classId === takingIn) && (
              <div className="font-body mt-1.5 text-[12px] italic text-ink-faded">
                Multiclassing. You gain {klass?.name}'s level 1 features and only
                part of its starting proficiencies — your total level is what
                sets your proficiency bonus.
                {(classData?.multiclass?.proficiencies ?? []).length > 0 && (
                  <>
                    {" "}
                    From {klass?.name} you gain its hit die,{" "}
                    {(classData?.multiclass?.proficiencies ?? [])
                      .map((p) => p.toLowerCase())
                      .join(", ")}
                    .
                  </>
                )}
              </div>
            )}
          </label>
        )}

        {gained.length > 0 && (
          <div>
            <div className="field-label mb-1.5">
              Gained at {klass?.name} level {classLevel}
            </div>
            <div className="flex max-h-64 flex-col gap-2.5 overflow-y-auto pr-1">
              {gained.map((f, i) => (
                <div key={i} className="text-[13px]">
                  <span className="font-heading font-bold">{f.name}</span>
                  {f.summary && (
                    <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-body">
                      <Blocks text={f.summary} />
                    </div>
                  )}
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
                  <SpellHover key={s.id} spell={s}>
                  <button
                    type="button"
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
                        : "rgba(120,86,42,.13)",
                      color: active ? "#f3d9c0" : "#4a3620",
                      boxShadow: `inset 0 0 0 1px ${active ? "#3f0f0e" : "rgba(120,80,30,.45)"}`,
                    }}
                  >
                    {lvl === 0 ? "◦ " : ""}
                    {s.name}
                  </button>
                  </SpellHover>
                );
              })}
            </div>
          </div>
        )}

        {/* a spell traded on the way up — Bard, Sorcerer, Warlock */}
        {canSwapOn(casterSource, "level-up") && (detail?.spells ?? []).length > 0 && (
          <div>
            <div className="field-label mb-1.5">
              Change a known spell
              <span className="ml-2 font-normal normal-case tracking-normal text-ink-label">
                optional
              </span>
            </div>
            {swaps.length > 0 ? (
              <div className="flex flex-col gap-1">
                {swaps.map((sw) => {
                  const out = (detail?.spells ?? []).find((x) => x.id === sw.replace);
                  const inn = (allSpells ?? []).find((x) => x.id === sw.with);
                  return (
                    <div key={sw.replace} className="text-[12.5px] text-ink-body">
                      <span className="line-through">{out?.name}</span>
                      {" → "}
                      <strong className="font-heading text-ink">{inn?.name}</strong>
                      <button
                        type="button"
                        onClick={() => setSwaps((prev) => prev.filter((p) => p.replace !== sw.replace))}
                        className="label-stamp ml-2 cursor-pointer border-none bg-transparent p-0 text-[9px] tracking-[1px] text-[#8b2520] underline"
                      >
                        Undo
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSwapping(true)}
                className="label-stamp cursor-pointer rounded-[2px] border-none px-2.5 py-1.5 text-[10px] tracking-[1px]"
                style={{
                  background: "rgba(120,86,42,.13)",
                  color: "#4a3620",
                  boxShadow: "inset 0 0 0 1px rgba(120,80,30,.45)",
                }}
              >
                Trade a spell
              </button>
            )}
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
                  {generalFeats.map((f) => {
                    const cat = (f.data as { category?: string }).category;
                    const tag =
                      cat === "fighting-style"
                        ? " — fighting style"
                        : cat === "epic-boon"
                          ? " — epic boon"
                          : "";
                    return (
                      <option key={f.id} value={f.id}>
                        {f.name}
                        {tag}
                        {f.source === "homebrew" ? ` (homebrew · ${f.creatorName ?? "?"})` : ""}
                      </option>
                    );
                  })}
                </select>
                {featId &&
                  (() => {
                    const feat = generalFeats.find((f) => f.id === featId);
                    const d = (feat?.data ?? {}) as {
                      prerequisite?: string;
                      description?: string;
                    };
                    return (
                      <div className="mt-1.5">
                        {d.prerequisite && (
                          <p className="font-body m-0 text-[12px] italic text-ink-label">
                            Prerequisite: {d.prerequisite}
                          </p>
                        )}
                        <p className="font-body m-0 mt-0.5 text-[12.5px] italic text-ink-body">
                          {feat?.summary}
                        </p>
                        {d.description && (
                          <div className="mt-1.5 max-h-44 overflow-y-auto pr-1 text-[12px] leading-relaxed text-ink-body">
                            <Blocks text={d.description} />
                          </div>
                        )}
                      </div>
                    );
                  })()}
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
      {swapping && (
        <SpellSwapModal
          klass={casterSource}
          known={detail?.spells ?? []}
          library={allSpells ?? []}
          characterLevel={newLevel}
          trigger="level-up"
          onClose={() => setSwapping(false)}
          onConfirm={(picked) => {
            setSwaps(picked);
            setSwapping(false);
          }}
        />
      )}
    </ParchmentModal>
  );
}
