import type { AbilityScores, RulesContent } from "../../api/client";
import AbilityRow from "../ui/AbilityRow";
import {
  ABILITIES,
  POINT_BUY_BUDGET,
  STANDARD_ARRAY,
  type AbilityKey,
  type BonusMode,
  type Method,
} from "./constants";

/*
The Abilities step: the three 2024 ways to get six numbers, plus the
background's bonuses on top.

The props read long, and deliberately so — they are the exact list of what this
step touches, which was invisible while it lived inside a thousand-line
component. Anything not named here, it cannot reach.
*/
export default function AbilitiesPanel({
  chosenClass,
  chosenBackground,
  bgAbilities,
  bgAbilityLabels,
  method,
  setMethod,
  base,
  setBase,
  assignArrayScore,
  recommendArray,
  pointsSpent,
  arrayValid,
  bonusMode,
  setBonusMode,
  bonus2,
  setBonus2,
  bonus1,
  setBonus1,
  finalScores,
  input,
}: {
  chosenClass?: RulesContent;
  chosenBackground?: RulesContent;
  /** The background's three abilities, lowercased into keys. */
  bgAbilities: AbilityKey[];
  /** The same three as the background writes them, for the label. */
  bgAbilityLabels: string[];
  method: Method;
  setMethod: (m: Method) => void;
  base: Record<AbilityKey, number>;
  setBase: (b: Record<AbilityKey, number>) => void;
  assignArrayScore: (key: AbilityKey, value: number) => void;
  recommendArray: () => void;
  pointsSpent: number;
  arrayValid: boolean;
  bonusMode: BonusMode;
  setBonusMode: (m: BonusMode) => void;
  bonus2: AbilityKey | "";
  setBonus2: (a: AbilityKey) => void;
  bonus1: AbilityKey | "";
  setBonus1: (a: AbilityKey) => void;
  finalScores: AbilityScores;
  input: string;
}) {
  return (
    <div className="parchment px-6 py-5">
      {/* Fast start: one click fills a class-tuned standard array. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(120,80,30,.25)] pb-4">
        <div>
          <div className="font-display text-[15px] font-bold text-ink">Assign ability scores</div>
          <div className="font-body text-[12px] italic text-ink-body">
            In a hurry? Take the recommended spread and tweak from there.
          </div>
        </div>
        <button
          type="button"
          onClick={recommendArray}
          className="btn-base btn-wax whitespace-nowrap px-4 py-2 text-[10.5px]"
          title={`Fill the standard array tuned for a ${chosenClass?.name}`}
        >
          ★ Recommended for {chosenClass?.name}
        </button>
      </div>
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
            {chosenBackground.name} bonuses — {bgAbilityLabels.join(" / ")}
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
  );
}
