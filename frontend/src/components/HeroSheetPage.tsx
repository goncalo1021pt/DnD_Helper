import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { InventoryItem, RulesContent } from "../api/client";
import {
  useAddItem,
  useCharacterDetail,
  useDeleteItem,
  useRules,
  useSetSpellSlots,
  useUpdateItem,
} from "../hooks";
import { acFromEquipment, profBonus, weaponAttacks } from "../lib/derive";
import { hpColor, initials, medallionFor } from "../lib/party";
import AbilityRow, { abilityMod, modText } from "./ui/AbilityRow";
import SpellEntry, { Blocks, SpellFlags } from "./ui/SpellEntry";
import ContentEntry from "./ui/ContentEntry";

type EquipSlot = "armor" | "mainhand" | "offhand";
const SLOT_LABEL: Record<EquipSlot, string> = {
  armor: "Armor",
  mainhand: "Main Hand",
  offhand: "Off Hand",
};

function itemTypeOf(it: InventoryItem): string {
  return ((it.content?.data ?? {}) as { type?: string }).type ?? "";
}

/** Which slots an inventory row can occupy. */
function slotsFor(it: InventoryItem): EquipSlot[] {
  switch (itemTypeOf(it)) {
    case "armor":
      return ["armor"];
    case "shield":
      return ["offhand"];
    case "weapon":
      return ["mainhand", "offhand"];
    default:
      return [];
  }
}

/** The one number worth printing on a tile. */
function keyStat(it: InventoryItem): string {
  const d = (it.content?.data ?? {}) as {
    ac?: number; acBonus?: number; damage?: string; damageType?: string;
  };
  switch (itemTypeOf(it)) {
    case "armor":
      return `AC ${d.ac ?? "?"}`;
    case "shield":
      return `+${d.acBonus ?? 2} AC`;
    case "weapon":
      return `${d.damage ?? ""} ${d.damageType ?? ""}`.trim();
    default:
      return "";
  }
}

function ItemGlyph({ it }: { it: InventoryItem }) {
  switch (itemTypeOf(it)) {
    case "armor":
      return <IconArmor size={15} strokeWidth={1.6} />;
    case "shield":
      return <IconShieldItem size={15} strokeWidth={1.6} />;
    case "weapon":
      return <IconSword size={15} strokeWidth={1.6} />;
    default:
      return <IconSack size={15} strokeWidth={1.6} />;
  }
}
import FloatingDiceTray from "./ui/DiceTray";
import ParchmentModal from "./ui/ParchmentModal";
import LevelUpModal from "./LevelUpModal";
import {
  IconArmor,
  IconCoin,
  IconPlus,
  IconSack,
  IconShieldItem,
  IconSword,
  IconTrash,
} from "./ui/icons";

/**
 * The hero sheet: one page per hero with everything the table needs —
 * abilities, skills, features by level, feats, spells with slot pips,
 * and the pack with real AC. Basic skeleton; the polish pass comes later.
 */

const SKILL_ABILITY: Record<string, string> = {
  Athletics: "str",
  Acrobatics: "dex", "Sleight of Hand": "dex", Stealth: "dex",
  Arcana: "int", History: "int", Investigation: "int", Nature: "int", Religion: "int",
  "Animal Handling": "wis", Insight: "wis", Medicine: "wis", Perception: "wis", Survival: "wis",
  Deception: "cha", Intimidation: "cha", Performance: "cha", Persuasion: "cha",
};

interface Feature {
  level?: number;
  name?: string;
  summary?: string;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="label-stamp mb-2.5 text-[10px] tracking-[2.5px] text-gold-muted">
      {children}
    </div>
  );
}

export default function HeroSheetPage() {
  const { heroId } = useParams<{ heroId: string }>();
  const { data: detail, isLoading, error } = useCharacterDetail(heroId);
  const { data: classes } = useRules("class");
  const { data: subclasses } = useRules("subclass");
  const { data: itemLibrary } = useRules("item");
  const setSlots = useSetSpellSlots(heroId ?? "");
  const addItem = useAddItem(heroId ?? "");
  const updateItem = useUpdateItem(heroId ?? "");
  const deleteItem = useDeleteItem(heroId ?? "");
  const [levelling, setLevelling] = useState(false);
  const [reading, setReading] = useState<RulesContent | null>(null);
  const [addChoice, setAddChoice] = useState("");
  const [freeText, setFreeText] = useState("");
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [slotPicker, setSlotPicker] = useState<EquipSlot | null>(null);
  const [tab, setTab] = useState<"sheet" | "inventory">("sheet");
  const [itemSearch, setItemSearch] = useState("");
  const [itemType, setItemType] = useState("");

  const character = detail?.character;
  const sheet = character?.sheet;
  const canEdit = character?.mine ?? false; // DMs edit via the API too; UI keeps it simple

  const klass = classes?.find((c) => c.id === sheet?.classId);
  const subclass = subclasses?.find((s) => s.id === sheet?.subclassId);

  // The rig: what sits where. Coin gets a purse, not a tile.
  const purse = detail?.items.find((i) => !i.content && i.name === "Gold Pieces");
  const packItems = (detail?.items ?? []).filter((i) => i.id !== purse?.id);
  const bySlot: Record<EquipSlot, InventoryItem | undefined> = {
    armor: detail?.items.find((i) => i.slot === "armor"),
    mainhand: detail?.items.find((i) => i.slot === "mainhand"),
    offhand: detail?.items.find((i) => i.slot === "offhand"),
  };
  const openItem = detail?.items.find((i) => i.id === openItemId) ?? null;

  // Loot grows; the pack filters. Type chips + name search.
  const shownPack = packItems.filter((i) => {
    const t = itemTypeOf(i);
    if (itemType === "gear" ? t !== "" && t !== "gear" : itemType !== "" && t !== itemType)
      return false;
    const q = itemSearch.trim().toLowerCase();
    return !q || i.name.toLowerCase().includes(q);
  });

  const features: Array<Feature & { from: string }> = useMemo(() => {
    if (!character) return [];
    const collect = (src: RulesContent | undefined) =>
      (((src?.data as { features?: Feature[] })?.features ?? []) as Feature[])
        .filter((f) => (f.level ?? 1) <= character.level)
        .map((f) => ({ ...f, from: src?.name ?? "" }));
    return [...collect(klass), ...collect(subclass)].sort(
      (a, b) => (a.level ?? 1) - (b.level ?? 1),
    );
  }, [character, klass, subclass]);

  const spellsByLevel = useMemo(() => {
    const groups = new Map<number, RulesContent[]>();
    for (const s of detail?.spells ?? []) {
      const lvl = ((s.data as { level?: number }).level ?? 0) as number;
      groups.set(lvl, [...(groups.get(lvl) ?? []), s]);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [detail]);

  if (isLoading) {
    return (
      <div className="font-accent px-5 py-[70px] text-center text-base italic text-[#9c855e]">
        Unrolling the sheet…
      </div>
    );
  }
  if (error || !detail || !character) {
    return (
      <div className="panel-hall px-5 py-[60px] text-center sm:px-[30px]">
        <div className="font-display text-2xl text-[#cdb582]">This hero is not yours to read</div>
        <Link to="/questboard/heroes" className="font-accent mt-2 inline-block text-base italic text-gold-muted no-underline hover:text-ember-bright">
          — back to My Heroes —
        </Link>
      </div>
    );
  }

  const abilities = sheet?.abilities;
  const prof = profBonus(character.level);
  const ac = abilities ? acFromEquipment(detail.items, abilities) : null;
  const attacks = abilities ? weaponAttacks(detail.items, abilities, character.level) : [];
  const slots = sheet?.spellSlots ?? [];
  const hpc = hpColor(character.hpCurrent, character.hpMax);

  function tickSlot(level: number, used: number, max: number, delta: number) {
    const next = Math.min(Math.max(used + delta, 0), max);
    if (next === used) return;
    const arr = new Array(9).fill(0);
    for (const s of slots) arr[s.level - 1] = s.used;
    arr[level - 1] = next;
    setSlots.mutate(arr.slice(0, Math.max(...slots.map((s) => s.level))));
  }

  return (
    <div className="panel-hall px-5 pb-28 pt-8 sm:px-[30px] sm:pb-11">
      {/* header */}
      <div
        className="mb-6 flex flex-wrap items-center justify-between gap-4 pb-4"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <div className="flex items-center gap-4">
          <div
            className="font-heading relative flex h-[58px] w-[58px] flex-none items-center justify-center rounded-[3px] text-[17px] font-bold text-[#f3e6c8]"
            style={{
              background: medallionFor(character.id),
              boxShadow: "inset 0 0 0 1.5px rgba(201,162,39,.5), 0 3px 6px rgba(0,0,0,.35)",
            }}
          >
            {initials(character.name) || "?"}
          </div>
          <div>
            <h2
              className="font-display m-0 text-[clamp(22px,3vw,30px)] font-black leading-tight text-[#e7d3a6]"
              style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
            >
              {character.name}
            </h2>
            <div className="font-accent text-[13.5px] italic text-cream-soft">
              Level {character.level} {character.class || "Adventurer"}
              {subclass && ` · ${subclass.name}`}
              {character.campaignName && ` · seated at ${character.campaignName}`}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="label-stamp text-[10px] tracking-[1px]" style={{ color: hpc }}>
            HP {character.hpCurrent}/{character.hpMax}
          </span>
          {canEdit && sheet && character.level < 20 && (
            <button
              onClick={() => setLevelling(true)}
              className="btn-base btn-gold clip-octagon h-10 px-5 text-[12px]"
            >
              Level up
            </button>
          )}
        </div>
      </div>

      {sheet && (
        <div className="mb-5 flex gap-1.5">
          {(["sheet", "inventory"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`label-stamp cursor-pointer rounded-[2px] border-none px-4 py-2 text-[10px] font-semibold tracking-[1.5px] ${
                t === tab ? "text-ember-bright" : "text-gold-muted hover:text-gold-hair"
              }`}
              style={{
                background: t === tab ? "rgba(201,162,39,.12)" : "rgba(16,9,5,.35)",
                boxShadow: `inset 0 0 0 1px rgba(201,162,39,${t === tab ? ".45" : ".2"})`,
              }}
            >
              {t === "sheet" ? "The Sheet" : "Inventory"}
            </button>
          ))}
        </div>
      )}

      {!sheet ? (
        <div className="font-accent px-2 py-8 text-center text-[15px] italic text-cream-muted">
          A freeform hero — no forged sheet to show. The Forge awaits the next one.
        </div>
      ) : (
        <div
          className={
            tab === "inventory"
              ? "mx-auto w-full max-w-[820px]"
              : "grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]"
          }
        >
          {tab === "sheet" && (
          <div className="flex flex-col gap-6">
            <section>
              <SectionLabel>Abilities</SectionLabel>
              <div className="parchment px-4 py-4">
                <AbilityRow abilities={sheet.abilities} />
                <div
                  className="mt-3 flex items-center justify-around rounded-[2px] px-3 py-2.5"
                  style={{ background: "rgba(120,86,42,.08)", boxShadow: "inset 0 0 0 1px rgba(120,80,30,.25)" }}
                >
                  {[
                    ["AC", ac ?? "—"],
                    ["Prof", `+${prof}`],
                    ["Init", modText(sheet.abilities.dex)],
                    ...(sheet.spellcastingAbility
                      ? [["Save DC", 8 + prof + abilityMod(sheet.abilities[sheet.spellcastingAbility.toLowerCase() as keyof typeof sheet.abilities] ?? 10)]]
                      : []),
                  ].map(([label, value]) => (
                    <div key={String(label)} className="text-center">
                      <div className="label-stamp text-[8.5px] tracking-[1px] text-ink-label">{label}</div>
                      <div className="font-heading text-lg font-bold text-ink tabular-nums">{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* skills */}
            <section>
              <SectionLabel>Skills</SectionLabel>
              <div className="parchment grid grid-cols-2 gap-x-5 gap-y-1 px-4 py-3.5 sm:grid-cols-3">
                {Object.keys(SKILL_ABILITY).map((sk) => {
                  const proficient = sheet.skills.includes(sk);
                  const mod =
                    abilityMod(sheet.abilities[SKILL_ABILITY[sk] as keyof typeof sheet.abilities]) +
                    (proficient ? prof : 0);
                  return (
                    <div
                      key={sk}
                      className={`flex items-baseline justify-between text-[12.5px] ${proficient ? "font-semibold text-ink" : "text-ink-body"}`}
                    >
                      <span>
                        {proficient ? "● " : "○ "}
                        {sk}
                      </span>
                      <span className="tabular-nums">{mod >= 0 ? `+${mod}` : mod}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* features */}
            {features.length > 0 && (
              <section>
                <SectionLabel>Features</SectionLabel>
                <div className="parchment flex flex-col gap-2.5 px-4 py-4">
                  {features.map((f, i) => (
                    <div key={i} className="text-[13px]">
                      <span className="font-heading font-bold text-ink">{f.name}</span>
                      <span className="label-stamp ml-2 text-[8px] tracking-[1px] text-ink-label">
                        {f.from} {f.level ?? 1}
                      </span>
                      {f.summary && (
                        <div className="leading-relaxed text-ink-body">
                          <Blocks text={f.summary} />
                        </div>
                      )}
                    </div>
                  ))}
                  {(sheet.feats ?? []).length > 0 && (
                    <div className="mt-1 text-[13px]">
                      <span className="label-stamp text-[9px] tracking-[1.5px] text-ink-label">Feats · </span>
                      <span className="font-semibold text-ink">{(sheet.feats ?? []).join(", ")}</span>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
          )}

          {/* right column — the sole column on the Inventory tab */}
          <div className="flex flex-col gap-6">
            {/* spells */}
            {tab === "sheet" && (slots.length > 0 || spellsByLevel.length > 0) && (
              <section>
                <SectionLabel>Spells</SectionLabel>
                <div className="parchment px-4 py-4">
                  {slots.length > 0 && (
                    <div className="mb-3 flex flex-col gap-1.5">
                      {slots.map((s) => (
                        <div key={s.level} className="flex items-center gap-2.5">
                          <span className="label-stamp w-10 text-[9px] tracking-[1px] text-ink-label">
                            Lv {s.level}
                          </span>
                          <div className="flex gap-1.5">
                            {Array.from({ length: s.max }, (_, i) => (
                              <button
                                key={i}
                                disabled={!canEdit}
                                onClick={() => tickSlot(s.level, s.used, s.max, i < s.used ? -1 : 1)}
                                title={i < s.used ? "spent — click to restore" : "click to spend"}
                                className="h-4 w-4 cursor-pointer rounded-full border-none p-0"
                                style={{
                                  background: i < s.used ? "#3d2317" : "linear-gradient(180deg,#e0a94e,#9a703a)",
                                  boxShadow: "inset 0 0 0 1.5px rgba(61,35,23,.7)",
                                  opacity: canEdit ? 1 : 0.7,
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {spellsByLevel.map(([lvl, list]) => (
                    <div key={lvl} className="mb-2">
                      <div className="label-stamp mb-1 text-[9px] tracking-[2px] text-ink-label">
                        {lvl === 0 ? "Cantrips" : `Level ${lvl}`}
                      </div>
                      {list.map((s) => (
                        <div key={s.id} className="text-[12.5px] leading-relaxed text-ink-body">
                          <button
                            onClick={() => setReading(s)}
                            className="cursor-pointer border-none bg-transparent p-0 font-semibold text-ink underline decoration-[rgba(120,80,30,.4)] underline-offset-2 hover:text-[#8b2520]"
                          >
                            {s.name}
                          </button>
                          <SpellFlags spell={s} />
                          {" — "}
                          {s.summary}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {tab === "inventory" && (
              <>
            {/* the rig: what's worn and held */}
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <SectionLabel>Equipped</SectionLabel>
                {purse && (
                  <button
                    onClick={() => canEdit && setOpenItemId(purse.id)}
                    className="label-stamp flex cursor-pointer items-center gap-1.5 rounded-[2px] border-none px-2.5 py-1.5 text-[10px] font-semibold tracking-[1px] text-gold-muted"
                    style={{ background: "rgba(201,162,39,.10)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.35)" }}
                  >
                    <IconCoin size={13} strokeWidth={1.8} />
                    {purse.qty} GP
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(SLOT_LABEL) as EquipSlot[]).map((slot) => {
                  const it = bySlot[slot];
                  return (
                    <button
                      key={slot}
                      onClick={() => (it ? setOpenItemId(it.id) : canEdit && setSlotPicker(slot))}
                      className="parchment cursor-pointer px-3 pb-2.5 pt-2 text-left transition hover:-translate-y-0.5"
                      style={it ? undefined : { opacity: 0.75, boxShadow: "inset 0 0 0 1.5px rgba(120,80,30,.35)" }}
                    >
                      <div className="label-stamp text-[8px] tracking-[1.5px] text-ink-label">
                        {SLOT_LABEL[slot]}
                      </div>
                      {it ? (
                        <>
                          <div className="font-heading mt-1 truncate text-[13px] font-bold text-ink">
                            {it.name}
                          </div>
                          <div className="mt-0.5 text-[11px] text-ink-body">{keyStat(it)}</div>
                        </>
                      ) : (
                        <div className="font-accent mt-1.5 text-[12px] italic text-ink-body">
                          — empty —
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              {attacks.length > 0 && (
                <div className="parchment mt-2 px-4 py-2.5">
                  {attacks.map((a) => (
                    <div key={a.name} className="text-[12.5px] text-ink-body">
                      <span className="font-semibold text-ink">{a.name}</span>{" "}
                      +{a.bonus} to hit · {a.damage} {a.damageType}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* the pack: a game inventory grid */}
            <section>
              <SectionLabel>The Pack</SectionLabel>
              <div className="parchment px-4 py-4">
                {packItems.length > 0 && (
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <input
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                      placeholder="Search the pack…"
                      className="input-parchment input-compact min-w-0 flex-1 text-[12px] sm:max-w-[220px]"
                    />
                    {[["", "All"], ["armor", "Armor"], ["weapon", "Weapons"], ["shield", "Shields"], ["gear", "Gear"]].map(
                      ([val, label]) => (
                        <button
                          key={val}
                          onClick={() => setItemType(val)}
                          className="label-stamp cursor-pointer rounded-[2px] border-none px-2.5 py-1.5 text-[9px] tracking-[1px]"
                          style={{
                            background: itemType === val ? "linear-gradient(180deg,#8b2520,#5e1611)" : "rgba(120,86,42,.13)",
                            color: itemType === val ? "#f3d9c0" : "#4a3620",
                            boxShadow: `inset 0 0 0 1px ${itemType === val ? "#3f0f0e" : "rgba(120,80,30,.45)"}`,
                          }}
                        >
                          {label}
                        </button>
                      ),
                    )}
                  </div>
                )}
                {packItems.length === 0 && (
                  <div className="font-accent pb-2 text-[13px] italic text-ink-body">
                    Traveling light — nothing carried yet.
                  </div>
                )}
                {packItems.length > 0 && shownPack.length === 0 && (
                  <div className="font-accent pb-2 text-[13px] italic text-ink-body">
                    Nothing in the pack answers that call.
                  </div>
                )}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(132px,100%),1fr))] gap-2">
                  {shownPack.map((it: InventoryItem) => (
                    <button
                      key={it.id}
                      onClick={() => setOpenItemId(it.id)}
                      className="parchment cursor-pointer px-2.5 pb-2 pt-1.5 text-left transition hover:-translate-y-0.5"
                      style={
                        it.equipped
                          ? { boxShadow: "0 0 0 2px #8b2520, 0 10px 18px rgba(0,0,0,.35)" }
                          : undefined
                      }
                    >
                      <div className="flex items-center gap-1.5 text-ink-label">
                        <ItemGlyph it={it} />
                        {it.qty > 1 && (
                          <span className="label-stamp ml-auto text-[9px] tracking-[1px]">
                            ×{it.qty}
                          </span>
                        )}
                      </div>
                      <div className="font-heading mt-1 truncate text-[12.5px] font-bold leading-tight text-ink">
                        {it.name}
                      </div>
                      <div className="mt-0.5 min-h-[14px] text-[10.5px] text-ink-body">
                        {it.equipped
                          ? `equipped · ${SLOT_LABEL[(it.slot || "armor") as EquipSlot]}`
                          : keyStat(it)}
                      </div>
                    </button>
                  ))}
                </div>
                {canEdit && (
                  <div className="mt-3.5 flex flex-wrap items-center gap-2">
                    <select
                      value={addChoice}
                      onChange={(e) => setAddChoice(e.target.value)}
                      className="input-parchment input-compact min-w-0 flex-1 cursor-pointer text-[12px]"
                    >
                      <option value="">Add from the armory…</option>
                      {(itemLibrary ?? []).map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                          {i.source === "homebrew" ? ` (${i.creatorName ?? "homebrew"})` : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={!addChoice || addItem.isPending}
                      onClick={() =>
                        addItem.mutate({ contentId: addChoice, qty: 1 }, { onSuccess: () => setAddChoice("") })
                      }
                      className="btn-base btn-ghost-ink h-9 px-3 text-[10px]"
                    >
                      <IconPlus size={12} strokeWidth={2} />
                    </button>
                    <input
                      value={freeText}
                      placeholder="…or anything else"
                      maxLength={80}
                      onChange={(e) => setFreeText(e.target.value)}
                      className="input-parchment input-compact min-w-0 flex-1 text-[12px]"
                    />
                    <button
                      disabled={!freeText.trim() || addItem.isPending}
                      onClick={() =>
                        addItem.mutate({ name: freeText.trim(), qty: 1 }, { onSuccess: () => setFreeText("") })
                      }
                      className="btn-base btn-ghost-ink h-9 px-3 text-[10px]"
                    >
                      <IconPlus size={12} strokeWidth={2} />
                    </button>
                  </div>
                )}
              </div>
            </section>
              </>
            )}
          </div>
        </div>
      )}

      {reading && (
        <ParchmentModal onClose={() => setReading(null)} maxWidth="max-w-[560px]">
          <SpellEntry spell={reading} />
        </ParchmentModal>
      )}

      {openItem && (
        <ParchmentModal onClose={() => setOpenItemId(null)} maxWidth="max-w-[520px]">
          {openItem.content ? (
            <ContentEntry entry={openItem.content} />
          ) : (
            <div className="text-[13px]">
              <div className="font-display text-[15px] font-bold leading-tight text-ink">
                {openItem.name}
              </div>
              <div className="font-accent mt-0.5 text-[11.5px] italic text-ink-body">
                Carried gear
              </div>
            </div>
          )}
          {canEdit && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[rgba(120,80,30,.25)] pt-3.5">
              {slotsFor(openItem).map((slot) =>
                openItem.slot === slot ? null : (
                  <button
                    key={slot}
                    onClick={() => updateItem.mutate({ itemId: openItem.id, slot })}
                    className="btn-base btn-wax px-3 py-2 text-[10.5px]"
                  >
                    Equip · {SLOT_LABEL[slot]}
                  </button>
                ),
              )}
              {openItem.equipped && (
                <button
                  onClick={() => updateItem.mutate({ itemId: openItem.id, equipped: false })}
                  className="btn-base btn-ghost-ink px-3 py-2 text-[10.5px]"
                >
                  Stow
                </button>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  disabled={openItem.qty <= 1 || updateItem.isPending}
                  onClick={() => updateItem.mutate({ itemId: openItem.id, qty: openItem.qty - 1 })}
                  className="btn-base btn-ghost-ink h-8 w-8"
                >
                  −
                </button>
                <span className="font-heading w-8 text-center text-[13px] font-bold text-ink">
                  {openItem.qty}
                </span>
                <button
                  disabled={updateItem.isPending}
                  onClick={() => updateItem.mutate({ itemId: openItem.id, qty: openItem.qty + 1 })}
                  className="btn-base btn-ghost-ink h-8 w-8"
                >
                  +
                </button>
                <button
                  onClick={() => {
                    deleteItem.mutate(openItem.id);
                    setOpenItemId(null);
                  }}
                  title="Drop"
                  className="btn-base btn-ghost-red h-8 w-8"
                >
                  <IconTrash size={13} strokeWidth={1.8} />
                </button>
              </div>
            </div>
          )}
        </ParchmentModal>
      )}

      {slotPicker && (
        <ParchmentModal onClose={() => setSlotPicker(null)} maxWidth="max-w-[440px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            Equip
          </div>
          <h3 className="font-display m-0 mb-4 text-center text-xl font-bold text-ink">
            {SLOT_LABEL[slotPicker]}
          </h3>
          {packItems.filter((i) => slotsFor(i).includes(slotPicker)).length === 0 ? (
            <div className="font-accent py-4 text-center text-[13px] italic text-ink-body">
              Nothing in the pack fits this slot.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {packItems
                .filter((i) => slotsFor(i).includes(slotPicker))
                .map((i) => (
                  <button
                    key={i.id}
                    onClick={() => {
                      updateItem.mutate({ itemId: i.id, slot: slotPicker });
                      setSlotPicker(null);
                    }}
                    className="parchment flex cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left transition hover:-translate-y-0.5"
                  >
                    <ItemGlyph it={i} />
                    <span className="font-heading min-w-0 flex-1 truncate text-[13px] font-bold text-ink">
                      {i.name}
                    </span>
                    <span className="flex-none text-[11px] text-ink-body">{keyStat(i)}</span>
                  </button>
                ))}
            </div>
          )}
        </ParchmentModal>
      )}

      {levelling && (
        <LevelUpModal character={character} onClose={() => setLevelling(false)} />
      )}
      <FloatingDiceTray />
    </div>
  );
}
