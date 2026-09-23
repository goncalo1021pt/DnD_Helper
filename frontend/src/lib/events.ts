import type { EventName } from "../api/client";

/*
 * The event catalogue (#315) as a person reads it. Mirrored from `events.All`
 * on the server, in catalogue order, so the webhook form, the email
 * preferences and the table's channel agree — and, since #347, grouped by
 * what each event is about and labelled with a sentence, because the person
 * choosing what reaches their inbox is not the script that filters on the
 * name. The picker (`EventPicker`) draws the groups; the name still goes to
 * the wire unchanged.
 */

export type EventGroup = "The board" | "The table" | "Your hero" | "Fights";

/** The groups in the order the picker draws them. */
export const EVENT_GROUPS: EventGroup[] = ["The board", "The table", "Your hero", "Fights"];

export interface EventEntry {
  name: EventName;
  group: EventGroup;
  /** What happened, as a sentence — the label a person reads. */
  label: string;
}

export const EVENTS: EventEntry[] = [
  { name: "quest.posted", group: "The board", label: "A notice reaches the board for you" },
  { name: "quest.claimed", group: "The board", label: "Somebody takes one up" },
  { name: "quest.completed", group: "The board", label: "The DM marks one done" },
  { name: "handout.given", group: "Your hero", label: "A prop is handed to you" },
  { name: "session.scheduled", group: "The table", label: "The next gathering is set" },
  { name: "session.moved", group: "The table", label: "The next gathering changes date" },
  { name: "hero.levelled", group: "Your hero", label: "A hero rises a level" },
  { name: "hero.xp_awarded", group: "Your hero", label: "XP is granted or docked" },
  { name: "encounter.started", group: "Fights", label: "A fight goes live" },
  { name: "encounter.ended", group: "Fights", label: "A fight stands down" },
  { name: "chronicle.written", group: "The table", label: "Somebody writes in the chronicle" },
  { name: "member.joined", group: "The table", label: "Somebody walks in with the invite code" },
  { name: "seat.requested", group: "The table", label: "A player asks you, the DM, for a seat" },
];

/** The sentence for a name, for a row that lists what a hook hears. */
export const labelOf = (name: EventName): string => EVENTS.find((e) => e.name === name)?.label ?? name;

/** What may be emailed (#316): everything but the chronicle, a line per line being a flood. */
export const EMAIL_EVENTS = EVENTS.filter((e) => e.name !== "chronicle.written");

/**
 * What a table's channel is offered (#316): the events whose audience can be
 * the whole table. A hero's level and a seat request never are, so the
 * picker does not list them — the server would drop them anyway.
 */
export const TABLE_EVENTS = EVENTS.filter(
  (e) => !["hero.levelled", "hero.xp_awarded", "seat.requested"].includes(e.name),
);

/** A Discord incoming-webhook URL, by its shape. */
export const isDiscordUrl = (url: string) => /^https:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\//i.test(url.trim());
