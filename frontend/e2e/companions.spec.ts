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

The parts worth pinning are the refusals. Discovery is a tag and not a search
(#387), so a tag nobody holds and a tag held by somebody who blocked you must
answer alike, and guessing at tags runs into a ceiling. A conversation opens between friends OR table-mates, and a block closes
it in both directions. A party room's door is whoever rides with it.
*/

async function roll(request: APIRequestContext) {
  const res = await request.get("/api/me/friends");
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as {
    friendTag: string;
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

test("a friend tag is asked for, answered, and is the only way in", async ({ browser }) => {
  const a = await person(browser, "compa");
  const b = await person(browser, "compb");

  // A tag is the name people already know and four digits.
  const meB = (await (await b.page.request.get("/api/me")).json()).user;
  const bRoll = await roll(b.page.request);
  expect(bRoll.friendTag).toMatch(/^.+#\d{4}$/);
  expect(bRoll.friendTag.startsWith(`${meB.name}#`)).toBeTruthy();
  expect(meB.friendTag).toBe(bRoll.friendTag);

  // New digits under the same name.
  const redrawn = await b.page.request.post("/api/me/friends/tag");
  expect(redrawn.ok(), await redrawn.text()).toBeTruthy();
  const fresh = (await redrawn.json()).friendTag as string;
  expect(fresh.startsWith(`${meB.name}#`)).toBeTruthy();
  expect(fresh).not.toBe(bRoll.friendTag);

  // A tag nobody holds is refused, and says nothing about who does hold one.
  const nobody = await a.page.request.post("/api/me/friends", {
    data: { tag: `Nobody ${Date.now()}#1234` },
  });
  expect(nobody.status()).toBe(404);
  // Something that is not a tag at all — an old code — is a 400.
  const notATag = await a.page.request.post("/api/me/friends", { data: { tag: "3F9AWC2E" } });
  expect(notATag.status()).toBe(400);

  // Your own tag is not a way to befriend yourself.
  const aRoll = await roll(a.page.request);
  const self = await a.page.request.post("/api/me/friends", {
    data: { tag: aRoll.friendTag },
  });
  expect(self.status()).toBe(400);

  // A retired tag is a tag nobody holds.
  const retired = await a.page.request.post("/api/me/friends", {
    data: { tag: bRoll.friendTag },
  });
  expect(retired.status()).toBe(404);

  // Case and stray spaces do not matter; the digits do.
  const asked = await a.page.request.post("/api/me/friends", {
    data: { tag: `  ${fresh.toUpperCase()} ` },
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

  await a.page.request.post("/api/me/friends", { data: { tag: bRoll.friendTag } });
  // B does not answer A's request — B asks A, which is the same thing said the
  // other way round, and should not become a second row nobody can answer.
  const back = await b.page.request.post("/api/me/friends", {
    data: { tag: aRoll.friendTag },
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

  await a.page.request.post("/api/me/friends", { data: { tag: bRoll.friendTag } });
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

  // A cannot send, cannot re-ask, and cannot tell a block from a bad tag.
  const bId = (await roll(a.page.request)).friends.length; // A's roll is empty too
  expect(bId).toBe(0);
  const reask = await a.page.request.post("/api/me/friends", {
    data: { tag: bRoll.friendTag },
  });
  expect(reask.status()).toBe(404);
  const nobody = await a.page.request.post("/api/me/friends", {
    data: { tag: `Nobody ${Date.now()}#1234` },
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
  expect(aRoll.friendTag).toBeTruthy();

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

test("a rename keeps its digits, and the profile shows the tag", async ({ browser }) => {
  const a = await person(browser, "tagname");
  const before = (await roll(a.page.request)).friendTag;
  const digits = before.slice(before.lastIndexOf("#"));

  const name = `Renamed ${Date.now()}`;
  const renamed = await a.page.request.patch("/api/me", { data: { name } });
  expect(renamed.ok(), await renamed.text()).toBeTruthy();
  // A brand-new name cannot already wear these digits, so they stay.
  expect((await renamed.json()).friendTag).toBe(`${name}${digits}`);
  expect((await roll(a.page.request)).friendTag).toBe(`${name}${digits}`);

  await a.page.goto("/questboard/profile");
  await expect(a.page.getByTestId("profile-tag")).toHaveText(`${name}${digits}`);

  await a.ctx.close();
});

test("guessing at tags runs into a ceiling, which a right guess cannot get past", async ({ browser }) => {
  const a = await person(browser, "guessa");
  const b = await person(browser, "guessb");
  const bTag = (await roll(b.page.request)).friendTag;
  const name = bTag.slice(0, bTag.lastIndexOf("#"));
  const real = Number(bTag.slice(bTag.lastIndexOf("#") + 1));

  // Ten misses — every one a digit that is not B's — are allowed.
  let guess = 1;
  for (let i = 0; i < 10; i++) {
    if (guess === real) guess++;
    const miss = await a.page.request.post("/api/me/friends", {
      data: { tag: `${name}#${String(guess++).padStart(4, "0")}` },
    });
    expect(miss.status()).toBe(404);
  }
  // The eleventh is refused before it is looked up, so even the right tag
  // answers 429 — the ceiling cannot be used to tell a hit from a miss.
  const right = await a.page.request.post("/api/me/friends", { data: { tag: bTag } });
  expect(right.status()).toBe(429);
  expect((await right.json()).error).toMatch(/try again in \d+ minutes/);

  await a.ctx.close();
  await b.ctx.close();
});

test("a friend is added by typing their tag into the page", async ({ browser }) => {
  const a = await person(browser, "uitaga");
  const b = await person(browser, "uitagb");
  const bTag = (await roll(b.page.request)).friendTag;
  const bName = bTag.slice(0, bTag.lastIndexOf("#"));

  await a.page.goto("/questboard/companions");
  const mine = (await roll(a.page.request)).friendTag;
  await expect(a.page.getByTestId("friend-tag")).toHaveText(mine);

  const box = a.page.getByLabel("Their tag");
  await box.fill(`${bName}#0000`);
  await a.page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(a.page.getByText("a tag is a name, #, and four digits")).toBeVisible();

  await box.fill(bTag);
  await a.page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(box).toHaveValue("");
  await expect(a.page.getByText("Asked, not yet answered")).toBeVisible();
  await expect(a.page.getByRole("listitem").filter({ hasText: bName })).toBeVisible();

  await a.ctx.close();
  await b.ctx.close();
});
