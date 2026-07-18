import type { ReactNode } from "react";
import type { RulesContent, RulesKind } from "../../api/client";
import SpellEntry, { Blocks } from "./SpellEntry";

/**
 * The full readable entry for any rules content kind — the Archives' card
 * interior. Spells keep their dedicated renderer; every other kind gets the
 * same anatomy: header, facts grid, then the entry text or feature list.
 */

interface Feature {
  level?: number;
  name?: string;
  summary?: string;
}

export const FEAT_CATEGORY_LABEL: Record<string, string> = {
  origin: "Origin",
  general: "General",
  "fighting-style": "Fighting Style",
  "epic-boon": "Epic Boon",
};

function SourceStamp({ entry }: { entry: RulesContent }) {
  if (entry.source !== "homebrew") return null;
  return (
    <span className="label-stamp ml-2 text-[8px] tracking-[1px] text-[#8b2520]">
      Homebrew{entry.creatorName ? ` · ${entry.creatorName}` : ""}
    </span>
  );
}

function Header({ entry, tagline }: { entry: RulesContent; tagline: string }) {
  return (
    <>
      <div className="font-display text-[15px] font-bold leading-tight text-ink">
        {entry.name}
        <SourceStamp entry={entry} />
      </div>
      {tagline && (
        <div className="font-accent mt-0.5 text-[11.5px] italic text-ink-body">{tagline}</div>
      )}
    </>
  );
}

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (shown.length === 0) return null;
  return (
    <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11.5px] text-ink-body">
      {shown.map(([label, value]) => (
        <div key={label} className="contents">
          <span className="label-stamp text-[8.5px] tracking-[1px] text-ink-label">{label}</span>
          <span>{value}</span>
        </div>
      ))}
    </div>
  );
}

function Description({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="mt-2.5 max-h-[52vh] overflow-y-auto pr-1 text-[13px] leading-relaxed text-ink-body">
      <Blocks text={text} />
    </div>
  );
}

function FeatureList({ features, label }: { features: Feature[]; label: string }) {
  if (features.length === 0) return null;
  const sorted = [...features].sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
  return (
    <div className="mt-2.5">
      <div className="label-stamp mb-1.5 text-[8.5px] tracking-[1px] text-ink-label">{label}</div>
      <div className="flex max-h-[52vh] flex-col gap-2.5 overflow-y-auto pr-1 text-[12.5px] leading-relaxed text-ink-body">
        {sorted.map((f, i) => (
          <div key={i}>
            <div>
              {f.level != null && (
                <span className="label-stamp mr-1.5 text-[8.5px] tracking-[1px] text-ink-label">
                  L{f.level}
                </span>
              )}
              <strong className="font-heading">{f.name}</strong>
            </div>
            {f.summary && (
              <div className="mt-0.5 text-[12px]">
                <Blocks text={f.summary} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AbilityBlock({ abilities }: { abilities: Record<string, number> }) {
  const order = ["str", "dex", "con", "int", "wis", "cha"];
  if (!order.some((k) => abilities[k] != null)) return null;
  const mod = (v: number) => {
    const m = Math.floor((v - 10) / 2);
    return m >= 0 ? `+${m}` : `${m}`;
  };
  return (
    <div className="mt-2.5 grid grid-cols-6 gap-1.5 text-center">
      {order.map((k) => (
        <div
          key={k}
          className="rounded-[3px] px-1 py-1.5"
          style={{ background: "rgba(120,86,42,.12)", boxShadow: "inset 0 0 0 1px rgba(120,80,30,.35)" }}
        >
          <div className="label-stamp text-[8px] tracking-[1px] text-ink-label">{k.toUpperCase()}</div>
          <div className="font-heading text-[14px] font-bold text-ink">{abilities[k] ?? "—"}</div>
          <div className="text-[10.5px] text-ink-body">{abilities[k] != null ? mod(abilities[k]) : ""}</div>
        </div>
      ))}
    </div>
  );
}

export default function ContentEntry({ entry }: { entry: RulesContent }) {
  const kind = entry.kind as RulesKind;
  if (kind === "spell") return <SpellEntry spell={entry} compact />;

  const d = entry.data as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : undefined);
  const arr = (k: string) => (Array.isArray(d[k]) ? (d[k] as string[]) : []);
  const feats = (k: string) => (Array.isArray(d[k]) ? (d[k] as Feature[]) : []);
  const book = str("book");

  if (kind === "class") {
    const sc = (d.skillChoices ?? {}) as { choose?: number; from?: string[] };
    const skillList =
      Array.isArray(sc.from) && sc.from.length === 1 && sc.from[0] === "*"
        ? "any skill"
        : (sc.from ?? []).join(", ");
    const casting = (d.spellcasting ?? {}) as { ability?: string };
    return (
      <div className="text-[13px]">
        <Header entry={entry} tagline={entry.summary} />
        <Facts
          rows={[
            ["Hit die", d.hitDie ? `d${d.hitDie}` : undefined],
            ["Primary", arr("primaryAbility").join("/")],
            ["Saves", arr("saves").join("/")],
            ["Skills", sc.choose ? `choose ${sc.choose}: ${skillList}` : undefined],
            ["Subclass", d.subclassLevel ? `at level ${String(d.subclassLevel)}` : undefined],
            ["Casting", casting.ability],
            ["Spell list", arr("spellList").length ? `${arr("spellList").length} spells of its own` : undefined],
            ["Source", book],
          ]}
        />
        <FeatureList features={feats("features")} label="Features" />
        <Description text={str("description")} />
      </div>
    );
  }

  if (kind === "subclass") {
    return (
      <div className="text-[13px]">
        <Header entry={entry} tagline={`${str("class") ?? "?"} subclass — ${entry.summary}`} />
        <Facts rows={[["Source", book]]} />
        <FeatureList features={feats("features")} label="Features" />
        <Description text={str("description")} />
      </div>
    );
  }

  if (kind === "species") {
    return (
      <div className="text-[13px]">
        <Header entry={entry} tagline={entry.summary} />
        <Facts
          rows={[
            ["Size", str("size")],
            ["Speed", d.speed ? `${String(d.speed)} ft` : undefined],
            ["Source", book],
          ]}
        />
        <FeatureList features={feats("traits")} label="Traits" />
        <Description text={str("description")} />
      </div>
    );
  }

  if (kind === "background") {
    return (
      <div className="text-[13px]">
        <Header entry={entry} tagline={entry.summary} />
        <Facts
          rows={[
            ["Abilities", arr("abilityScores").join("/")],
            ["Feat", str("feat")],
            ["Skills", arr("skills").join(", ")],
            ["Tool", str("tool")],
            ["Equipment", str("equipment")],
            ["Source", book],
          ]}
        />
        <Description text={str("description")} />
      </div>
    );
  }

  if (kind === "feat") {
    const category = FEAT_CATEGORY_LABEL[str("category") ?? ""] ?? "General";
    return (
      <div className="text-[13px]">
        <Header entry={entry} tagline={`${category} Feat — ${entry.summary}`} />
        <Facts
          rows={[
            ["Prerequisite", str("prerequisite")],
            ["Repeatable", d.repeatable ? "yes" : undefined],
            ["Source", book],
          ]}
        />
        <Description text={str("description")} />
      </div>
    );
  }

  if (kind === "monster") {
    const tagline = [str("size"), str("type")].filter(Boolean).join(" ") +
      (str("alignment") ? `, ${str("alignment")}` : "");
    return (
      <div className="text-[13px]">
        <Header entry={entry} tagline={tagline} />
        <Facts
          rows={[
            ["AC", String(d.ac ?? "")],
            ["HP", `${String(d.hp ?? "")}${str("hpFormula") ? ` (${str("hpFormula")})` : ""}`],
            ["Speed", str("speed")],
            ["CR", str("cr")],
            ["Saves", str("saves")],
            ["Source", book],
          ]}
        />
        <AbilityBlock abilities={(d.abilities as Record<string, number>) ?? {}} />
        <Description text={str("description")} />
      </div>
    );
  }

  // item
  const itemType = str("type") ?? "gear";
  const typeRows: Array<[string, ReactNode]> =
    itemType === "armor"
      ? [
          ["Armor", `${str("category") ?? ""} armor`],
          ["AC", String(d.ac ?? "")],
          ["Stealth", d.stealthDisadvantage ? "disadvantage" : undefined],
        ]
      : itemType === "shield"
        ? [["AC bonus", `+${String(d.acBonus ?? 2)}`]]
        : itemType === "weapon"
          ? [
              ["Weapon", `${str("category") ?? ""}${d.ranged ? ", ranged" : ", melee"}`],
              ["Damage", `${str("damage") ?? ""} ${str("damageType") ?? ""}`],
              ["Properties", arr("properties").join(", ")],
            ]
          : [["Type", "Gear"]];
  return (
    <div className="text-[13px]">
      <Header entry={entry} tagline={entry.summary} />
      <Facts rows={[...typeRows, ["Source", book]]} />
      <Description text={str("description")} />
    </div>
  );
}
