import { expect, test, type Page } from "@playwright/test";
import { createCampaign, joinCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
A codex ban must bite wherever a spell is picked, not only at the seat door (#239).

Strict seating refuses banned content at the forge sieve and the seating door, and
#252 closed the long-rest swap. The gap this guards is the *level-up* swap: a
Sorcerer/Bard/Warlock trades one spell as it gains a level, and that door never
consulted the codex — so a seated hero could trade straight into a banned spell.
The fix moved the codex check into validateSpellSwaps / validateSpellPicks, the
one place every pick and swap flows through, so all three doors answer alike.
*/

/** Forge a caster with chosen spells (helpers.forgeHero takes none). */
async function forgeCaster(
  page: Page,
  hero: {
    name: string;
    className: string;
    speciesName: string;
    backgroundName: string;
    abilities: Record<string, number>;
    skills: string[];
    spells: string[];
  },
): Promise<string> {
  const byName = async (kind: string, want: string) => {
    const list = (await (await page.request.get(`/api/rules/${kind}`)).json()) as Array<{
      id: string;
      name: string;
    }>;
    const hit = list.find((e) => e.name === want);
    expect(hit, `${want} should be in the ${kind} library`).toBeTruthy();
    return hit!.id;
  };
  const res = await page.request.post("/api/me/characters/forge", {
    data: {
      name: hero.name,
      classId: await byName("class", hero.className),
      speciesId: await byName("species", hero.speciesName),
      backgroundId: await byName("background", hero.backgroundName),
      abilities: hero.abilities,
      skills: hero.skills,
      spells: hero.spells,
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id as string;
}

/** The SRD spell ids a test names, read once. */
async function spellIds(page: Page, names: string[]): Promise<Record<string, string>> {
  const all = (await (await page.request.get("/api/rules/spell")).json()) as Array<{
    id: string;
    name: string;
    source: string;
  }>;
  const out: Record<string, string> = {};
  for (const n of names) {
    const hit = all.find((s) => s.name === n && s.source === "srd");
    expect(hit, `${n} should be SRD`).toBeTruthy();
    out[n] = hit!.id;
  }
  return out;
}

async function heroSpellNames(page: Page, heroId: string): Promise<string[]> {
  const detail = (await (await page.request.get(`/api/characters/${heroId}`)).json()) as {
    spells?: Array<{ name: string }>;
  };
  return (detail.spells ?? []).map((s) => s.name);
}

test("a codex ban bites at the level-up spell swap (#239)", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const plCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  const player = await plCtx.newPage();

  // The DM bans an SRD spell that is on the Sorcerer list.
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("swap-dm"));
  const campaign = await createCampaign(dm.request, unique("Ban at Level-up "));
  const ids = await spellIds(dm, ["Burning Hands", "Chromatic Orb", "Charm Person"]);
  const banned = await dm.request.put(`/api/campaigns/${campaign.id}/codex/${ids["Burning Hands"]}`, {
    data: { status: "banned" },
  });
  expect(banned.ok(), await banned.text()).toBeTruthy();

  // A player forges a Sorcerer knowing Chromatic Orb, and seats it (door open).
  await player.goto("/");
  await registerViaAPI(player.request, newAccount("swap-pl"));
  await joinCampaign(player.request, campaign.inviteCode);
  const heroId = await forgeCaster(player, {
    name: unique("Vesna "),
    className: "Sorcerer",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
    skills: ["Arcana", "Deception"],
    spells: [ids["Chromatic Orb"]],
  });
  const seat = await player.request.put(`/api/characters/${heroId}/seat`, {
    data: { campaignId: campaign.id },
  });
  expect(seat.ok(), await seat.text()).toBeTruthy();

  // The DM declares a milestone so a level-up is allowed at all — that way the
  // only thing that can refuse the banned swap is the codex, not the gate.
  const milestone = await dm.request.post(`/api/campaigns/${campaign.id}/milestone`, { data: {} });
  expect(milestone.ok(), await milestone.text()).toBeTruthy();

  // Level up, trading the known spell straight INTO the banned one.
  const badSwap = await player.request.post(`/api/characters/${heroId}/levelup`, {
    data: {
      hpMode: "average",
      spellSwaps: [{ replace: ids["Chromatic Orb"], with: ids["Burning Hands"] }],
    },
  });
  expect(badSwap.status(), await badSwap.text()).toBe(400);
  expect((await badSwap.json()).error).toContain("codex");
  // The ban held: the hero never rose and the spell never landed.
  const after = await heroSpellNames(player, heroId);
  expect(after).not.toContain("Burning Hands");
  expect(after).toContain("Chromatic Orb");
  const stillLevel1 = (await (await player.request.get(`/api/characters/${heroId}`)).json()) as {
    character: { level: number };
  };
  expect(stillLevel1.character.level).toBe(1);

  // A LEGAL swap on the same level-up still works — the door refuses the ban,
  // not every trade.
  const goodSwap = await player.request.post(`/api/characters/${heroId}/levelup`, {
    data: {
      hpMode: "average",
      spellSwaps: [{ replace: ids["Chromatic Orb"], with: ids["Charm Person"] }],
    },
  });
  expect(goodSwap.ok(), await goodSwap.text()).toBeTruthy();
  const finalSpells = await heroSpellNames(player, heroId);
  expect(finalSpells).toContain("Charm Person");
  expect(finalSpells).not.toContain("Chromatic Orb");

  await dmCtx.close();
  await plCtx.close();
});

test("a codex ban still bites at the long-rest swap (#239/#252)", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const plCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  const player = await plCtx.newPage();

  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("lr-dm"));
  const campaign = await createCampaign(dm.request, unique("Ban at Rest "));
  const ids = await spellIds(dm, ["Burning Hands", "Magic Missile"]);
  const banned = await dm.request.put(`/api/campaigns/${campaign.id}/codex/${ids["Burning Hands"]}`, {
    data: { status: "banned" },
  });
  expect(banned.ok(), await banned.text()).toBeTruthy();

  // A Wizard re-prepares on a Long Rest — the door #252 closed, guarded here so
  // moving the check into the validator did not reopen it.
  await player.goto("/");
  await registerViaAPI(player.request, newAccount("lr-pl"));
  await joinCampaign(player.request, campaign.inviteCode);
  const heroId = await forgeCaster(player, {
    name: unique("Provand "),
    className: "Wizard",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    skills: ["Arcana", "History"],
    spells: [ids["Magic Missile"]],
  });
  const seat = await player.request.put(`/api/characters/${heroId}/seat`, {
    data: { campaignId: campaign.id },
  });
  expect(seat.ok(), await seat.text()).toBeTruthy();

  const swap = await player.request.post(`/api/characters/${heroId}/spells/swap`, {
    data: { swaps: [{ replace: ids["Magic Missile"], with: ids["Burning Hands"] }] },
  });
  expect(swap.status(), await swap.text()).toBe(400);
  expect((await swap.json()).error).toContain("codex");
  expect(await heroSpellNames(player, heroId)).not.toContain("Burning Hands");

  await dmCtx.close();
  await plCtx.close();
});
