import type { FieldProps } from "./shared";
import { input } from "./shared";

export default function ItemFields({ data, set }: FieldProps) {
  const itemType = (data.type as string) ?? "gear";
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
        </div>
      )}
    </>
  );
}
