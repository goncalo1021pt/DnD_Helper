import type { EventName } from "../api/client";

/*
 * The event catalogue (#315) as a picker reads it: each name with a hint in
 * plain words. Mirrored from `events.All` on the server; one list here so
 * the webhook form, the email preferences and the table's channel agree.
 */
export const EVENTS: { name: EventName; hint: string }[] = [
  { name: "quest.posted", hint: "a notice reaches the board for you" },
  { name: "quest.claimed", hint: "somebody takes one up" },
  { name: "quest.completed", hint: "the DM marks one done" },
  { name: "handout.given", hint: "a prop is handed to you" },
  { name: "session.scheduled", hint: "the next gathering is set" },
  { name: "session.moved", hint: "the next gathering changes date" },
  { name: "hero.levelled", hint: "a hero rises a level" },
  { name: "hero.xp_awarded", hint: "XP is granted or docked" },
  { name: "encounter.started", hint: "a fight goes live" },
  { name: "encounter.ended", hint: "a fight stands down" },
  { name: "chronicle.written", hint: "somebody writes in the chronicle" },
  { name: "member.joined", hint: "somebody walks in with the invite code" },
  { name: "seat.requested", hint: "a player asks you, the DM, for a seat" },
];

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
