import { useState } from "react";

/**
 * The Rules — a quick-lookup reference for the fiddly 5e tables that come up
 * mid-game: which ability governs each skill, the saves, proficiency by level,
 * conditions, and combat actions. Static; no per-campaign state. Wording is
 * mechanics-exact and original (SRD 5.2.1 facts, our own phrasing).
 */

const ABILITY_LABEL: Record<string, string> = {
  STR: "Strength",
  DEX: "Dexterity",
  CON: "Constitution",
  INT: "Intelligence",
  WIS: "Wisdom",
  CHA: "Charisma",
};

const ABILITY_TONE: Record<string, string> = {
  STR: "#b5654e",
  DEX: "#7ea63f",
  CON: "#c99a3f",
  INT: "#6fa8c9",
  WIS: "#9a86b8",
  CHA: "#c96a8a",
};

const SKILLS: Array<[string, string, string]> = [
  ["Acrobatics", "DEX", "Keep your balance, tumble, slip a grapple with finesse."],
  ["Animal Handling", "WIS", "Calm or control an animal and read its intent."],
  ["Arcana", "INT", "Recall lore of spells, magic items, planes, and symbols."],
  ["Athletics", "STR", "Climb, jump, swim, grapple, and shove."],
  ["Deception", "CHA", "Lie convincingly and hide your true intent."],
  ["History", "INT", "Recall past events, peoples, wars, and kingdoms."],
  ["Insight", "WIS", "Read a creature's true feelings and intentions."],
  ["Intimidation", "CHA", "Coerce through threats, menace, or sheer presence."],
  ["Investigation", "INT", "Deduce from clues and search out hidden details."],
  ["Medicine", "WIS", "Stabilize the dying and diagnose an ailment."],
  ["Nature", "INT", "Recall lore of terrain, plants, animals, and weather."],
  ["Perception", "WIS", "Notice things with your eyes, ears, and other senses."],
  ["Performance", "CHA", "Delight an audience with music, dance, or oratory."],
  ["Persuasion", "CHA", "Influence others with tact, grace, and good faith."],
  ["Religion", "INT", "Recall lore of deities, rites, and holy symbols."],
  ["Sleight of Hand", "DEX", "Pick pockets, plant an item, any manual trickery."],
  ["Stealth", "DEX", "Hide and move unseen and unheard."],
  ["Survival", "WIS", "Track, forage, navigate, and endure the wilds."],
];

const SAVES: Array<[string, string]> = [
  ["STR", "Resist being grappled, pushed, or physically overpowered."],
  ["DEX", "Dodge area effects — traps, breath weapons, and blasts."],
  ["CON", "Endure poison, disease, and exhaustion; hold concentration."],
  ["INT", "Withstand psychic assaults, illusions, and mind-probing magic."],
  ["WIS", "Shrug off charm, fear, and effects that bend your will."],
  ["CHA", "Resist banishment, possession, and effects on your very self."],
];

const PROF_BY_LEVEL: Array<[string, string]> = [
  ["1–4", "+2"],
  ["5–8", "+3"],
  ["9–12", "+4"],
  ["13–16", "+5"],
  ["17–20", "+6"],
];

const DC_GUIDE: Array<[string, string]> = [
  ["Very easy", "5"],
  ["Easy", "10"],
  ["Medium", "15"],
  ["Hard", "20"],
  ["Very hard", "25"],
  ["Nearly impossible", "30"],
];

const CONDITIONS: Array<[string, string]> = [
  ["Blinded", "Can't see; auto-fail sight checks. Attacks against you have advantage; yours have disadvantage."],
  ["Charmed", "Can't attack your charmer; they have advantage on social checks with you."],
  ["Deafened", "Can't hear; auto-fail hearing checks."],
  ["Frightened", "Disadvantage on checks and attacks while the source is in sight; you can't willingly move closer to it."],
  ["Grappled", "Speed 0. Ends if the grappler is incapacitated or you're moved out of reach."],
  ["Incapacitated", "Can't take actions or reactions."],
  ["Invisible", "Unseen without special senses. Attacks against you have disadvantage; yours have advantage."],
  ["Paralyzed", "Incapacitated, can't move or speak; auto-fail STR & DEX saves. Attacks have advantage; hits within 5 ft crit."],
  ["Petrified", "Turned to stone: incapacitated, unaware, resistant to all damage, immune to poison and disease."],
  ["Poisoned", "Disadvantage on attack rolls and ability checks."],
  ["Prone", "Can only crawl; disadvantage on attacks. Melee against you has advantage, ranged has disadvantage."],
  ["Restrained", "Speed 0; disadvantage on DEX saves. Attacks against you have advantage; yours have disadvantage."],
  ["Stunned", "Incapacitated, can't move, speech falters; auto-fail STR & DEX saves. Attacks against you have advantage."],
  ["Unconscious", "Incapacitated and prone, drop everything, unaware; auto-fail STR & DEX saves. Hits within 5 ft crit."],
  ["Exhaustion", "Six worsening levels — from disadvantage on checks (1) through halved speed, disadvantage on attacks/saves, halved HP max, speed 0, and finally death (6)."],
];

const ACTIONS: Array<[string, string]> = [
  ["Attack", "Make one melee or ranged attack (more with Extra Attack)."],
  ["Dash", "Gain extra movement equal to your speed this turn."],
  ["Disengage", "Your movement doesn't provoke opportunity attacks."],
  ["Dodge", "Attackers have disadvantage; you have advantage on DEX saves."],
  ["Help", "Give an ally advantage on a check, or on their next attack vs a foe within 5 ft of you."],
  ["Hide", "Make a Stealth check to become unseen and unheard."],
  ["Ready", "Prepare an action to trigger on a condition you name (uses your reaction)."],
  ["Search", "Devote your attention to finding something (Perception or Investigation)."],
  ["Influence / Utilize", "Interact with an object or feature, or use a special ability."],
  ["Cast a Spell", "Cast a spell with a casting time of one action."],
  ["Grapple / Shove", "Special melee attacks: Athletics vs the target's Athletics or Acrobatics to seize or push."],
];

const SECTIONS = ["Skills", "Saves", "Conditions", "Combat", "At a glance"] as const;
type Section = (typeof SECTIONS)[number];

function AbilityTag({ ability }: { ability: string }) {
  return (
    <span
      className="font-heading inline-flex items-center rounded-[2px] px-1.5 py-0.5 text-[10px] font-bold tracking-[1px]"
      style={{ color: ABILITY_TONE[ability], background: `${ABILITY_TONE[ability]}1f`, boxShadow: `inset 0 0 0 1px ${ABILITY_TONE[ability]}55` }}
      title={ABILITY_LABEL[ability]}
    >
      {ability}
    </span>
  );
}

function Row({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div
      className="flex items-baseline gap-3 py-2"
      style={{ borderTop: "1px solid rgba(201,162,39,.14)" }}
    >
      <div className="w-[130px] flex-none sm:w-[150px]">{left}</div>
      <div className="flex-1 text-[13px] leading-snug text-cream-soft">{right}</div>
    </div>
  );
}

export default function RulesPage() {
  const [section, setSection] = useState<Section>("Skills");

  return (
    <div className="panel-hall px-5 pb-11 pt-8 sm:px-[30px]">
      <div
        className="mb-5 flex flex-wrap items-center justify-between gap-4 pb-3.5"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <div>
          <h2
            className="font-display m-0 text-[clamp(24px,3vw,32px)] font-black text-[#e7d3a6]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
          >
            The Rules
          </h2>
          <div className="font-accent mt-1 text-[13px] italic text-cream-muted">
            The tables you always end up looking up mid-game.
          </div>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-1.5">
        {SECTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={`label-stamp rounded-[3px] px-3 py-1.5 text-[10px] font-semibold tracking-[1.5px] transition ${
              section === s ? "text-hearth" : "text-gold-muted hover:text-ember-bright"
            }`}
            style={
              section === s
                ? { background: "#e0a94e", boxShadow: "0 1px 3px rgba(0,0,0,.35)" }
                : { background: "rgba(201,162,39,.1)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.25)" }
            }
          >
            {s}
          </button>
        ))}
      </div>

      <div className="max-w-[760px]">
        {section === "Skills" && (
          <>
            <p className="font-accent mb-3 text-[13px] italic text-cream-muted">
              Each skill is governed by one ability — that's the modifier you add (plus your
              proficiency bonus if you're proficient).
            </p>
            {SKILLS.map(([name, ability, use]) => (
              <Row
                key={name}
                left={
                  <span className="flex items-center gap-2">
                    <AbilityTag ability={ability} />
                    <span className="font-heading text-[13px] font-semibold text-cream">{name}</span>
                  </span>
                }
                right={use}
              />
            ))}
          </>
        )}

        {section === "Saves" && (
          <>
            <p className="font-accent mb-3 text-[13px] italic text-cream-muted">
              Six saving throws, one per ability — what each one protects against.
            </p>
            {SAVES.map(([ability, use]) => (
              <Row
                key={ability}
                left={
                  <span className="flex items-center gap-2">
                    <AbilityTag ability={ability} />
                    <span className="font-heading text-[13px] font-semibold text-cream">
                      {ABILITY_LABEL[ability]}
                    </span>
                  </span>
                }
                right={use}
              />
            ))}
          </>
        )}

        {section === "Conditions" && (
          <>
            <p className="font-accent mb-3 text-[13px] italic text-cream-muted">
              The standard conditions and what they do.
            </p>
            {CONDITIONS.map(([name, effect]) => (
              <Row
                key={name}
                left={<span className="font-heading text-[13px] font-semibold text-ember-bright">{name}</span>}
                right={effect}
              />
            ))}
          </>
        )}

        {section === "Combat" && (
          <>
            <p className="font-accent mb-3 text-[13px] italic text-cream-muted">
              What you can do on your turn (one action, plus movement and — if you have one — a bonus
              action and a reaction).
            </p>
            {ACTIONS.map(([name, effect]) => (
              <Row
                key={name}
                left={<span className="font-heading text-[13px] font-semibold text-cream">{name}</span>}
                right={effect}
              />
            ))}
          </>
        )}

        {section === "At a glance" && (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <h3 className="label-stamp mb-2 text-[11px] tracking-[2px] text-gold-muted">
                Proficiency bonus by level
              </h3>
              {PROF_BY_LEVEL.map(([lvl, bonus]) => (
                <div key={lvl} className="flex justify-between py-1.5 text-[13px]" style={{ borderTop: "1px solid rgba(201,162,39,.14)" }}>
                  <span className="text-cream-soft">Level {lvl}</span>
                  <span className="font-heading font-bold text-ember-bright tabular-nums">{bonus}</span>
                </div>
              ))}
            </div>
            <div>
              <h3 className="label-stamp mb-2 text-[11px] tracking-[2px] text-gold-muted">
                Typical difficulty (DC)
              </h3>
              {DC_GUIDE.map(([label, dc]) => (
                <div key={label} className="flex justify-between py-1.5 text-[13px]" style={{ borderTop: "1px solid rgba(201,162,39,.14)" }}>
                  <span className="text-cream-soft">{label}</span>
                  <span className="font-heading font-bold text-ember-bright tabular-nums">{dc}</span>
                </div>
              ))}
            </div>
            <div className="sm:col-span-2">
              <h3 className="label-stamp mb-2 text-[11px] tracking-[2px] text-gold-muted">Resting</h3>
              <Row
                left={<span className="font-heading text-[13px] font-semibold text-cream">Short rest</span>}
                right="At least 1 hour. Spend Hit Dice to heal (roll + your CON modifier each), and use features that recharge on a short rest."
              />
              <Row
                left={<span className="font-heading text-[13px] font-semibold text-cream">Long rest</span>}
                right="At least 8 hours. Regain all lost HP and half your total Hit Dice, and reset features that recharge on a long rest. One long rest per 24 hours."
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
