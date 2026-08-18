import type { Role } from "../api/client";

/*
 * Every room in a campaign, written down once (#231).
 *
 * The rail and the Hall used to keep separate lists of the same destinations,
 * and they drifted: Folk reached the rail and never got a Hall block, so a
 * feature that had shipped was reachable only by someone who already knew it
 * was there. VISION.md's own lesson — a capability nobody can find is
 * indistinguishable from one that does not exist.
 *
 * Both navs now read this list. The rail groups it into families; the Hall
 * lays it out in the order written here. `hall` is a required field, so there
 * is no way to add a room without saying where its door is.
 */

/** The families the rail groups into. `hall` is the lone leading chip. */
export type Family = "hall" | "story" | "world" | "table" | "yours";

/** Words that differ depending on which side of the screen is reading. */
export interface RoleCopy {
  dm: string;
  player: string;
}

/** Where a section's door sits on the Hall. */
export type HallDoor =
  /** The Hall itself — standing in it is the door. */
  | { kind: "self" }
  /** A block: header, and a body — a whisper, or something the Hall draws. */
  | {
      kind: "block";
      column: "left" | "right";
      title: string;
      linkLabel: RoleCopy;
      body: RoleCopy | "custom";
    }
  /** A row on the DM's Screen / Your Pack panel in the right rail. */
  | { kind: "screen"; title: string; sub: string };

export interface Section {
  key: string;
  /** Route, relative to the campaign. */
  to: string;
  /** The word on the rail. */
  label: string;
  family: Family;
  /** The rail's NavLink matches exactly — only the index needs it. */
  end?: boolean;
  /** Absent means both roles; set means that role alone. */
  only?: Role;
  hall: HallDoor;
}

/**
 * The rooms, in the order the Hall lays them out. The rail reorders by
 * family, so this array is free to lead with the two blocks a table looks at
 * every session and group the rest behind them.
 */
export const SECTIONS: Section[] = [
  {
    key: "hall",
    to: ".",
    label: "The Hall",
    family: "hall",
    end: true,
    hall: { kind: "self" },
  },
  {
    key: "board",
    to: "board",
    label: "Board",
    family: "story",
    hall: {
      kind: "block",
      column: "left",
      title: "The Quest Board",
      linkLabel: { dm: "Open the board", player: "Open the board" },
      body: "custom",
    },
  },
  {
    key: "party",
    to: "party",
    label: "Party",
    family: "table",
    hall: {
      kind: "block",
      column: "left",
      title: "The Party",
      linkLabel: { dm: "Manage the party", player: "Meet the party" },
      body: "custom",
    },
  },
  {
    key: "world",
    to: "world",
    label: "World",
    family: "world",
    hall: {
      kind: "block",
      column: "left",
      title: "The World",
      linkLabel: { dm: "Open the gazetteer", player: "Open the gazetteer" },
      body: {
        dm: "Chart realms and the cities inside them, move one that was filed wrong, and choose who knows each exists. Every place is a page: who lives there, what is sold, what hangs on the board.",
        player:
          "The realms and cities your party has been let in on — and, on each one's page, everything you know of it.",
      },
    },
  },
  {
    key: "map",
    to: "map",
    label: "Map",
    family: "world",
    hall: {
      kind: "block",
      column: "left",
      title: "The Map",
      linkLabel: { dm: "Unroll the map", player: "Unroll the map" },
      body: {
        dm: "Hang your world, pin what matters, and lead the party from region to region.",
        player: "The lands your party travels — follow the pins the DM has placed.",
      },
    },
  },
  {
    key: "npcs",
    to: "npcs",
    label: "Folk",
    family: "world",
    hall: {
      kind: "block",
      column: "left",
      title: "The Folk",
      linkLabel: { dm: "Open the register", player: "Who you have met" },
      body: {
        dm: "The people your world turns on — file them where the party will meet them, and choose who is known and whose numbers may be read.",
        player: "The people you have met, and whatever you have learned of them.",
      },
    },
  },
  {
    key: "vendors",
    to: "vendors",
    label: "Bazaar",
    family: "world",
    hall: {
      kind: "block",
      column: "left",
      title: "The Bazaar",
      linkLabel: { dm: "Open the bazaar", player: "Go shopping" },
      body: {
        dm: "Stock a shop at home and file it under a place; show the party the shelves you want them to see.",
        player: "The traders you have met, and what they have out on the counter.",
      },
    },
  },
  {
    key: "trees",
    to: "trees",
    label: "Trees",
    family: "table",
    hall: {
      kind: "block",
      column: "left",
      title: "The Skill Trees",
      linkLabel: { dm: "Open the trees", player: "Open the trees" },
      body: {
        dm: "Weave webs of powers outside the standard rules, bind heroes to a pact, and grant picks at story beats.",
        player:
          "The webs your DM has woven — spend the picks the story grants you, node by node.",
      },
    },
  },
  {
    key: "encounters",
    to: "encounters",
    label: "Encounters",
    family: "table",
    hall: {
      kind: "block",
      column: "left",
      title: "Encounters",
      linkLabel: { dm: "Open encounters", player: "See the battle" },
      body: {
        dm: "Prepare battles from the Den and your party, then trigger them and run initiative in-app.",
        player:
          "When the DM triggers a fight, the initiative order and whose turn it is show up here.",
      },
    },
  },
  {
    key: "bestiary",
    to: "bestiary",
    label: "Bestiary",
    family: "table",
    hall: {
      kind: "block",
      column: "left",
      title: "The Bestiary",
      linkLabel: { dm: "Open the bestiary", player: "Open the bestiary" },
      body: {
        dm: "What your heroes have met — identify each creature and reveal its record, piece by piece.",
        player:
          "Log the creatures you face, share notes, and collect the stat blocks the DM hands you.",
      },
    },
  },
  {
    key: "codex",
    to: "codex",
    label: "Codex",
    family: "table",
    hall: {
      kind: "block",
      column: "left",
      title: "The Codex",
      linkLabel: { dm: "Open the codex", player: "Open the codex" },
      body: {
        dm: "Rule on what exists in this world — ban SRD entries, admit homebrew.",
        player: "What the DM has ruled legal at this table.",
      },
    },
  },
  {
    key: "chronicle",
    to: "chronicle",
    label: "Chronicle",
    family: "story",
    hall: {
      kind: "block",
      column: "right",
      title: "The Chronicle",
      linkLabel: { dm: "Open the chronicle", player: "Open the chronicle" },
      body: "custom",
    },
  },
  {
    key: "den",
    to: "den",
    label: "The Den",
    family: "yours",
    only: "dm",
    hall: {
      kind: "screen",
      title: "The Monster Den",
      sub: "Your private menagerie, statted and searchable",
    },
  },
  {
    key: "dm",
    to: "dm",
    label: "DM Menu",
    family: "yours",
    only: "dm",
    hall: {
      kind: "screen",
      title: "DM Menu",
      sub: "Table rules, XP & milestones — kick or ban",
    },
  },
  {
    key: "player",
    to: "player",
    label: "Player Menu",
    family: "yours",
    only: "player",
    hall: {
      kind: "screen",
      title: "Player Menu",
      sub: "Your heroes at this table — or the door out",
    },
  },
];

/** The Hall blocks the dashboard draws itself rather than as a whisper. */
export const CUSTOM_BODY_KEYS = ["board", "party", "chronicle"] as const;
export type CustomBodyKey = (typeof CUSTOM_BODY_KEYS)[number];

/** Rail order, which is not the Hall's — families first, then as written. */
const FAMILY_ORDER: Family[] = ["hall", "story", "world", "table", "yours"];

/** The word over a cluster. The Hall stands alone and needs none; the last
    family borrows the caption from its own panel on the Hall. */
const FAMILY_LABEL: Record<Family, RoleCopy> = {
  hall: { dm: "", player: "" },
  story: { dm: "the story", player: "the story" },
  world: { dm: "the world", player: "the world" },
  table: { dm: "the table", player: "the table" },
  yours: { dm: "yours alone", player: "yours to carry" },
};

/** Everything this role may see, in Hall order. */
export function sectionsFor(role: Role): Section[] {
  return SECTIONS.filter((s) => !s.only || s.only === role);
}

export function sectionByKey(key: string): Section | undefined {
  return SECTIONS.find((s) => s.key === key);
}

/** The rail: clusters in family order, each with the word that heads it. */
export function railFamilies(
  role: Role,
): { family: Family; label: string; items: Section[] }[] {
  const mine = sectionsFor(role);
  return FAMILY_ORDER.map((family) => ({
    family,
    label: FAMILY_LABEL[family][role],
    items: mine.filter((s) => s.family === family),
  })).filter((g) => g.items.length > 0);
}

/** The Hall's blocks for one column, in the order this file writes them. */
export function hallBlocks(role: Role, column: "left" | "right"): Section[] {
  return sectionsFor(role).filter(
    (s) => s.hall.kind === "block" && s.hall.column === column,
  );
}

/** The rows on the DM's Screen / Your Pack panel. */
export function screenRows(role: Role): Section[] {
  return sectionsFor(role).filter((s) => s.hall.kind === "screen");
}

/** The copy for whichever side is reading. */
export function forRole(copy: RoleCopy, role: Role): string {
  return copy[role];
}
