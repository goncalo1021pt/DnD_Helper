import { useState } from "react";

/*
What this viewer has switched off on this map (#355).

Which layers you have open is a convenience, not knowledge: nothing here is a
veil, and the server never hears of it. A player who turns the roads off has
the same payload as one who does not. So it lives in the browser, per map,
and a full or disabled localStorage only means the choices are not remembered.

The state is a flat record of row keys to on/off, holding only what the viewer
has *changed* — a row absent from it falls back to its default. That is what
lets the rows grow without a migration of this record: the four built-ins
today, a DM's named layers next (`layer:<id>`, defaulting to whatever the DM
set), and each player's own marks after that (#356).
*/

/** The four rows every map has, needing no schema: what kind of thing is drawn. */
export const BUILT_IN_ROWS = [
  { key: "pins", label: "Pins" },
  { key: "roads", label: "Roads" },
  { key: "regions", label: "Regions" },
  { key: "names", label: "Names" },
] as const;

export type BuiltInKey = (typeof BUILT_IN_ROWS)[number]["key"];

type Choices = Record<string, boolean>;

const storageKey = (mapId: string) => `questboard:map-view:${mapId}`;

function read(mapId: string | undefined): Choices {
  if (!mapId) return {};
  try {
    const raw = localStorage.getItem(storageKey(mapId));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Choices) : {};
  } catch {
    return {};
  }
}

function write(mapId: string, choices: Choices) {
  try {
    if (Object.keys(choices).length === 0) localStorage.removeItem(storageKey(mapId));
    else localStorage.setItem(storageKey(mapId), JSON.stringify(choices));
  } catch {
    // Not remembered is not broken.
  }
}

export type MapView = {
  /** Whether a row is drawn — the viewer's choice, else the row's default. */
  shown: (key: string, byDefault?: boolean) => boolean;
  set: (key: string, on: boolean) => void;
  /** Every one of these rows on, or every one off. */
  setAll: (keys: readonly string[], on: boolean) => void;
};

export function useMapView(mapId: string | undefined): MapView {
  const [state, setState] = useState(() => ({ mapId, choices: read(mapId) }));
  // Another map on the table is another set of choices. Read during render
  // rather than in an effect, so the first frame of a new map is already right.
  let choices = state.choices;
  if (state.mapId !== mapId) {
    choices = read(mapId);
    setState({ mapId, choices });
  }

  function update(next: Choices) {
    if (!mapId) return;
    write(mapId, next);
    setState({ mapId, choices: next });
  }

  return {
    shown: (key, byDefault = true) => choices[key] ?? byDefault,
    set: (key, on) => update({ ...choices, [key]: on }),
    setAll: (keys, on) => update({ ...choices, ...Object.fromEntries(keys.map((k) => [k, on])) }),
  };
}
