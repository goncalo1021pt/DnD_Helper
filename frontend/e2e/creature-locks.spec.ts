import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import {
  createCampaign,
  forgeHero,
  joinCampaign,
  newAccount,
  registerViaAPI,
  seatHero,
  settled,
  unique,
} from "./helpers";

/*
At a table, a creature's numbers are the table's (#378).

A companion was already picked from a list, but around the list everything was
open: a hand-written creature with any stats, a Mold that rewrote a Wild Shape
wolf, homebrew that changed after the DM admitted it, and — the other way —
homebrew monsters that could never be fielded at a table at all, because the
add asked a codex that refuses monsters. These pin each door.
*/

async function person(browser: Browser, prefix: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await registerViaAPI(page.request, newAccount(prefix));
  return page;
}

async function levelTo(request: APIRequestContext, id: string, level: number, at: Record<number, object> = {}) {
  for (let next = 2; next <= level; next++) {
    const res = await request.post(`/api/characters/${id}/levelup`, {
      data: { hpMode: "average", ...(at[next] ?? {}) },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
}

type Options = {
  companions: Array<{ contentId: string; name: string; role: string; grantedBy: string }>;
  forms: Array<{ feature: string; known: number; options: Array<{ contentId: string; name: string }> }>;
};

test("at a table a Druid takes forms as they stand, as many as Wild Shape knows", async ({ browser }) => {
  const dm = await person(browser, "lockdm");
  const campaign = await createCampaign(dm.request, unique("The Grove "));
  const player = await person(browser, "lockpl");
  await joinCampaign(player.request, campaign.inviteCode);
  const id = await forgeHero(player.request, {
    name: unique("Brambleback "),
    className: "Druid",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 10, dex: 14, con: 14, int: 10, wis: 17, cha: 8 },
    skills: ["Nature", "Perception"],
  });
  await levelTo(player.request, id, 2);
  await seatHero(player.request, id, campaign.id);

  const options = (await (await player.request.get(`/api/characters/${id}/creature-options`)).json()) as Options;
  const wild = options.forms[0];
  expect(wild.known).toBe(4);
  const take = (contentId: string) =>
    player.request.post(`/api/characters/${id}/creatures`, {
      data: { role: "form", contentId, grantedBy: wild.feature },
    });

  const ids: string[] = [];
  for (const o of wild.options.slice(0, 4)) {
    const res = await take(o.contentId);
    expect(res.ok(), await res.text()).toBeTruthy();
    ids.push((await res.json()).id);
  }
  // A shape is known once, and Wild Shape knows four at Druid 2.
  const twice = await take(wild.options[0].contentId);
  expect(twice.status()).toBe(400);
  expect((await twice.json()).error).toMatch(/already knows/);
  const fifth = await take(wild.options[4].contentId);
  expect(fifth.status()).toBe(400);
  expect((await fifth.json()).error).toMatch(/knows 4 forms/);

  // Writing one by hand is the DM's, and so is changing a creature's numbers.
  const byHand = await player.request.post(`/api/characters/${id}/creatures`, {
    data: { role: "companion", name: "Totally a Wolf", overrides: { ac: 25, hp: 300 } },
  });
  expect(byHand.status()).toBe(400);
  expect((await byHand.json()).error).toMatch(/DM's/);
  const mold = await player.request.patch(`/api/characters/${id}/creatures/${ids[0]}`, {
    data: { overrides: { ac: 25 } },
  });
  expect(mold.status()).toBe(400);
  // The name and the notes are still the player's.
  const renamed = await player.request.patch(`/api/characters/${id}/creatures/${ids[0]}`, {
    data: { name: "Old Grey", notes: "smells of rain" },
  });
  expect(renamed.ok(), await renamed.text()).toBeTruthy();
  // And the DM may mold what the player may not.
  const dmMold = await dm.request.patch(`/api/characters/${id}/creatures/${ids[0]}`, {
    data: { overrides: { ac: 15 } },
  });
  expect(dmMold.ok(), await dmMold.text()).toBeTruthy();

  // The sheet says so in the player's hands: Rename, not Mold, and no pen.
  await player.goto(`/questboard/heroes/${id}`);
  await settled(player);
  await expect(player.getByRole("button", { name: "Rename" }).first()).toBeVisible();
  await expect(player.getByRole("button", { name: "Mold" })).toHaveCount(0);
  await player.getByText("Forms & Companions").locator("xpath=..").getByRole("button").click();
  await expect(player.getByText(/is the DM's to add at the table/)).toBeVisible();
  // Four shapes known: the list marks them, and offers no fifth.
  await expect(player.getByText("Known", { exact: true })).toHaveCount(4);
  await expect(player.getByText(/all known — release one to learn another/)).toBeVisible();
  await expect(player.getByText("Or write one by hand")).toHaveCount(0);
});

test("a DM's homebrew companion reaches a seated player through the subclass that names it", async ({ browser }) => {
  const dm = await person(browser, "hounddm");
  const campaign = await createCampaign(dm.request, unique("The Workshop "));
  const hound = unique("Clockwork Hound ");
  const made = await dm.request.post("/api/rules/monster", {
    data: {
      name: hound,
      summary: "Medium Construct",
      data: { size: "Medium", type: "Construct", ac: 15, hp: 20, speed: "40 ft.", cr: "1", crValue: 1,
        abilities: { str: 14, dex: 12, con: 14, int: 4, wis: 10, cha: 5 } },
    },
  });
  expect(made.ok(), await made.text()).toBeTruthy();
  const sub = await dm.request.post("/api/rules/subclass", {
    data: {
      name: unique("Hound Keeper "),
      summary: "A Fighter with a clockwork friend.",
      data: { class: "Fighter", features: [], companions: [{ name: hound, role: "companion", level: 3 }] },
    },
  });
  expect(sub.ok(), await sub.text()).toBeTruthy();
  const subId = (await sub.json()).id as string;
  const enabled = await dm.request.put(`/api/campaigns/${campaign.id}/codex/${subId}`, { data: { status: "enabled" } });
  expect(enabled.ok(), await enabled.text()).toBeTruthy();

  const player = await person(browser, "houndpl");
  await joinCampaign(player.request, campaign.inviteCode);
  const id = await forgeHero(player.request, {
    name: unique("Tinker "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 16, dex: 10, con: 14, int: 12, wis: 10, cha: 8 },
    skills: ["Athletics", "Perception"],
  });
  // Risen before sitting down — a seated hero waits on the DM's milestone —
  // and the seat is where the codex rules on the homebrew subclass.
  await levelTo(player.request, id, 3, { 3: { subclassId: subId } });
  await seatHero(player.request, id, campaign.id);

  const options = (await (await player.request.get(`/api/characters/${id}/creature-options`)).json()) as Options;
  const offered = options.companions.find((c) => c.name === hound);
  expect(offered, "the subclass names the DM's monster, so it is offered").toBeTruthy();
  const taken = await player.request.post(`/api/characters/${id}/creatures`, {
    data: { role: "companion", contentId: offered!.contentId, grantedBy: offered!.grantedBy },
  });
  // It used to answer "not admitted by the campaign's codex" — which no
  // monster could ever be.
  expect(taken.ok(), await taken.text()).toBeTruthy();
});

test("homebrew edited after the DM admitted it goes back to the DM", async ({ browser }) => {
  const dm = await person(browser, "editdm");
  const campaign = await createCampaign(dm.request, unique("The Ledger "));
  const player = await person(browser, "editpl");
  await joinCampaign(player.request, campaign.inviteCode);

  const feat = { name: unique("Lucky Charm "), summary: "Once a day, reroll a 1.", data: { category: "general" } };
  const made = await player.request.post("/api/rules/feat", { data: feat });
  expect(made.ok(), await made.text()).toBeTruthy();
  const featId = (await made.json()).id as string;
  expect((await player.request.post(`/api/campaigns/${campaign.id}/codex`, { data: { contentIds: [featId] } })).ok()).toBeTruthy();
  expect((await dm.request.put(`/api/campaigns/${campaign.id}/codex/${featId}`, { data: { status: "enabled" } })).ok()).toBeTruthy();

  const statusOf = async (contentId: string) => {
    const codex = (await (await dm.request.get(`/api/campaigns/${campaign.id}/codex`)).json()) as Array<{
      content: { id: string };
      status: string;
    }>;
    return codex.find((e) => e.content.id === contentId)?.status;
  };
  expect(await statusOf(featId)).toBe("enabled");

  // Saving it unchanged rules on nothing.
  expect((await player.request.put(`/api/rules/content/${featId}`, { data: feat })).ok()).toBeTruthy();
  expect(await statusOf(featId)).toBe("enabled");

  // Changing it does: the DM admitted what they read, not this.
  const edited = await player.request.put(`/api/rules/content/${featId}`, {
    data: { ...feat, summary: "Reroll anything, always." },
  });
  expect(edited.ok(), await edited.text()).toBeTruthy();
  expect(await statusOf(featId)).toBe("proposed");

  // A DM editing their own admitted homebrew is not asking anyone.
  const own = { name: unique("House Rule "), summary: "As written.", data: { category: "general" } };
  const ownId = (await (await dm.request.post("/api/rules/feat", { data: own })).json()).id as string;
  expect((await dm.request.put(`/api/campaigns/${campaign.id}/codex/${ownId}`, { data: { status: "enabled" } })).ok()).toBeTruthy();
  expect((await dm.request.put(`/api/rules/content/${ownId}`, { data: { ...own, summary: "As amended." } })).ok()).toBeTruthy();
  expect(await statusOf(ownId)).toBe("enabled");
});
