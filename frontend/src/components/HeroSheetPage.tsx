import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { InventoryItem, RulesContent } from "../api/client";
import {
  useAddItem,
  useCampaigns,
  useCharacterDetail,
  useDeleteItem,
  useRules,
  useSetSpellSlots,
  useSwapSpells,
  useUpdateItem,
} from "../hooks";
import { classLine } from "../lib/classes";
import { levelUpHold } from "../lib/progression";
import { acFromEquipment, featuresOf, profBonus, weaponAttacks, type Feature } from "../lib/derive";
import { hpColor, initials, medallionFor } from "../lib/party";
import AbilityRow from "./ui/AbilityRow";
import { abilityMod, modText } from "../lib/abilities";
import SpellEntry, { SpellFlags } from "./ui/SpellEntry";
import ContentEntry from "./ui/ContentEntry";
import RestPanel from "./sheet/RestPanel";
import SpellSwapModal, { canSwapOn } from "./ui/SpellSwapModal";
import { casterSourceFor } from "../lib/spellcasting";
import { printHeroSheet } from "../lib/sheet/print";

import FloatingDiceTray from "./ui/DiceTray";
import ParchmentModal from "./ui/ParchmentModal";
import LevelUpModal from "./LevelUpModal";
import {
  IconCoin,
  IconPlus,
  IconPrinter,
  IconTrash,
} from "./ui/icons";
import { BATTLE_SLOTS, SLOT_LABEL, armoryGroups, itemTypeOf, keyStat, needsAttunement, slotsFor, type EquipSlot } from "./sheet/items";
import ItemGlyph from "./sheet/ItemGlyph";
import SectionLabel, { type SpeciesChoice } from "./sheet/SectionLabel";
import SkillsPanel from "./sheet/SkillsPanel";
import ClassTablePanel from "./sheet/ClassTablePanel";
import FeaturesPanel from "./sheet/FeaturesPanel";
import PoolsPanel from "./sheet/PoolsPanel";
import CreaturesPanel from "./sheet/CreaturesPanel";

export default function HeroSheetPage() {
  const { heroId } = useParams<{ heroId: string }>();
  const { data: detail, isLoading, error } = useCharacterDetail(heroId);
  const { data: memberships } = useCampaigns();
  const { data: classes } = useRules("class");
  const { data: subclasses } = useRules("subclass");
  const { data: itemLibrary } = useRules("item");
  const { data: spellLibrary } = useRules("spell");
  // Species, background and feats: the three sources the Features panel used to
  // ignore (#131), and what the printer reads to say the same on paper.
  const { data: speciesLibrary } = useRules("species");
  const { data: backgroundLibrary } = useRules("background");
  const { data: feats } = useRules("feat");
  const setSlots = useSetSpellSlots(heroId ?? "");
  const swapSpells = useSwapSpells(heroId ?? "");
  const addItem = useAddItem(heroId ?? "");
  const updateItem = useUpdateItem(heroId ?? "");
  const deleteItem = useDeleteItem(heroId ?? "");
  const [levelling, setLevelling] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
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
  // Where the starting class's casting is declared — on the class, or on its
  // subclass for an Eldritch Knight / Arcane Trickster (#220).
  const casterSource = casterSourceFor(klass, subclass);
  const species = speciesLibrary?.find((s) => s.id === sheet?.speciesId);
  const background = backgroundLibrary?.find((b) => b.id === sheet?.backgroundId);

  // The rig: what sits where. Coin gets a purse, not a tile.
  const purse = detail?.items.find((i) => !i.content && i.name === "Gold Pieces");
  const packItems = (detail?.items ?? []).filter((i) => i.id !== purse?.id);
  const bySlot = Object.fromEntries(
    (Object.keys(SLOT_LABEL) as EquipSlot[]).map((s) => [s, detail?.items.find((i) => i.slot === s)]),
  ) as Record<EquipSlot, InventoryItem | undefined>;
  // Worn slots only earn a tile once something hangs there — twelve empty
  // boxes is a wardrobe, not a sheet. The two-handed grip is not worn either;
  // it redraws the hand tiles below.
  const gripped = bySlot["bothhands"];
  const wornFilled = (Object.keys(SLOT_LABEL) as EquipSlot[]).filter(
    (s) => !BATTLE_SLOTS.includes(s) && s !== "bothhands" && bySlot[s],
  );
  const attunedCount = (detail?.items ?? []).filter((i) => i.attuned).length;
  const openItem = detail?.items.find((i) => i.id === openItemId) ?? null;

  // Loot grows; the pack filters. Type chips + name search.
  const shownPack = packItems.filter((i) => {
    const t = itemTypeOf(i);
    if (itemType === "gear" ? t !== "" && t !== "gear" : itemType !== "" && t !== itemType)
      return false;
    const q = itemSearch.trim().toLowerCase();
    return !q || i.name.toLowerCase().includes(q);
  });

  /*
  Everything the hero actually has, from every source that grants one (#131).

  This read two of the five: class and subclass. So a Forest Gnome kept
  Darkvision, Gnomish Cunning and their lineage in the database and the sheet
  simply never looked — the player was told they had a species and never told
  what it did for them.

  Class and subclass come first and in level order, because that is how a player
  learns them. Species, background and feats follow, since they arrive whole at
  level 1 and a level number against them would be a fiction.
  */
  const features: Array<Feature & { from: string }> = useMemo(() => {
    if (!character) return [];
    const level = character.level;
    const from = (src: RulesContent | undefined, at = level) =>
      featuresOf(src, at).map((f) => ({ ...f, from: src?.name ?? "" }));

    /*
      Every class the hero holds, each read at their level IN that class
      (#190). This used to read the starting class alone, so a Rogue 5 /
      Wizard 3 was shown their Thief features and told nothing whatsoever
      about being a Wizard.

      A hero with one class takes the same path — their one entry, at their
      only level — so nothing changes for almost everyone.
    */
    const held = sheet?.classes ?? [];
    const perClass = held.length
      ? held.flatMap((k) => [
          ...from(classes?.find((c) => c.id === k.classId), k.level),
          ...from(subclasses?.find((s) => s.id === k.subclassId), k.level),
        ])
      : [...from(klass), ...from(subclass)];

    /*
      Some features arrive from more than one class and do not stack: "if you
      gain the Extra Attack feature from more than one class, the features
      don't stack" (PHB 2024, p.44). Listing it twice would read as two extra
      attacks. Shown once, from the class that granted it first, and said out
      loud rather than silently dropped.
    */
    const seen = new Map<string, Feature & { from: string }>();
    for (const f of perClass) {
      const key = f.name?.toLowerCase() ?? "";
      const already = seen.get(key);
      if (!already) {
        seen.set(key, f);
        continue;
      }
      already.from = `${already.from} · also ${f.from}, and does not stack`;
    }
    const earned = [...seen.values()].sort((a, b) => (a.level ?? 1) - (b.level ?? 1));

    // Species traits, and what a lineage pick turned into. The trait says
    // "choose one of the following"; the sheet should say which one you chose.
    const innate = from(species);
    if (species) {
      const choices = ((species.data as { choices?: SpeciesChoice[] }).choices ?? []);
      for (const [id, picked] of Object.entries(sheet?.speciesChoices ?? {})) {
        const options = choices.find((c) => c.id === id)?.options ?? [];
        for (const name of picked) {
          const option = options.find((o) => o.name === name);
          if (option?.summary) innate.push({ name, summary: option.summary, from: species.name });
        }
      }
    }

    // A feat is the whole of what a background grants beyond skills and a kit,
    // and the sheet listed them as bare names — a player reading "Magic Initiate
    // (Cleric)" learned nothing they did not already know from choosing it.
    const taken = (sheet?.feats ?? []).map((name) => {
      // A background records the feat with its specialisation — "Magic Initiate
      // (Cleric)" — while the library entry is just "Magic Initiate", so an
      // exact match alone would leave the most commonly granted feat wordless.
      const bare = name.replace(/\s*\(.*\)\s*$/, "");
      const entry = feats?.find((f) => f.name === name) ?? feats?.find((f) => f.name === bare);
      const data = entry?.data as { description?: string } | undefined;
      return { name, summary: data?.description ?? entry?.summary, from: "Feat" };
    });

    // The background's own grant that appears nowhere else on the sheet: its
    // skills are in the skill list and its kit is in the pack, but the tool has
    // had no home at all.
    const tool = (background?.data as { tool?: string } | undefined)?.tool;
    const trained = tool
      ? [{ name: "Tool Proficiency", summary: tool, from: background?.name ?? "Background" }]
      : [];

    return [...earned, ...innate, ...taken, ...trained];
  }, [
    character, klass, subclass, species, background, feats,
    sheet?.feats, sheet?.speciesChoices, sheet?.classes, classes, subclasses,
  ]);

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
    // Covers the table's veil too: a hero the DM keeps from you is, for now,
    // not yours to read.
    return (
      <div className="panel-hall px-5 py-[60px] text-center sm:px-[30px]">
        <div className="font-display text-2xl text-[#cdb582]">This hero is not yours to read</div>
        <Link to="/questboard/heroes" className="font-accent mt-2 inline-block text-base italic text-gold-muted no-underline hover:text-ember-bright">
          — back to My Heroes —
        </Link>
      </div>
    );
  }

  const table = memberships?.find((m) => m.campaign.id === character.campaignId)?.campaign;
  const hold = levelUpHold(character, table);
  const abilities = sheet?.abilities;
  const prof = profBonus(character.level);
  // Features, because Unarmored Defense replaces the base formula (#132).
  const ac = abilities ? acFromEquipment(detail.items, abilities, features) : null;
  const attacks = abilities ? weaponAttacks(detail.items, abilities, character.level) : [];
  const slots = sheet?.spellSlots ?? [];
  const hpc = hpColor(character.hpCurrent, character.hpMax);

  const pact = sheet?.pactSlots;
  // Which class each spell is prepared from (#190) — only worth saying when
  // the hero casts from more than one, since it decides the casting ability.
  const casters = detail?.casters ?? [];
  const classOfSpell = new Map<string, string>();
  if (casters.length > 1) {
    for (const c of casters) for (const id of c.spellIds) classOfSpell.set(id, c.className);
  }

  function sharedUsed() {
    const arr = new Array(9).fill(0);
    for (const s of slots) arr[s.level - 1] = s.used;
    return arr.slice(0, Math.max(1, ...slots.map((s) => s.level)));
  }

  function tickSlot(level: number, used: number, max: number, delta: number) {
    const next = Math.min(Math.max(used + delta, 0), max);
    if (next === used) return;
    const arr = sharedUsed();
    arr[level - 1] = next;
    setSlots.mutate({ used: arr });
  }

  function tickPact(delta: number) {
    if (!pact) return;
    const next = Math.min(Math.max(pact.used + delta, 0), pact.max);
    if (next === pact.used) return;
    setSlots.mutate({ used: sharedUsed(), pactUsed: next });
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
              Level {character.level} {classLine(character)}
              {subclass && ` · ${subclass.name}`}
              {character.campaignName && ` · seated at ${character.campaignName}`}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="label-stamp text-[10px] tracking-[1px]" style={{ color: hpc }}>
            HP {character.hpCurrent}/{character.hpMax}
          </span>
          <button
            disabled={printing}
            onClick={async () => {
              setPrinting(true);
              setPrintError(null);
              try {
                await printHeroSheet({
                  detail,
                  classes,
                  subclasses,
                  species: speciesLibrary,
                  backgrounds: backgroundLibrary,
                });
              } catch (e) {
                setPrintError(
                  e instanceof Error ? e.message : "the sheet would not print",
                );
              } finally {
                setPrinting(false);
              }
            }}
            title="Print this hero onto the official 2024 character sheet"
            // Ghost-gold, not ghost-ink: this sits on the dark hall header,
            // where ink-on-parchment colors read as a disabled button (#186).
            className="btn-base btn-ghost-gold h-10 gap-1.5 px-3 text-[10px]"
          >
            <IconPrinter size={14} strokeWidth={1.8} />
            {printing ? "Setting the ink…" : "Print"}
          </button>
          {canEdit && sheet && character.level < 20 && (
            hold ? (
              <span
                className="label-stamp rounded-[2px] px-2.5 py-2 text-[9.5px] tracking-[1.5px]"
                style={{ color: "#9a703a", background: "rgba(120,86,42,.12)", boxShadow: "inset 0 0 0 1px rgba(120,80,30,.35)" }}
                title="The DM controls when the party rises"
              >
                ⧗ {hold}
              </span>
            ) : (
              <button
                onClick={() => setLevelling(true)}
                className="btn-base btn-gold clip-octagon h-10 px-5 text-[12px]"
              >
                Level up
              </button>
            )
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
            <SkillsPanel sheet={sheet} prof={prof} />

            {/* features */}
            <FeaturesPanel features={features} />

            {/* Rages, Channel Divinity, Focus Points — the uses those
                features spend (#175). Under Features for the same reason the
                creatures are: the text granting them was just read. */}
            <PoolsPanel
              characterId={character.id}
              pools={sheet.pools ?? []}
              canEdit={canEdit}
            />

            {/* The second stat block: what the hero turns into, and what
                fights beside them. Sits under Features because that is where
                the feature granting it was just read. */}
            <CreaturesPanel
              characterId={character.id}
              creatures={detail.creatures}
              canEdit={canEdit}
            />

            {/* One action instead of three chores (#118). */}
            <RestPanel
              character={character}
              canEdit={canEdit}
              // Same guard the standalone button carries: a class MAY
              // re-prepare on a long rest, but a hero with nothing written down
              // has nothing to trade, and a modal saying so is noise at the end
              // of every night.
              onSpellSwap={() => {
                if ((detail?.spells ?? []).length > 0) setSwapping(true);
              }}
            />

            {/* The numbers the features text points at (#129). */}
            <ClassTablePanel klass={klass} level={character.level} />
          </div>
          )}

          {/* right column — the sole column on the Inventory tab */}
          <div className="flex flex-col gap-6">
            {/* spells */}
            {tab === "sheet" && (slots.length > 0 || spellsByLevel.length > 0) && (
              <section>
                <div className="mb-1.5 flex items-center justify-between">
                  <SectionLabel>Spells</SectionLabel>
                  {/* Half the 2024 casters re-prepare on a Long Rest; the rest
                      wait for a level, and their swap rides with the level-up. */}
                  {canEdit && canSwapOn(casterSource, "long-rest") && (detail?.spells ?? []).length > 0 && (
                    <button
                      onClick={() => setSwapping(true)}
                      // btn-ghost-gold without btn-base, so the chip keeps its
                      // stamp typography — the class carries the surface
                      // colors that were hand-rolled here before (#186).
                      className="label-stamp btn-ghost-gold mb-2.5 cursor-pointer border-none px-2.5 py-1 text-[9px] tracking-[1px]"
                    >
                      Change prepared spells
                    </button>
                  )}
                </div>
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
                      {/* Pact Magic sits apart because it IS apart: its own
                          slots, all at one level, back after an hour rather
                          than a night (#190). */}
                      {pact && (
                        <div className="flex items-center gap-2.5">
                          <span
                            className="label-stamp w-10 text-[9px] tracking-[1px] text-[#8b2520]"
                            title={`Pact Magic — ${pact.max} slot${pact.max === 1 ? "" : "s"} at level ${pact.level}, back on a short rest`}
                          >
                            Pact
                          </span>
                          <div className="flex gap-1.5">
                            {Array.from({ length: pact.max }, (_, i) => (
                              <button
                                key={i}
                                disabled={!canEdit}
                                onClick={() => tickPact(i < pact.used ? -1 : 1)}
                                aria-label={`Pact slot ${i + 1} of ${pact.max}`}
                                title={i < pact.used ? "spent — click to restore" : "click to spend"}
                                className="h-4 w-4 cursor-pointer rounded-full border-none p-0"
                                style={{
                                  background: i < pact.used ? "#3d2317" : "linear-gradient(180deg,#c96a5a,#8b2520)",
                                  boxShadow: "inset 0 0 0 1.5px rgba(61,35,23,.7)",
                                  opacity: canEdit ? 1 : 0.7,
                                }}
                              />
                            ))}
                          </div>
                          <span className="label-stamp text-[8.5px] tracking-[1px] text-ink-faded">
                            Lv {pact.level} · short rest
                          </span>
                        </div>
                      )}
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
                          {classOfSpell.has(s.id) && (
                            <span
                              className="label-stamp ml-1.5 text-[8px] tracking-[1px] text-ink-faded"
                              title="Cast off this class's spellcasting ability"
                            >
                              {classOfSpell.get(s.id)}
                            </span>
                          )}
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
                <div className="flex items-baseline gap-2.5">
                  <SectionLabel>Equipped</SectionLabel>
                  {attunedCount > 0 && (
                    <span
                      className="label-stamp mb-2.5 text-[9px] tracking-[1px] text-gold-muted tabular-nums"
                      title="Three items are the most a hero can attune to"
                    >
                      Attuned {attunedCount}/3
                    </span>
                  )}
                </div>
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
                {(gripped ? (["armor"] as EquipSlot[]) : BATTLE_SLOTS).map((slot) => {
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
                {/* Both hands on one weapon: one wide card where the two hand
                    tiles were, so the grip is visible before any number is. */}
                {gripped && (
                  <button
                    onClick={() => setOpenItemId(gripped.id)}
                    className="parchment col-span-2 cursor-pointer px-3 pb-2.5 pt-2 text-left transition hover:-translate-y-0.5"
                  >
                    <div className="label-stamp text-[8px] tracking-[1.5px] text-ink-label">
                      {SLOT_LABEL.bothhands}
                    </div>
                    <div className="font-heading mt-1 truncate text-[13px] font-bold text-ink">
                      {gripped.name}
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-body">{keyStat(gripped)}</div>
                  </button>
                )}
              </div>
              {/* What hangs on the body beyond the battle three (#189): only
                  the filled places draw — an empty wardrobe is not a sheet. */}
              {wornFilled.length > 0 && (
                <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(min(132px,100%),1fr))] gap-2">
                  {wornFilled.map((slot) => {
                    const it = bySlot[slot]!;
                    return (
                      <button
                        key={slot}
                        onClick={() => setOpenItemId(it.id)}
                        className="parchment cursor-pointer px-3 pb-2 pt-1.5 text-left transition hover:-translate-y-0.5"
                      >
                        <div className="flex items-baseline justify-between gap-1.5">
                          <span className="label-stamp text-[8px] tracking-[1.5px] text-ink-label">
                            {SLOT_LABEL[slot]}
                          </span>
                          {it.attuned && (
                            <span className="label-stamp text-[8px] tracking-[1px]" style={{ color: "#8b2520" }}>
                              attuned
                            </span>
                          )}
                        </div>
                        <div className="font-heading mt-0.5 truncate text-[12.5px] font-bold text-ink">
                          {it.name}
                        </div>
                        <div className="mt-0.5 min-h-[13px] text-[10.5px] text-ink-body">{keyStat(it)}</div>
                      </button>
                    );
                  })}
                </div>
              )}
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
                      {/* The armory outgrew one flat list when the SRD's magic
                          arrived (#189): mundane gear by type, magic by rarity. */}
                      {armoryGroups(itemLibrary ?? []).map(([label, entries]) => (
                        <optgroup key={label} label={label}>
                          {entries.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name}
                              {i.source === "homebrew" ? ` (${i.creatorName ?? "homebrew"})` : ""}
                            </option>
                          ))}
                        </optgroup>
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
                    {BATTLE_SLOTS.includes(slot) || slot === "bothhands" ? "Equip" : "Wear"} · {SLOT_LABEL[slot]}
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
              {/* The bond is its own act (#189): three at most, and the item
                  behaves mundane until it is formed. */}
              {needsAttunement(openItem) &&
                (openItem.attuned ? (
                  <button
                    onClick={() => updateItem.mutate({ itemId: openItem.id, attuned: false })}
                    className="btn-base btn-ghost-ink px-3 py-2 text-[10.5px]"
                  >
                    Break attunement
                  </button>
                ) : (
                  <button
                    disabled={attunedCount >= 3 || updateItem.isPending}
                    title={attunedCount >= 3 ? "Three items are the most a hero can attune to" : undefined}
                    onClick={() => updateItem.mutate({ itemId: openItem.id, attuned: true })}
                    className="btn-base btn-wax px-3 py-2 text-[10.5px] disabled:opacity-40"
                  >
                    Attune
                  </button>
                ))}
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
          {/* An empty hand also offers the two-handed weapons — picking one
              takes the grip, both hands at once. */}
          {packItems.filter((i) =>
            slotsFor(i).includes(slotPicker) ||
            ((slotPicker === "mainhand" || slotPicker === "offhand") && slotsFor(i).includes("bothhands")),
          ).length === 0 ? (
            <div className="font-accent py-4 text-center text-[13px] italic text-ink-body">
              Nothing in the pack fits this slot.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {packItems
                .filter((i) =>
                  slotsFor(i).includes(slotPicker) ||
                  ((slotPicker === "mainhand" || slotPicker === "offhand") && slotsFor(i).includes("bothhands")),
                )
                .map((i) => (
                  <button
                    key={i.id}
                    onClick={() => {
                      updateItem.mutate({
                        itemId: i.id,
                        slot: slotsFor(i).includes(slotPicker) ? slotPicker : "bothhands",
                      });
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

      {printError && (
        <div className="font-accent mt-4 text-center text-[13px] italic" style={{ color: "#8b2520" }}>
          — {printError} —
        </div>
      )}

      {levelling && (
        <LevelUpModal character={character} onClose={() => setLevelling(false)} />
      )}
      {swapping && (
        <SpellSwapModal
          klass={casterSource}
          // The long-rest trade is the STARTING class's, within its own list
          // at the hero's level in it — never the whole grimoire (#241).
          known={(detail?.spells ?? []).filter((s) =>
            ((detail?.casters ?? []).find((c) => c.classId === sheet?.classId)?.spellIds ?? []).includes(s.id),
          )}
          library={spellLibrary ?? []}
          characterLevel={
            sheet?.classes?.find((k) => k.classId === sheet?.classId)?.level ?? character.level
          }
          trigger="long-rest"
          busy={swapSpells.isPending}
          error={(swapSpells.error as { error?: string } | null)?.error}
          onClose={() => {
            swapSpells.reset();
            setSwapping(false);
          }}
          onConfirm={(swaps) =>
            swapSpells.mutate(swaps, {
              onSuccess: () => setSwapping(false),
            })
          }
        />
      )}
      <FloatingDiceTray />
    </div>
  );
}
