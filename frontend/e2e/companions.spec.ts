import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  createCampaign,
  joinCampaign,
  newAccount,
  quickAddHero,
  registerViaAPI,
  unique,
} from "./helpers";

/*
Friends, and talking to them (#181).

Campaign chat already existed and is called the Chronicle. These are the two
rooms it never covered — one person, and one party — plus the link between
accounts that no campaign owns.

The parts worth pinning are the refusals. Discovery is a code and not a search,
so a code nobody holds and a code held by somebody who blocked you must answer
alike. A conversation opens between friends OR table-mates, and a block closes
it in both directions. A party room's door is whoever rides with it.
*/

async function roll(request: APIRequestContext) {
  const res = await request.get("/api/me/friends");
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as {
    friendCode: string;
    friends: { userId: string; name: string; state: string; direction: string }[];
    blocked: { userId: string; name: string }[];
  };
}

/** Register a fresh account in its own context and hand back its page. */
async function person(browser: Parameters<typeof test>[0] extends never ? never : any, prefix: string) {
  const ctx = await browser.newContext();
  const page: Page = await ctx.newPage();
  await page.goto("/");
  await registerViaAPI(page.request, newAccount(prefix));
  return { ctx, page };
}

test("a friend code is asked for, answered, and is the only way in", async ({ browser }) => {
  const a = await person(browser, "compa");
  const b = await person(browser, "compb");

  const bRoll = await roll(b.page.request);
  expect(bRoll.friendCode).toHaveLength(8);
  // The characters people misread are not in it — this is read aloud, so it
  // has to hold for the code the DATABASE draws as well as the one Go does.
  expect(bRoll.friendCode).not.toMatch(/[OI01L]/);

  // And it still holds after reforging, which draws from Go's own alphabet.
  const reforged = await b.page.request.post("/api/me/friends/code");
  expect(reforged.ok(), await reforged.text()).toBeTruthy();
  const fresh = (await reforged.json()).friendCode as string;
  expect(fresh).toMatch(/^[A-Z2-9]{8}$/);
  expect(fresh).not.toBe(bRoll.friendCode);

  // A code nobody holds is refused, and says nothing about who does hold one.
  const nobody = await a.page.request.post("/api/me/friends", {
    data: { friendCode: "ZZZZZZZZ" },
  });
  expect(nobody.status()).toBe(404);

  // Your own code is not a way to befriend yourself.
  const aRoll = await roll(a.page.request);
  const self = await a.page.request.post("/api/me/friends", {
    data: { friendCode: aRoll.friendCode },
  });
  expect(self.status()).toBe(400);

  // A retired code is a code nobody holds.
  const retired = await a.page.request.post("/api/me/friends", {
    data: { friendCode: bRoll.friendCode },
  });
  expect(retired.status()).toBe(404);

  // Asking properly leaves it waiting on the other side, not accepted.
  const asked = await a.page.request.post("/api/me/friends", {
    data: { friendCode: fresh },
  });
  expect(asked.ok(), await asked.text()).toBeTruthy();
  expect((await asked.json()).friends[0]).toMatchObject({ state: "pending", direction: "asked" });

  const waiting = await roll(b.page.request);
  expect(waiting.friends[0]).toMatchObject({ state: "pending", direction: "invited" });

  // Until it is accepted, there is no conversation to open.
  const early = await a.page.request.post(`/api/me/messages/${waiting.friends[0].userId}`, {
    data: { body: "too soon" },
  });
  expect(early.status()).toBe(404);

  // Accepting makes it mutual from both sides, and who asked stops mattering.
  const accepted = await b.page.request.put(`/api/me/friends/${waiting.friends[0].userId}`);
  expect(accepted.ok(), await accepted.text()).toBeTruthy();
  for (const who of [a.page, b.page]) {
    const r = await roll(who.request);
    expect(r.friends[0]).toMatchObject({ state: "accepted", direction: "mutual" });
  }

  await a.ctx.close();
  await b.ctx.close();
});

test("two people asking each other means yes", async ({ browser }) => {
  const a = await person(browser, "mutua");
  const b = await person(browser, "mutub");
  const aRoll = await roll(a.page.request);
  const bRoll = await roll(b.page.request);

  await a.page.request.post("/api/me/friends", { data: { friendCode: bRoll.friendCode } });
  // B does not answer A's request — B asks A, which is the same thing said the
  // other way round, and should not become a second row nobody can answer.
  const back = await b.page.request.post("/api/me/friends", {
    data: { friendCode: aRoll.friendCode },
  });
  expect(back.ok(), await back.text()).toBeTruthy();

  const after = await roll(b.page.request);
  expect(after.friends).toHaveLength(1);
  expect(after.friends[0].state).toBe("accepted");

  await a.ctx.close();
  await b.ctx.close();
});

test("table-mates may talk without befriending each other first", async ({ browser }) => {
  const dm = await person(browser, "tabdm");
  const pl = await person(browser, "tabpl");
  const campaign = await createCampaign(dm.page.request, unique("The Common Room "));
  await joinCampaign(pl.page.request, campaign.inviteCode);

  const me = await (await dm.page.request.get("/api/me")).json();
  const them = await (await pl.page.request.get("/api/me")).json();

  // No friendship between them at all.
  expect((await roll(dm.page.request)).friends).toHaveLength(0);

  const said = await dm.page.request.post(`/api/me/messages/${them.user.id}`, {
    data: { body: "next tuesday then" },
  });
  expect(said.status()).toBe(201);

  // It arrives, is theirs rather than mine from the other side, and shows up
  // unread in the inbox until the thread is opened.
  const inbox = await (await pl.page.request.get("/api/me/messages")).json();
  expect(inbox).toHaveLength(1);
  expect(inbox[0]).toMatchObject({ peerId: me.user.id, unread: 1, lastWasMine: false });

  const thread = await (await pl.page.request.get(`/api/me/messages/${me.user.id}`)).json();
  expect(thread).toHaveLength(1);
  expect(thread[0]).toMatchObject({ body: "next tuesday then", mine: false });

  // Reading it is what marks it read.
  const after = await (await pl.page.request.get("/api/me/messages")).json();
  expect(after[0].unread).toBe(0);

  await dm.ctx.close();
  await pl.ctx.close();
});

test("a block stops it in both directions, and cannot be probed for", async ({ browser }) => {
  const a = await person(browser, "blka");
  const b = await person(browser, "blkb");
  const aRoll = await roll(a.page.request);
  const bRoll = await roll(b.page.request);

  await a.page.request.post("/api/me/friends", { data: { friendCode: bRoll.friendCode } });
  const bSees = await roll(b.page.request);
  const aId = bSees.friends[0].userId;
  await b.page.request.put(`/api/me/friends/${aId}`);

  // B blocks A. It parts them as well — staying friends with someone you have
  // blocked is a state that would only ever confuse whoever read it.
  const blocked = await b.page.request.put(`/api/me/blocks/${aId}`);
  expect(blocked.ok(), await blocked.text()).toBeTruthy();
  const bAfter = await roll(b.page.request);
  expect(bAfter.friends).toHaveLength(0);
  expect(bAfter.blocked.map((x) => x.userId)).toEqual([aId]);

  // A cannot send, cannot re-ask, and cannot tell a block from a bad code.
  const bId = (await roll(a.page.request)).friends.length; // A's roll is empty too
  expect(bId).toBe(0);
  const reask = await a.page.request.post("/api/me/friends", {
    data: { friendCode: bRoll.friendCode },
  });
  expect(reask.status()).toBe(404);
  const nobody = await a.page.request.post("/api/me/friends", {
    data: { friendCode: "ZZZZZZZZ" },
  });
  expect(nobody.status()).toBe(reask.status());

  // And B cannot send to A either — a block is not a mute.
  const meB = await (await b.page.request.get("/api/me")).json();
  const backwards = await b.page.request.post(`/api/me/messages/${aId}`, {
    data: { body: "still here" },
  });
  expect(backwards.status()).toBe(404);
  expect(meB.user.id).toBeTruthy();

  // Lifting it does not restore the friendship.
  await b.page.request.delete(`/api/me/blocks/${aId}`);
  expect((await roll(b.page.request)).friends).toHaveLength(0);
  expect((await roll(b.page.request)).blocked).toHaveLength(0);
  expect(aRoll.friendCode).toBeTruthy();

  await a.ctx.close();
  await b.ctx.close();
});

test("a party's room is for whoever rides with it", async ({ browser }) => {
  const dm = await person(browser, "prmdm");
  const inParty = await person(browser, "prmin");
  const outside = await person(browser, "prmout");

  const campaign = await createCampaign(dm.page.request, unique("The Split "));
  await joinCampaign(inParty.page.request, campaign.inviteCode);
  await joinCampaign(outside.page.request, campaign.inviteCode);

  const party = await (
    await dm.page.request.post(`/api/campaigns/${campaign.id}/parties`, {
      data: { name: "The Harbour Crew" },
    })
  ).json();

  // A hero of the in-party player's own, riding with it.
  const hero = (
    await (
      await inParty.page.request.post("/api/me/characters", {
        data: { name: unique("Nib "), class: "Rogue", level: 1, hpCurrent: 8, hpMax: 8 },
      })
    ).json()
  ).id as string;
  await inParty.page.request.put(`/api/characters/${hero}/seat`, {
    data: { campaignId: campaign.id },
  });
  await dm.page.request.put(`/api/characters/${hero}/party`, { data: { partyId: party.id } });

  const said = await dm.page.request.post(`/api/parties/${party.id}/messages`, {
    data: { body: "hold the pier" },
  });
  expect(said.status()).toBe(201);

  const heard = await (await inParty.page.request.get(`/api/parties/${party.id}/messages`)).json();
  expect(heard).toHaveLength(1);
  expect(heard[0].body).toBe("hold the pier");

  // A member of the table whose heroes ride elsewhere is answered as if the
  // room were not there — 404, not 403, like every other room in this app.
  const shut = await outside.page.request.get(`/api/parties/${party.id}/messages`);
  expect(shut.status()).toBe(404);
  const shout = await outside.page.request.post(`/api/parties/${party.id}/messages`, {
    data: { body: "let me in" },
  });
  expect(shout.status()).toBe(404);

  // And a hero quick-added by the DM does not make the DM's own room private:
  // the DM reads every party at their table.
  await quickAddHero(dm.page.request, campaign.id, unique("Ledger "));
  const dmSees = await (await dm.page.request.get(`/api/parties/${party.id}/messages`)).json();
  expect(dmSees).toHaveLength(1);

  await dm.ctx.close();
  await inParty.ctx.close();
  await outside.ctx.close();
});
