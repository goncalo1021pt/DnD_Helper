import type { Role } from "../../api/client";

/**
 * Hall chip showing the member's role: wax-red dot for the Dungeon Master,
 * green for a Player. Reflects the signed-in membership; not clickable.
 */
export default function RoleBadge({ role }: { role: Role }) {
  const dot = role === "dm" ? "#8b2520" : "#8fb15f";
  const label = role === "dm" ? "Dungeon Master" : "Player";
  return (
    <span className="chip-hall flex-none px-3.5 py-2">
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: dot, boxShadow: `0 0 7px ${dot}` }}
      />
      <span className="label-stamp text-[11px] font-semibold text-[#e6d5af]">
        {label}
      </span>
    </span>
  );
}
