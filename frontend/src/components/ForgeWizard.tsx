import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AbilityScores, RulesContent } from "../api/client";
import { useForgeCharacter, useRules } from "../hooks";
import AbilityRow, { abilityMod, modText } from "./ui/AbilityRow";

/**
 * The Forge: the 2024 creation flow at level 1.
 * Class (+skills) → Background (+bonuses) → Species → Abilities → Name.
 * Everything is driven by the rules content — no hardcoded classes.
 */

type AbilityKey = keyof AbilityScores;
const ABILITIES: Array<[AbilityKey, string]> = [
  ["str", "Strength"],
  ["dex", "Dexterity"],
  ["con", "Constitution"],
  ["int", "Intelligence"],
  ["wis", "Wisdom"],
  ["cha", "Charisma"],
];

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const POINT_BUY_BUDGET = 27;
const POINT_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

type Method = "array" | "points" | "manual";
type BonusMode = "2/1" | "1/1/1";

const STEPS = ["Class", "Background", "Species", "Abilities", "Name"] as const;

function OptionCard({
  entry,
  selected,
  onPick,
  facts,
}: {
  entry: RulesContent;
  selected: boolean;
  onPick: () => void;
  facts: string;
}) {
  return (
    <button
      onClick={onPick}
      className="parchment cursor-pointer px-4 pb-3.5 pt-3 text-left transition hover:-translate-y-0.5"
      style={
        selected
          ? { boxShadow: "0 0 0 2.5px #8b2520, 0 14px 26px rgba(0,0,0,.5)" }
          : undefined
      }
    >
      <div className="font-display text-[16px] font-bold text-ink">
        {entry.name}
        {entry.source === "homebrew" && (
          <span className="label-stamp ml-2 text-[8.5px] tracking-[1px] text-ink-label">
            Homebrew
          </span>
        )}
      </div>
      <div className="label-stamp mt-0.5 text-[9px] tracking-[1px] text-ink-label">
        {facts}
      </div>
      <p className="font-body m-0 mt-1.5 text-[12.5px] italic leading-snug text-ink-body">
        {entry.summary}
      </p>
    </button>
  );
}

export default function ForgeWizard() {
  const navigate = useNavigate();
  const { data: classes } = useRules("class");
  const { data: species } = useRules("species");
  const { data: backgrounds } = useRules("background");
  const forge = useForgeCharacter();

  const [step, setStep] = useState(0);
  const [classId, setClassId] = useState<string>("");
  const [skills, setSkills] = useState<string[]>([]);
  const [backgroundId, setBackgroundId] = useState<string>("");
  const [speciesId, setSpeciesId] = useState<string>("");
  const [method, setMethod] = useState<Method>("array");
  // 0 = unassigned (standard array only); point buy / manual start at 8.
  const [base, setBase] = useState<Record<AbilityKey, number>>({
    str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
  });
  const [bonusMode, setBonusMode] = useState<BonusMode>("2/1");
  const [bonus2, setBonus2] = useState<AbilityKey | "">("");
  const [bonus1, setBonus1] = useState<AbilityKey | "">("");
  const [name, setName] = useState("");

  const chosenClass = classes?.find((c) => c.id === classId);
  const chosenBackground = backgrounds?.find((b) => b.id === backgroundId);
  const chosenSpecies = species?.find((s) => s.id === speciesId);

  const classData = chosenClass?.data as
    | { hitDie?: number; saves?: string[]; skillChoices?: { choose: number; from: string[] }; features?: Array<{ name: string; summary: string }> }
    | undefined;
  const bgData = chosenBackground?.data as
    | { abilityScores?: string[]; feat?: string; skills?: string[]; tool?: string }
    | undefined;
  const spData = chosenSpecies?.data as
    | { size?: string; speed?: number; traits?: Array<{ name: string; summary: string }> }
    | undefined;

  const skillChoose = classData?.skillChoices?.choose ?? 0;
  const skillFrom = classData?.skillChoices?.from ?? [];
  const wildcardSkills = skillFrom.length === 1 && skillFrom[0] === "*";
  const skillOptions = wildcardSkills
    ? ["Acrobatics", "Animal Handling", "Arcana", "Athletics", "Deception", "History", "Insight", "Intimidation", "Investigation", "Medicine", "Nature", "Perception", "Performance", "Persuasion", "Religion", "Sleight of Hand", "Stealth", "Survival"]
    : skillFrom;
  const bgSkills = bgData?.skills ?? [];
  const bgAbilities = (bgData?.abilityScores ?? []).map((a) => a.toLowerCase()) as AbilityKey[];

  // Final scores = base + background bonuses (unassigned scores stay blank).
  const finalScores: AbilityScores = useMemo(() => {
    const out = { ...base } as Record<AbilityKey, number>;
    const add = (k: AbilityKey, n: number) => {
      if (out[k] > 0) out[k] = Math.min(out[k] + n, 20);
    };
    if (bonusMode === "1/1/1") {
      for (const a of bgAbilities) add(a, 1);
    } else {
      if (bonus2) add(bonus2, 2);
      if (bonus1) add(bonus1, 1);
    }
    return out as AbilityScores;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, bonusMode, bonus2, bonus1, backgroundId]);

  const pointsSpent = ABILITIES.reduce(
    (sum, [k]) => sum + (base[k] === 0 ? 0 : (POINT_COST[base[k]] ?? 99)),
    0,
  );
  const arrayValid =
    [...STANDARD_ARRAY].sort((a, b) => a - b).join() ===
    ABILITIES.map(([k]) => base[k]).sort((a, b) => a - b).join();

  const abilitiesValid =
    (method === "array" ? arrayValid : true) &&
    (method === "points" ? pointsSpent <= POINT_BUY_BUDGET && ABILITIES.every(([k]) => base[k] >= 8 && base[k] <= 15) : true) &&
    (method === "manual" ? ABILITIES.every(([k]) => base[k] >= 3 && base[k] <= 18) : true) &&
    (bonusMode === "1/1/1" || (bonus2 !== "" && bonus1 !== "" && bonus2 !== bonus1));

  // Picking a background can retract an earlier class-skill pick (it now grants
  // that skill), so the last step re-checks everything, not just the name.
  const skillsValid = !!classId && skills.length === skillChoose;
  const allValid = skillsValid && !!backgroundId && !!speciesId && abilitiesValid;
  const stepValid = [
    skillsValid,
    !!backgroundId,
    !!speciesId,
    abilitiesValid,
    name.trim().length > 0 && allValid,
  ][step];

  const hitDie = classData?.hitDie ?? 0;
  const hp = Math.max(hitDie + abilityMod(finalScores.con), 1);

  // Assign a standard-array value; if another ability already holds it,
  // that ability is cleared — each value is used exactly once.
  function assignArrayScore(key: AbilityKey, value: number) {
    setBase((prev) => {
      const next = { ...prev, [key]: value };
      if (value !== 0) {
        for (const [k] of ABILITIES) {
          if (k !== key && next[k] === value) next[k] = 0;
        }
      }
      return next;
    });
  }

  function toggleSkill(sk: string) {
    setSkills((prev) =>
      prev.includes(sk)
        ? prev.filter((s) => s !== sk)
        : prev.length < skillChoose
          ? [...prev, sk]
          : prev,
    );
  }

  function submit() {
    forge.mutate(
      {
        name: name.trim(),
        classId,
        speciesId,
        backgroundId,
        abilities: finalScores,
        skills,
      },
      { onSuccess: () => navigate("/questboard/heroes") },
    );
  }

  const input = "input-parchment input-compact";

  return (
    <div className="panel-hall px-5 sm:px-[30px] pb-10 pt-8">
      {/* header + step rail */}
      <div
        className="mb-6 flex flex-wrap items-center justify-between gap-4 pb-3.5"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <h2
          className="font-display m-0 text-[clamp(24px,3vw,32px)] font-black text-[#e7d3a6]"
          style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
        >
          The Forge
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {STEPS.map((s, i) => (
            <span key={s} className="flex items-center gap-1.5">
              <button
                onClick={() => i < step && setStep(i)}
                disabled={i > step}
                className={`label-stamp border-none bg-transparent text-[10px] font-semibold tracking-[1.5px] ${
                  i === step
                    ? "text-ember-bright"
                    : i < step
                      ? "cursor-pointer text-gold-hair"
                      : "text-gold-muted opacity-60"
                }`}
              >
                {s}
              </button>
              {i < STEPS.length - 1 && <span className="text-gold-muted">·</span>}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.8fr)_minmax(280px,1fr)]">
        {/* step content */}
        <div>
          {step === 0 && (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {(classes ?? []).map((c) => {
                  const d = c.data as { hitDie?: number; saves?: string[] };
                  return (
                    <OptionCard
                      key={c.id}
                      entry={c}
                      selected={c.id === classId}
                      onPick={() => {
                        if (c.id !== classId) setSkills([]);
                        setClassId(c.id);
                      }}
                      facts={`d${d.hitDie ?? "?"} · saves ${(d.saves ?? []).join("/")}`}
                    />
                  );
                })}
              </div>
              {chosenClass && (
                <div className="mt-5">
                  <div className="label-stamp mb-2 text-[10px] tracking-[2px] text-gold-muted">
                    {chosenClass.name} skills — choose {skillChoose}
                    {skills.length > 0 && ` (${skills.length}/${skillChoose})`}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {skillOptions.map((sk) => {
                      const granted = bgSkills.includes(sk);
                      const active = skills.includes(sk);
                      return (
                        <button
                          key={sk}
                          onClick={() => !granted && toggleSkill(sk)}
                          disabled={granted}
                          title={granted ? `Granted by ${chosenBackground?.name}` : undefined}
                          className={`label-stamp cursor-pointer rounded-[2px] border-none px-2.5 py-1.5 text-[10px] tracking-[1px] ${
                            granted ? "cursor-default opacity-50" : ""
                          }`}
                          style={{
                            background: active ? "linear-gradient(180deg,#8b2520,#5e1611)" : "rgba(16,9,5,.4)",
                            color: active ? "#f3d9c0" : "#cdba93",
                            boxShadow: `inset 0 0 0 1px ${active ? "#3f0f0e" : "rgba(201,162,39,.3)"}`,
                          }}
                        >
                          {sk}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {(backgrounds ?? []).map((b) => {
                const d = b.data as { abilityScores?: string[]; feat?: string; skills?: string[] };
                return (
                  <OptionCard
                    key={b.id}
                    entry={b}
                    selected={b.id === backgroundId}
                    onPick={() => {
                      setBackgroundId(b.id);
                      setBonus2("");
                      setBonus1("");
                      // A new background may grant skills that collide with picks.
                      const granted = (d.skills ?? []);
                      setSkills((prev) => prev.filter((sk) => !granted.includes(sk)));
                    }}
                    facts={`${(d.abilityScores ?? []).join("/")} · ${d.feat ?? ""} · ${(d.skills ?? []).join(", ")}`}
                  />
                );
              })}
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {(species ?? []).map((s) => {
                const d = s.data as { size?: string; speed?: number };
                return (
                  <OptionCard
                    key={s.id}
                    entry={s}
                    selected={s.id === speciesId}
                    onPick={() => setSpeciesId(s.id)}
                    facts={`${d.size ?? "?"} · ${d.speed ?? "?"} ft`}
                  />
                );
              })}
            </div>
          )}

          {step === 3 && (
            <div className="parchment px-6 py-5">
              {/* method tabs */}
              <div className="mb-4 flex gap-2">
                {(
                  [
                    ["array", "Standard Array"],
                    ["points", "Point Buy"],
                    ["manual", "Manual / Rolled"],
                  ] as Array<[Method, string]>
                ).map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => {
                      setMethod(m);
                      const start = m === "array" ? 0 : 8;
                      setBase({ str: start, dex: start, con: start, int: start, wis: start, cha: start });
                    }}
                    className={`btn-base px-4 py-2 text-[10.5px] ${method === m ? "btn-wax" : "btn-ghost-ink"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {method === "points" && (
                <div className="label-stamp mb-3 text-[10px] tracking-[1.5px]" style={{ color: pointsSpent > POINT_BUY_BUDGET ? "#8b2520" : "#9a703a" }}>
                  {POINT_BUY_BUDGET - pointsSpent} points remaining · scores 8–15
                </div>
              )}
              {method === "array" && (
                <div className="label-stamp mb-3 text-[10px] tracking-[1.5px] text-ink-label">
                  Assign 15, 14, 13, 12, 10, 8 — each once
                  {!arrayValid && " (incomplete)"}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {ABILITIES.map(([key, label]) => (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="field-label">{label}</span>
                    {method === "array" ? (
                      <select
                        className={`${input} cursor-pointer`}
                        value={base[key]}
                        onChange={(e) => assignArrayScore(key, Number(e.target.value))}
                      >
                        <option value={0}>—</option>
                        {STANDARD_ARRAY.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="number"
                        min={method === "points" ? 8 : 3}
                        max={method === "points" ? 15 : 18}
                        className={input}
                        value={base[key] === 0 ? "" : base[key]}
                        onChange={(e) =>
                          setBase({
                            ...base,
                            [key]: e.target.value === "" ? 0 : Number(e.target.value),
                          })
                        }
                      />
                    )}
                  </label>
                ))}
              </div>

              {/* background bonuses */}
              {chosenBackground && (
                <div className="mt-5">
                  <div className="label-stamp mb-2 text-[10px] tracking-[2px] text-ink-label">
                    {chosenBackground.name} bonuses — {(bgData?.abilityScores ?? []).join(" / ")}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      className={`${input} w-40 cursor-pointer`}
                      value={bonusMode}
                      onChange={(e) => setBonusMode(e.target.value as BonusMode)}
                    >
                      <option value="2/1">+2 and +1</option>
                      <option value="1/1/1">+1 to all three</option>
                    </select>
                    {bonusMode === "2/1" && (
                      <>
                        <select
                          className={`${input} w-32 cursor-pointer`}
                          value={bonus2}
                          onChange={(e) => setBonus2(e.target.value as AbilityKey)}
                        >
                          <option value="">+2 to…</option>
                          {bgAbilities.map((a) => (
                            <option key={a} value={a} disabled={a === bonus1}>
                              {a.toUpperCase()}
                            </option>
                          ))}
                        </select>
                        <select
                          className={`${input} w-32 cursor-pointer`}
                          value={bonus1}
                          onChange={(e) => setBonus1(e.target.value as AbilityKey)}
                        >
                          <option value="">+1 to…</option>
                          {bgAbilities.map((a) => (
                            <option key={a} value={a} disabled={a === bonus2}>
                              {a.toUpperCase()}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-5">
                <div className="label-stamp mb-2 text-[10px] tracking-[2px] text-ink-label">
                  Final scores
                </div>
                <AbilityRow abilities={finalScores} />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="parchment px-6 py-6">
              <label className="flex flex-col gap-1.5">
                <span className="field-label">The hero's name</span>
                <input
                  className={`${input} font-heading text-base font-semibold`}
                  placeholder="e.g. Seraphine Duskveil"
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </label>
              {!skillsValid && (
                <p className="font-body mt-3 text-sm italic text-[#8b2520]">
                  {chosenBackground?.name ?? "Your background"} already grants{" "}
                  {bgSkills.join(" and ")}, so one of your class skills was
                  returned — step back to Class and choose{" "}
                  {skillChoose - skills.length} more.
                </p>
              )}
              {forge.isError && (
                <p className="font-body mt-3 text-sm italic text-[#8b2520]">
                  {(forge.error as { error?: string } | null)?.error ??
                    "The forge sputtered — check the choices and try again."}
                </p>
              )}
            </div>
          )}

          {/* step nav */}
          <div className="mt-6 flex items-center gap-3">
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
                className="btn-base btn-ghost-ink px-5 py-[11px] text-xs"
                style={{ color: "#cdba93", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.35)", background: "rgba(16,9,5,.4)" }}
              >
                ← Back
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={!stepValid}
                className="btn-base btn-gold clip-octagon h-11 px-6 text-sm"
              >
                Next →
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!stepValid || forge.isPending}
                className="btn-base btn-gold clip-octagon h-11 px-6 text-sm"
              >
                {forge.isPending ? "Forging…" : "Forge the Hero"}
              </button>
            )}
            <Link
              to="/questboard/heroes"
              className="label-stamp ml-auto text-[10px] text-gold-muted no-underline hover:text-ember-bright"
            >
              Abandon the forge
            </Link>
          </div>
        </div>

        {/* summary rail */}
        <div className="panel-hall px-5 pb-6 pt-4" style={{ boxShadow: "inset 0 0 0 1px rgba(201,162,39,.3)" }}>
          <div className="label-stamp mb-3 text-[10px] tracking-[2.5px] text-gold-muted">
            The Hero So Far
          </div>
          <div className="font-display mb-1 text-lg font-bold text-cream">
            {name.trim() || "An unnamed soul"}
          </div>
          <div className="font-accent mb-4 text-[13px] italic text-cream-soft">
            {chosenSpecies?.name ?? "—"} {chosenClass?.name ?? ""}
            {chosenBackground ? `, once a ${chosenBackground.name}` : ""}
          </div>

          <div className="flex flex-col gap-2 text-[12.5px] text-cream-soft">
            {chosenClass && classData && (
              <div>
                <span className="label-stamp text-[9px] tracking-[1.5px] text-gold-muted">Class · </span>
                d{classData.hitDie} hit die, saves {(classData.saves ?? []).join("/")}
              </div>
            )}
            {chosenBackground && bgData && (
              <div>
                <span className="label-stamp text-[9px] tracking-[1.5px] text-gold-muted">Origin · </span>
                {bgData.feat}, {bgSkills.join(" + ")}
              </div>
            )}
            {chosenSpecies && spData && (
              <div>
                <span className="label-stamp text-[9px] tracking-[1.5px] text-gold-muted">Traits · </span>
                {(spData.traits ?? []).map((t) => t.name).join(", ")}
              </div>
            )}
            {skills.length > 0 && (
              <div>
                <span className="label-stamp text-[9px] tracking-[1.5px] text-gold-muted">Skills · </span>
                {[...bgSkills, ...skills].join(", ")}
              </div>
            )}
          </div>

          {step >= 3 && chosenClass && (
            <div
              className="mt-4 flex items-center justify-around rounded-[2px] px-3 py-2.5"
              style={{ background: "rgba(16,9,5,.5)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.3)" }}
            >
              <div className="text-center">
                <div className="label-stamp text-[8.5px] tracking-[1px] text-gold-muted">HP</div>
                <div className="font-heading text-lg font-bold text-ember-bright tabular-nums">
                  {finalScores.con > 0 ? hp : "—"}
                </div>
              </div>
              <div className="text-center">
                <div className="label-stamp text-[8.5px] tracking-[1px] text-gold-muted">AC</div>
                <div className="font-heading text-lg font-bold text-ember-bright tabular-nums">
                  {finalScores.dex > 0 ? 10 + abilityMod(finalScores.dex) : "—"}
                </div>
              </div>
              <div className="text-center">
                <div className="label-stamp text-[8.5px] tracking-[1px] text-gold-muted">Prof</div>
                <div className="font-heading text-lg font-bold text-ember-bright tabular-nums">+2</div>
              </div>
              <div className="text-center">
                <div className="label-stamp text-[8.5px] tracking-[1px] text-gold-muted">Init</div>
                <div className="font-heading text-lg font-bold text-ember-bright tabular-nums">
                  {finalScores.dex > 0 ? modText(finalScores.dex) : "—"}
                </div>
              </div>
            </div>
          )}
          <div className="font-accent mt-3 text-[11.5px] italic text-cream-muted">
            Level 1 · forged into My Heroes, ready to seat at a table.
          </div>
        </div>
      </div>
    </div>
  );
}
