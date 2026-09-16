import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { createCampaign, forgeHero, joinCampaign, newAccount, postQuest, registerViaAPI, seatHero, unique } from "./helpers";

/*
The event catalogue (#315), seen through the DM's feed.

The live layer is a nudge and says nothing; an event says what happened and
who may hear it. What is worth pinning is the audience, because that is the
veil restated for people who are not looking: a drafted notice is no event, a
reveal reaches only the newly told, XP is the hero's owner and the DMs, a seat
request is the DMs alone, and a player cannot read the feed at all — who was
told about a hidden thing is itself a spoiler.
*/

type Ev = {
  name: string;
  audience: string[];
  actor?: { id: string; name: string };
  payload: Record<string, unknown>;
};

const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const sorted = (ids: string[]) => [...ids].sort();

async function feed(ctx: APIRequestContext, campaignId: string): Promise<Ev[]> {
  const res = await ctx.get(`/api/campaigns/${campaignId}/feed?limit=200`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as Ev[];
}
const only = (evs: Ev[], name: string) => evs.filter((e) => e.name === name);

async function me(ctx: APIRequestContext): Promise<string> {
  return ((await (await ctx.get("/api/me")).json()) as { user: { id: string } }).user.id;
}

const aHero = (name: string) => ({
  name,
  className: "Barbarian",
  speciesName: "Dwarf",
  backgroundName: "Acolyte",
  abilities: { str: 15, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
  skills: ["Athletics", "Survival"],
});

test("what happened at a table, and who was told", async () => {
  const dm = await playwrightRequest.newContext();
  await registerViaAPI(dm, newAccount("dm"));
  const dmId = await me(dm);
  const campaign = await createCampaign(dm, unique("Table "));

  const pl = await playwrightRequest.newContext();
  await registerViaAPI(pl, newAccount("pl"));
  const plId = await me(pl);
  await joinCampaign(pl, campaign.inviteCode);

  // Walking in is an event for everyone.
  let evs = await feed(dm, campaign.id);
  const joined = only(evs, "member.joined");
  expect(joined).toHaveLength(1);
  expect(sorted(joined[0].audience)).toEqual(sorted([dmId, plId]));
  expect(joined[0].payload.userId).toBe(plId);
  expect(joined[0].actor?.id).toBe(plId);

  const heroId = await forgeHero(pl, aHero(unique("Grash ")));
  await seatHero(pl, heroId, campaign.id);

  // A visible notice is an event for who can see it; a drafted one is none.
  const visibleQuest = await postQuest(dm, campaign.id, "Rats in the cellar");
  const draft = await dm.post(`/api/campaigns/${campaign.id}/quests`, {
    data: { title: "The dragon", locationId: null, visibleToParty: false },
  });
  expect(draft.status(), await draft.text()).toBe(201);
  const draftId = (await draft.json()).id as string;

  evs = await feed(dm, campaign.id);
  let posted = only(evs, "quest.posted");
  expect(posted).toHaveLength(1);
  expect(posted[0].payload.questId).toBe(visibleQuest);
  expect(posted[0].payload.title).toBe("Rats in the cellar");
  expect(sorted(posted[0].audience)).toEqual(sorted([dmId, plId]));

  // Revealing the draft to the player's hero reaches the player — and only
  // the player, since the DM could always see it.
  const reveal = await dm.put(`/api/quests/${draftId}/visibility`, {
    data: { scope: "character", visible: true, characterId: heroId },
  });
  expect(reveal.status(), await reveal.text()).toBe(200);
  evs = await feed(dm, campaign.id);
  posted = only(evs, "quest.posted");
  expect(posted).toHaveLength(2);
  const revealed = posted.find((e) => e.payload.questId === draftId)!;
  expect(revealed.audience).toEqual([plId]);
  // Revealing it to the whole table now reaches nobody new: no event.
  await dm.put(`/api/quests/${draftId}/visibility`, { data: { scope: "table", visible: true } });
  expect(only(await feed(dm, campaign.id), "quest.posted")).toHaveLength(2);

  // A claim names who took it up.
  const claim = await pl.post(`/api/quests/${visibleQuest}/claim`);
  expect(claim.status(), await claim.text()).toBe(200);
  const claimed = only(await feed(dm, campaign.id), "quest.claimed");
  expect(claimed).toHaveLength(1);
  expect((claimed[0].payload.claimedBy as { id: string }).id).toBe(plId);
  // A claim is a row of its own; the notice stays "available" until the DM
  // judges it, and the payload says so truthfully.
  expect(claimed[0].payload.status).toBe("available");
  expect(sorted(claimed[0].audience)).toEqual(sorted([dmId, plId]));

  // A gathering set where there was none, moved where there was, and a
  // re-set to the same date is neither.
  const first = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const later = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
  for (const at of [first, first, later]) {
    const res = await dm.put(`/api/campaigns/${campaign.id}/next-session`, { data: { nextSessionAt: at } });
    expect(res.status(), await res.text()).toBe(200);
  }
  evs = await feed(dm, campaign.id);
  const scheduled = only(evs, "session.scheduled");
  const moved = only(evs, "session.moved");
  expect(scheduled).toHaveLength(1);
  expect(moved).toHaveLength(1);
  expect(new Date(scheduled[0].payload.at as string).getTime()).toBe(new Date(first).getTime());
  expect(new Date(moved[0].payload.previousAt as string).getTime()).toBe(new Date(first).getTime());
  expect(new Date(moved[0].payload.at as string).getTime()).toBe(new Date(later).getTime());
  expect(sorted(moved[0].audience)).toEqual(sorted([dmId, plId]));

  // XP concerns the hero's owner and the DMs.
  const xp = await dm.post(`/api/campaigns/${campaign.id}/xp`, { data: { amount: 100, reason: "the rats" } });
  expect(xp.status(), await xp.text()).toBe(200);
  const awarded = only(await feed(dm, campaign.id), "hero.xp_awarded");
  expect(awarded).toHaveLength(1);
  expect(awarded[0].payload).toMatchObject({ heroId, amount: 100, total: 100, reason: "the rats" });
  expect(sorted(awarded[0].audience)).toEqual(sorted([dmId, plId]));

  // A chronicle line carries an excerpt, cut at 140 characters.
  const long = "We found the rats. ".repeat(20).trim();
  const note = await pl.post(`/api/campaigns/${campaign.id}/events`, { data: { message: long } });
  expect(note.status(), await note.text()).toBe(201);
  const written = only(await feed(dm, campaign.id), "chronicle.written");
  expect(written).toHaveLength(1);
  expect(written[0].payload.kind).toBe("player_note");
  expect((written[0].payload.excerpt as string).length).toBe(141);
  expect((written[0].payload.excerpt as string).endsWith("…")).toBeTruthy();
  expect(written[0].actor?.id).toBe(plId);

  // A fight going live and standing down is everyone's business.
  const enc = await dm.post(`/api/campaigns/${campaign.id}/encounters`, { data: { name: "Rats, many" } });
  expect(enc.status(), await enc.text()).toBe(201);
  const encId = (await enc.json()).id as string;
  for (const status of ["active", "active", "inactive"]) {
    const res = await dm.patch(`/api/encounters/${encId}`, { data: { status } });
    expect(res.status(), await res.text()).toBe(200);
  }
  evs = await feed(dm, campaign.id);
  expect(only(evs, "encounter.started")).toHaveLength(1);
  expect(only(evs, "encounter.ended")).toHaveLength(1);
  expect(only(evs, "encounter.started")[0].payload.name).toBe("Rats, many");

  // A second player, so a handout to one hero can be seen to reach one.
  const other = await playwrightRequest.newContext();
  await registerViaAPI(other, newAccount("other"));
  await joinCampaign(other, campaign.inviteCode);
  const otherHero = await forgeHero(other, aHero(unique("Fizwick ")));
  await seatHero(other, otherHero, campaign.id);

  const hidden = await dm.post(`/api/campaigns/${campaign.id}/handouts`, {
    data: { title: "A sealed letter", caption: "Red wax", imageBase64: PNG_1x1, visibleToParty: false },
  });
  expect(hidden.status(), await hidden.text()).toBe(201);
  const handoutId = (await hidden.json()).id as string;
  expect(only(await feed(dm, campaign.id), "handout.given")).toHaveLength(0);
  const handed = await dm.put(`/api/handouts/${handoutId}/visibility`, {
    data: { scope: "character", visible: true, characterId: heroId },
  });
  expect(handed.status(), await handed.text()).toBe(200);
  const given = only(await feed(dm, campaign.id), "handout.given");
  expect(given).toHaveLength(1);
  expect(given[0].audience).toEqual([plId]);
  expect(given[0].payload).toMatchObject({ handoutId, title: "A sealed letter", caption: "Red wax" });

  // With approval on, a knock at the door is the DMs' business alone.
  const gate = await dm.put(`/api/campaigns/${campaign.id}/seating-approval`, { data: { enabled: true } });
  expect(gate.status(), await gate.text()).toBe(200);
  const knocker = await playwrightRequest.newContext();
  await registerViaAPI(knocker, newAccount("knock"));
  const knockerId = await me(knocker);
  await joinCampaign(knocker, campaign.inviteCode);
  const third = await forgeHero(knocker, aHero(unique("Knock ")));
  const knock = await knocker.put(`/api/characters/${third}/seat`, { data: { campaignId: campaign.id } });
  expect(knock.status(), await knock.text()).toBe(202);
  const requested = only(await feed(dm, campaign.id), "seat.requested");
  expect(requested).toHaveLength(1);
  expect(requested[0].audience).toEqual([dmId]);
  expect(requested[0].payload).toMatchObject({ heroId: third, userId: knockerId });

  // Only the screen reads the feed.
  expect((await pl.get(`/api/campaigns/${campaign.id}/feed`)).status()).toBe(403);
  expect((await other.get(`/api/campaigns/${campaign.id}/feed`)).status()).toBe(403);
  expect((await knocker.get(`/api/campaigns/${campaign.id}/feed`)).status()).toBe(403);

  // Everything is newest first, and everything names the table.
  evs = await feed(dm, campaign.id);
  expect(evs[0].name).toBe("seat.requested");
  expect(evs.every((e) => (e as unknown as { campaignId: string }).campaignId === campaign.id)).toBeTruthy();

  await dm.dispose();
  await pl.dispose();
  await other.dispose();
  await knocker.dispose();
});
