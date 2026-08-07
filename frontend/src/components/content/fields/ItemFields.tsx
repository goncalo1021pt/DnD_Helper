import type { FieldProps } from "./shared";
import { input } from "./shared";

/*
Gear carried only what mattered in a fight (#101) — an AC, a damage die — so
there was nowhere to say what a thing costs, what it weighs, what it does, or
whether it is magical at all. Two of these were already *rendered* on the item
card and simply could not be written: the description and a weapon's properties.

Rarity is what makes an item magical; there is no separate "magic" type,
because a magic sword is still a sword and everything that reads a weapon
should go on reading it as one.
*/

const RARITIES = ["", "common", "uncommon", "rare", "very rare", "legendary", "artifact"];

// Where a worn thing hangs (#189) — mirrors wearSlots on the server.
const WEAR_KINDS = ["", "cloak", "amulet", "helm", "belt", "boots", "gloves", "bracers", "ring"];

export default function ItemFields({ data, set, strArr }: FieldProps) {
  const itemType = (data.type as string) ?? "gear";
  const rarity = (data.rarity as string) ?? "";
  return (
    <>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Item type</span>
        <select
          className={`${input} w-44 cursor-pointer`}
          value={itemType}
          onChange={(e) => set("type", e.target.value)}
        >
          <option value="gear">Gear (anything else)</option>
          <option value="armor">Armor</option>
          <option value="shield">Shield</option>
          <option value="weapon">Weapon</option>
        </select>
      </label>
      {itemType === "armor" && (
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Category</span>
            <select className={`${input} w-36 cursor-pointer`}
              value={(data.category as string) ?? "Light"}
              onChange={(e) => set("category", e.target.value)}>
              <option>Light</option><option>Medium</option><option>Heavy</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Base AC</span>
            <input type="number" min={10} max={20} className={`${input} w-24`}
              value={(data.ac as number) ?? 11}
              onChange={(e) => set("ac", Number(e.target.value))} />
          </label>
          <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-[13px]">
            <input type="checkbox"
              checked={(data.stealthDisadvantage as boolean) ?? false}
              onChange={(e) => set("stealthDisadvantage", e.target.checked)} />
            <span className="field-label">Stealth disadvantage</span>
          </label>
        </div>
      )}
      {itemType === "shield" && (
        <label className="flex flex-col gap-1.5">
          <span className="field-label">AC bonus</span>
          <input type="number" min={1} max={3} className={`${input} w-24`}
            value={(data.acBonus as number) ?? 2}
            onChange={(e) => set("acBonus", Number(e.target.value))} />
        </label>
      )}
      {itemType === "weapon" && (
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Category</span>
            <select className={`${input} w-36 cursor-pointer`}
              value={(data.category as string) ?? "Simple"}
              onChange={(e) => set("category", e.target.value)}>
              <option>Simple</option><option>Martial</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Damage</span>
            <input className={`${input} w-24`} placeholder="1d8"
              value={(data.damage as string) ?? ""}
              onChange={(e) => set("damage", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Two-handed die</span>
            <input className={`${input} w-24`} placeholder="1d10"
              title="Versatile weapons only — the die rolled when held in both hands"
              value={(data.damage2 as string) ?? ""}
              onChange={(e) => set("damage2", e.target.value === "" ? undefined : e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Damage type</span>
            <input className={`${input} w-36`} placeholder="slashing"
              value={(data.damageType as string) ?? ""}
              onChange={(e) => set("damageType", e.target.value)} />
          </label>
          <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-[13px]">
            <input type="checkbox"
              checked={(data.ranged as boolean) ?? false}
              onChange={(e) => set("ranged", e.target.checked)} />
            <span className="field-label">Ranged</span>
          </label>
          <label className="flex min-w-44 flex-1 flex-col gap-1.5">
            <span className="field-label">Properties</span>
            <input className={input} placeholder="Finesse, Light, Thrown"
              value={strArr("properties").join(", ")}
              onChange={(e) =>
                set("properties", e.target.value.split(",").map((p) => p.trim()).filter(Boolean))
              } />
          </label>
        </div>
      )}

      {/* True of a rope and a Vorpal Sword alike, so they sit outside the type. */}
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Cost</span>
          <input className={`${input} w-28`} placeholder="15 gp"
            value={(data.cost as string) ?? ""}
            onChange={(e) => set("cost", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Weight (lb)</span>
          <input type="number" min={0} className={`${input} w-24`}
            value={typeof data.weight === "number" ? (data.weight as number) : ""}
            onChange={(e) =>
              set("weight", e.target.value === "" ? undefined : Number(e.target.value))
            } />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Rarity</span>
          <select className={`${input} w-36 cursor-pointer`} value={rarity}
            onChange={(e) => {
              // Losing the rarity un-magics the item, and an attunement left
              // behind would be a mundane rope asking to be attuned to — which
              // the server refuses, so the form should not offer it.
              if (e.target.value === "") set("attunement", false);
              set("rarity", e.target.value);
            }}>
            {RARITIES.map((r) => (
              <option key={r || "none"} value={r}>{r === "" ? "Not magical" : r}</option>
            ))}
          </select>
        </label>
        {rarity !== "" && (
          <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-[13px]">
            <input type="checkbox"
              checked={(data.attunement as boolean) ?? false}
              onChange={(e) => set("attunement", e.target.checked)} />
            <span className="field-label">Requires attunement</span>
          </label>
        )}
        {itemType === "gear" && (
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Worn as</span>
            <select className={`${input} w-36 cursor-pointer`}
              value={(data.wear as string) ?? ""}
              onChange={(e) => set("wear", e.target.value === "" ? undefined : e.target.value)}>
              {WEAR_KINDS.map((w) => (
                <option key={w || "none"} value={w}>{w === "" ? "Carried" : w}</option>
              ))}
            </select>
          </label>
        )}
        {/* The +N the engines apply (#189): AC on armor, shields and worn
            items, attack and damage on weapons. Magic only — the server
            refuses a bonus without a rarity, so the form does not offer one. */}
        {rarity !== "" && (itemType !== "gear" || Boolean(data.wear)) && (
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Magic bonus</span>
            <select className={`${input} w-28 cursor-pointer`}
              value={typeof data.bonus === "number" ? String(data.bonus) : ""}
              onChange={(e) =>
                set("bonus", e.target.value === "" ? undefined : Number(e.target.value))
              }>
              <option value="">None</option>
              <option value="1">+1</option>
              <option value="2">+2</option>
              <option value="3">+3</option>
            </select>
          </label>
        )}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="field-label">The entry (what it does)</span>
        <textarea rows={5} className={`${input} min-h-[100px] leading-relaxed`}
          placeholder="What holding it is worth — paragraphs, **bold** and _italics_ welcome."
          value={(data.description as string) ?? ""}
          onChange={(e) => set("description", e.target.value)} />
      </label>
    </>
  );
}
