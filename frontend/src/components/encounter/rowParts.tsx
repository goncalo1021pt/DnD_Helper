/* The two smallest marks in the initiative order, shared by every kind of row —
   a lone combatant, a mob, one skeleton inside a mob, and the player's
   read-only view. */
import type React from "react";
import { HP_STATE_TONE } from "./theme";

export function HpStatePill({ state }: { state: string }) {
  return (
    <span
      className="label-stamp rounded-[2px] px-1.5 py-0.5 text-[8.5px] font-bold tracking-[1px]"
      style={{ color: HP_STATE_TONE[state], background: `${HP_STATE_TONE[state]}1c`, boxShadow: `inset 0 0 0 1px ${HP_STATE_TONE[state]}55` }}
    >
      {state}
    </span>
  );
}

/* ── shared: an initiative pip, current turn highlighted ──────────────── */
export function TurnMark({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span
      className="font-heading flex h-8 w-8 flex-none items-center justify-center rounded-[3px] text-[13px] font-bold tabular-nums"
      style={{
        color: active ? "#1c1108" : "#e0c890",
        background: active ? "#e0a94e" : "rgba(201,162,39,.1)",
        boxShadow: active ? "0 0 10px rgba(224,169,78,.5)" : "inset 0 0 0 1px rgba(201,162,39,.3)",
      }}
    >
      {children}
    </span>
  );
}
