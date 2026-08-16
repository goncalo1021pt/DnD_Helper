import { expect, test, type Page } from "@playwright/test";
import {
  createCampaign,
  forgeHero,
  joinCampaign,
  newAccount,
  quickAddHero,
  registerViaAPI,
  seatHero,
  settled,
  unique,
} from "./helpers";

/*
Exploratory QA: skill trees — the Loom (DM editor), the pact, and the web the
player walks. No prior e2e coverage; this spec is both a journey and a probe.
*/

function watchConsole(page: Page, tag: string, sink: string[]) {
  page.on("pageerror", (e) => sink.push(`[${tag}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") sink.push(`[${tag}] console.error: ${m.text()}`);
  });
}

/** The <g> for a named node in the web SVG. */
function webNode(page: Page, name: string) {
  return page
    .locator("svg.tree-web-svg g")
    .filter({ has: page.locator("title") })
    .filter({ hasText: name });
}

/** The picks chip on the web page (another .chip-hall lives in the app shell). */
function picksChip(page: Page) {
  return page.locator(".chip-hall", { hasText: "unspent" });
}

test("the loom weaves, the pact binds, and the web enforces reach and budget", async ({
  browser,
}) => {
  const errors: string[] = [];
  const dmCtx = await browser.newContext();
  const playerCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  const player = await playerCtx.newPage();
  watchConsole(dm, "dm", errors);
  watchConsole(player, "player", errors);

  // -- setup through the API: accounts, campaign, a seated player hero --------
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("loom-dm"));
  const campaign = await createCampaign(dm.request, unique("Wyrmroot "));

  await player.goto("/");
  await registerViaAPI(player.request, newAccount("loom-pl"));
  await joinCampaign(player.request, campaign.inviteCode);
  const heroId = await forgeHero(player.request, {
    name: unique("Sable "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 10 },
    skills: ["Athletics", "Perception"],
  });
  await seatHero(player.request, heroId, campaign.id);

  // -- the Loom: weave a tree through the UI ---------------------------------
  let t0 = Date.now();
  await dm.goto(`/questboard/campaigns/${campaign.id}/trees`);
  await expect(dm.getByText("No trees woven yet")).toBeVisible();
  console.log(`TIMING trees-page-load ${Date.now() - t0}ms`);
  await dm.screenshot({ path: "exp-shots/trees/01-trees-empty.png", fullPage: true });

  const treeName = unique("Mark of the Wyrm ");
  await dm.getByRole("button", { name: "Weave a Tree" }).click();
  await dm.getByPlaceholder("e.g. The Mark of Vecna").fill(treeName);
  await dm
    .getByPlaceholder("What power is this, and what does it want…")
    .fill("A dragon's debt, paid in scales.");
  await dm.getByLabel("Keystone cost (picks)").selectOption("2");
  t0 = Date.now();
  await dm.getByRole("button", { name: "Weave it" }).click();
  await expect(dm.getByRole("link", { name: new RegExp(treeName.slice(0, 16)) })).toBeVisible();
  console.log(`TIMING weave-tree ${Date.now() - t0}ms`);
  await dm.screenshot({ path: "exp-shots/trees/02-tree-woven.png", fullPage: true });

  // -- into the editor: bind three powers into a chain -----------------------
  t0 = Date.now();
  await dm.getByRole("link", { name: new RegExp(treeName.slice(0, 16)) }).click();
  await expect(dm.getByText("The web is unwoven — no powers yet.")).toBeVisible();
  console.log(`TIMING editor-load ${Date.now() - t0}ms`);
  const treeId = dm.url().split("/trees/")[1];

  const bindPower = async (v: {
    name: string;
    entry?: boolean;
    keystone?: boolean;
    connect?: string[];
  }) => {
    await dm.getByRole("button", { name: "Bind a Power" }).click();
    const dialog = dm.getByRole("dialog");
    await dialog.getByPlaceholder("e.g. Withering Touch").fill(v.name);
    await dialog.getByPlaceholder("e.g. ENTROPY").fill("SCALES");
    if (v.keystone) {
      await dialog.getByLabel("Rarity").selectOption("keystone");
      await dialog
        .getByPlaceholder(/Healing on you is halved/)
        .fill("Your shadow belongs to the wyrm.");
    }
    if (v.entry) await dialog.getByLabel("Entry node (no prereqs)").check();
    for (const c of v.connect ?? []) await dialog.getByLabel(c).check();
    const t = Date.now();
    await dialog.getByRole("button", { name: "Bind the power" }).click();
    await expect(dialog).toHaveCount(0);
    console.log(`TIMING bind-power ${Date.now() - t}ms`);
  };

  await bindPower({ name: "First Gift", entry: true });
  await expect(dm.locator("svg.tree-web-svg text", { hasText: "First Gift" })).toBeVisible();
  await bindPower({ name: "Deep Vein", connect: ["First Gift"] });
  await bindPower({ name: "Heartwood", keystone: true, connect: ["Deep Vein"] });
  await settled(dm);

  const detail = (await (await dm.request.get(`/api/trees/${treeId}`)).json()) as {
    nodes: Array<{ id: string; name: string }>;
    edges: Array<{ a: string; b: string }>;
  };
  expect(detail.nodes).toHaveLength(3);
  expect(detail.edges).toHaveLength(2);
  const idOf = (n: string) => detail.nodes.find((x) => x.name === n)!.id;
  await dm.screenshot({ path: "exp-shots/trees/03-editor-web.png", fullPage: true });

  // -- the pact: bound from the party ledger ---------------------------------
  await dm.goto(`/questboard/campaigns/${campaign.id}/party`);
  const bindSelect = dm.locator('select:has(option:text-is("Bind to a tree…"))');
  await expect(bindSelect).toBeVisible();
  await bindSelect.selectOption({ label: treeName });
  t0 = Date.now();
  await dm.getByRole("button", { name: "Bind", exact: true }).click();
  await expect(dm.getByText(`◆ ${treeName}`)).toBeVisible();
  console.log(`TIMING bind-pact ${Date.now() - t0}ms`);
  await dm.screenshot({ path: "exp-shots/trees/04-party-pact.png", fullPage: true });

  // -- grants: two picks, one story beat at a time ---------------------------
  await dm.goto(`/questboard/campaigns/${campaign.id}/characters/${heroId}/web`);
  const dmChip = picksChip(dm);
  await expect(dmChip).toContainText("of 0 unspent");
  await dm.getByRole("button", { name: "Grant a Pick" }).click();
  await expect(dmChip).toContainText("of 1 unspent");
  await dm.getByRole("button", { name: "Grant a Pick" }).click();
  await expect(dmChip).toContainText("of 2 unspent");

  // -- the player's walk ------------------------------------------------------
  await player.goto(`/questboard/campaigns/${campaign.id}/party`);
  await expect(player.getByText("2 waiting ·")).toBeVisible();
  t0 = Date.now();
  await player.getByRole("link", { name: /Open the web/ }).click();
  const chip = picksChip(player);
  await expect(chip).toContainText("of 2 unspent");
  console.log(`TIMING web-page-load ${Date.now() - t0}ms`);
  await player.screenshot({ path: "exp-shots/trees/05-player-web-granted.png", fullPage: true });

  // Reach is enforced server-side: the keystone hangs behind an unclaimed node
  // and 2 picks cover its price, so the refusal must be about reach.
  const outOfReach = await player.request.post(`/api/characters/${heroId}/tree/picks`, {
    data: { nodeId: idOf("Heartwood") },
  });
  expect(outOfReach.status()).toBe(400);
  expect(await outOfReach.text()).toContain("out of reach");

  // Claim the entry node through the UI.
  t0 = Date.now();
  await webNode(player, "First Gift").click();
  await player.getByRole("button", { name: "Claim this power" }).click();
  await expect(player.getByRole("dialog")).toHaveCount(0);
  await expect(chip.locator("span").nth(1)).toHaveText("1");
  console.log(`TIMING spend-pick ${Date.now() - t0}ms`);

  // The keystone is still locked (cost 2 > remaining 1, and not adjacent to a
  // claimed node): its modal must offer no claim.
  await webNode(player, "Heartwood").click();
  const lockedDialog = player.getByRole("dialog");
  await expect(lockedDialog.getByText("Keystone · costs 2 picks")).toBeVisible();
  await expect(lockedDialog.getByRole("button", { name: "Claim this power" })).toHaveCount(0);
  await player.screenshot({ path: "exp-shots/trees/06-locked-keystone-modal.png", fullPage: true });
  await lockedDialog.locator("button.btn-ghost-ink", { hasText: "Close" }).click();

  // Claim the middle node; the purse is now empty.
  await webNode(player, "Deep Vein").click();
  await player.getByRole("button", { name: "Claim this power" }).click();
  await expect(chip.locator("span").nth(1)).toHaveText("0");

  const broke = await player.request.post(`/api/characters/${heroId}/tree/picks`, {
    data: { nodeId: idOf("Heartwood") },
  });
  expect(broke.status()).toBe(400);
  expect(await broke.text()).toContain("not enough unspent picks");

  // The party card mirrors the spend: nothing waiting now.
  await player.goto(`/questboard/campaigns/${campaign.id}/party`);
  await expect(player.getByRole("link", { name: /Open the web/ })).toBeVisible();
  await expect(player.getByText("waiting ·")).toHaveCount(0);

  // Two more picks fund the keystone; the full chain lights up.
  const moreGrants = await dm.request.post(`/api/characters/${heroId}/tree/grants`, {
    data: { picks: 2 },
  });
  expect(moreGrants.ok()).toBeTruthy();
  await player.goto(`/questboard/campaigns/${campaign.id}/characters/${heroId}/web`);
  await expect(chip).toContainText("of 4 unspent");
  await webNode(player, "Heartwood").click();
  await expect(player.getByText("The price: Your shadow belongs to the wyrm.")).toBeVisible();
  await player.getByRole("button", { name: "Claim this power" }).click();
  await expect(chip.locator("span").nth(1)).toHaveText("0");
  await player.screenshot({ path: "exp-shots/trees/07-web-complete.png", fullPage: true });

  const state = (await (
    await player.request.get(`/api/characters/${heroId}/tree`)
  ).json()) as { picksGranted: number; picksSpent: number; picksRemaining: number; takenNodeIds: string[] };
  expect(state.picksGranted).toBe(4);
  expect(state.picksSpent).toBe(4);
  expect(state.picksRemaining).toBe(0);
  expect(state.takenNodeIds).toHaveLength(3);

  console.log(`CONSOLE-ERRORS ${JSON.stringify(errors)}`);
  await dmCtx.close();
  await playerCtx.close();
});

test("editor edge cases: rename keeps the wiring, severing cascades, orphans and clipping", async ({
  browser,
}) => {
  const errors: string[] = [];
  const ctx = await browser.newContext();
  const dm = await ctx.newPage();
  watchConsole(dm, "dm", errors);

  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("loom-ed"));
  const campaign = await createCampaign(dm.request, unique("Thornhall "));

  // A chain A - B - C, built through the API (the editor is what is under test,
  // not the modal keystrokes a second time).
  const mkTree = async (name: string) => {
    const res = await dm.request.post(`/api/campaigns/${campaign.id}/trees`, {
      data: { name, keystonePickCost: 1 },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    return (await res.json()).id as string;
  };
  const mkNode = async (treeId: string, name: string, isEntry: boolean, limb = "TRUNK") => {
    const res = await dm.request.post(`/api/trees/${treeId}/nodes`, {
      data: { name, rarity: "minor", limb, isEntry, description: `${name} does a thing.` },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    return (await res.json()).id as string;
  };

  const treeId = await mkTree(unique("Bramble Web "));
  const a = await mkNode(treeId, "Root Gift", true);
  const b = await mkNode(treeId, "Bramble", false);
  const c = await mkNode(treeId, "Crown", false);
  const wired = await dm.request.put(`/api/trees/${treeId}/edges`, {
    data: { edges: [{ a, b }, { a: b, b: c }] },
  });
  expect(wired.ok(), await wired.text()).toBeTruthy();

  const t0 = Date.now();
  await dm.goto(`/questboard/campaigns/${campaign.id}/trees/${treeId}`);
  await expect(dm.getByText("The Powers")).toBeVisible();
  console.log(`TIMING editor-load-wired ${Date.now() - t0}ms`);
  await dm.screenshot({ path: "exp-shots/trees/08-editor-before-edits.png", fullPage: true });

  // Rename mid-edit: the edit modal must arrive with both connections checked,
  // and submitting must keep them.
  await dm
    .locator(".parchment")
    .filter({ hasText: "Bramble" })
    .locator('button[title="Edit"]')
    .click();
  const editDialog = dm.getByRole("dialog");
  await expect(editDialog.getByLabel("Root Gift")).toBeChecked();
  await expect(editDialog.getByLabel("Crown")).toBeChecked();
  await editDialog.getByPlaceholder("e.g. Withering Touch").fill("Bramble Reborn");
  await editDialog.getByRole("button", { name: "Bind the power" }).click();
  await expect(editDialog).toHaveCount(0);
  await expect(dm.locator("svg.tree-web-svg text", { hasText: "Bramble Reborn" })).toBeVisible();
  await settled(dm);
  let detail = (await (await dm.request.get(`/api/trees/${treeId}`)).json()) as {
    nodes: unknown[];
    edges: unknown[];
  };
  expect(detail.nodes).toHaveLength(3);
  expect(detail.edges, "rename must not rewire the web").toHaveLength(2);

  // Sever a node that carries edges: both its edges must go with it, and the
  // page must not crash. Crown becomes an orphan island (no warning exists).
  dm.once("dialog", (d) => d.accept());
  await dm
    .locator(".parchment")
    .filter({ hasText: "Bramble Reborn" })
    .locator('button[title="Remove"]')
    .click();
  await expect(dm.locator(".parchment").filter({ hasText: "Bramble Reborn" })).toHaveCount(0);
  await settled(dm);
  detail = (await (await dm.request.get(`/api/trees/${treeId}`)).json()) as {
    nodes: unknown[];
    edges: unknown[];
  };
  expect(detail.nodes).toHaveLength(2);
  expect(detail.edges, "edges must cascade with the severed node").toHaveLength(0);
  await dm.screenshot({ path: "exp-shots/trees/09-web-orphan.png", fullPage: true });

  // A one-limb web with five entry nodes: does the SVG viewBox hold them?
  const wideId = await mkTree(unique("Crowded Limb "));
  for (const n of ["Alpha Gift", "Beta Gift", "Gamma Gift", "Delta Gift", "Epsilon Gift"]) {
    await mkNode(wideId, n, true, "ONE LIMB");
  }
  await dm.goto(`/questboard/campaigns/${campaign.id}/trees/${wideId}`);
  const svg = dm.locator("svg.tree-web-svg");
  await expect(svg).toBeVisible();
  const svgBox = (await svg.boundingBox())!;
  const clipped: string[] = [];
  for (const n of ["Alpha Gift", "Beta Gift", "Gamma Gift", "Delta Gift", "Epsilon Gift"]) {
    const box = await webNode(dm, n).boundingBox();
    if (!box) continue;
    if (box.x < svgBox.x - 1 || box.x + box.width > svgBox.x + svgBox.width + 1) {
      clipped.push(`${n} at x=${Math.round(box.x)} w=${Math.round(box.width)}`);
    }
  }
  console.log(
    `CLIPPING svg[x=${Math.round(svgBox.x)} w=${Math.round(svgBox.width)}] out-of-frame: ${JSON.stringify(clipped)}`,
  );
  await dm.screenshot({ path: "exp-shots/trees/10-web-clipped.png", fullPage: true });

  console.log(`CONSOLE-ERRORS ${JSON.stringify(errors)}`);
  await ctx.close();
});

test("the pact's doors and arithmetic: permissions, retro repricing, entry-less webs", async ({
  browser,
}) => {
  const errors: string[] = [];
  const dmCtx = await browser.newContext();
  const playerCtx = await browser.newContext();
  const outsiderCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  const player = await playerCtx.newPage();
  const outsider = await outsiderCtx.newPage();
  watchConsole(player, "player", errors);

  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("pact-dm"));
  const campaign = await createCampaign(dm.request, unique("Debt Hall "));

  const t1 = (await (
    await dm.request.post(`/api/campaigns/${campaign.id}/trees`, {
      data: { name: unique("Old Debt "), keystonePickCost: 1 },
    })
  ).json()) as { id: string };
  const kNode = (await (
    await dm.request.post(`/api/trees/${t1.id}/nodes`, {
      data: { name: "Old Pact", rarity: "keystone", isEntry: true, tradeoff: "It remembers." },
    })
  ).json()) as { id: string };
  await dm.request.post(`/api/trees/${t1.id}/nodes`, {
    data: { name: "Adrift", rarity: "minor", isEntry: false },
  });

  await player.goto("/");
  await registerViaAPI(player.request, newAccount("pact-pl"));
  await joinCampaign(player.request, campaign.inviteCode);
  const heroId = await forgeHero(player.request, {
    name: unique("Vex "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 10 },
    skills: ["Athletics", "Perception"],
  });
  await seatHero(player.request, heroId, campaign.id);

  await outsider.goto("/");
  await registerViaAPI(outsider.request, newAccount("pact-out"));

  // -- the doors --------------------------------------------------------------
  expect((await outsider.request.get(`/api/trees/${t1.id}`)).status(), "outsider reads a tree").toBe(403);
  expect(
    (await outsider.request.get(`/api/campaigns/${campaign.id}/trees`)).status(),
    "outsider lists trees",
  ).toBe(403);
  expect(
    (
      await player.request.post(`/api/campaigns/${campaign.id}/trees`, {
        data: { name: "Player Loom" },
      })
    ).status(),
    "player weaves a tree",
  ).toBe(403);
  expect(
    (
      await player.request.post(`/api/trees/${t1.id}/nodes`, {
        data: { name: "Player Node", rarity: "minor" },
      })
    ).status(),
    "player binds a power",
  ).toBe(403);
  expect(
    (await player.request.put(`/api/trees/${t1.id}/edges`, { data: { edges: [] } })).status(),
    "player rewires",
  ).toBe(403);
  expect(
    (
      await player.request.patch(`/api/trees/${t1.id}`, {
        data: { name: "Stolen", keystonePickCost: 1 },
      })
    ).status(),
    "player renames the tree",
  ).toBe(403);
  expect((await player.request.delete(`/api/trees/${t1.id}`)).status(), "player unweaves").toBe(403);
  expect(
    (
      await player.request.put(`/api/characters/${heroId}/tree`, { data: { treeId: t1.id } })
    ).status(),
    "player binds their own pact",
  ).toBe(403);
  expect(
    (
      await player.request.post(`/api/characters/${heroId}/tree/grants`, { data: { picks: 1 } })
    ).status(),
    "player grants themselves picks",
  ).toBe(403);

  // -- validation edges -------------------------------------------------------
  expect(
    (
      await dm.request.post(`/api/campaigns/${campaign.id}/trees`, {
        data: { name: "Too Dear", keystonePickCost: 9 },
      })
    ).status(),
    "keystone cost above 5",
  ).toBe(400);
  expect(
    (
      await dm.request.post(`/api/characters/${heroId}/tree/grants`, { data: { picks: 0 } })
    ).status(),
    "grant of zero",
  ).toBe(400);
  expect(
    (
      await dm.request.post(`/api/characters/${heroId}/tree/grants`, { data: { picks: 11 } })
    ).status(),
    "grant of eleven",
  ).toBe(400);

  // -- retro repricing: spend a keystone at cost 1, then raise the price ------
  expect(
    (
      await dm.request.put(`/api/characters/${heroId}/tree`, { data: { treeId: t1.id } })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await dm.request.post(`/api/characters/${heroId}/tree/grants`, { data: { picks: 1 } })
    ).ok(),
  ).toBeTruthy();
  const spent = await player.request.post(`/api/characters/${heroId}/tree/picks`, {
    data: { nodeId: kNode.id },
  });
  expect(spent.ok(), await spent.text()).toBeTruthy();

  const repriced = await dm.request.patch(`/api/trees/${t1.id}`, {
    data: { name: "Old Debt, Compounded", keystonePickCost: 2 },
  });
  expect(repriced.ok(), await repriced.text()).toBeTruthy();
  const after = (await (
    await player.request.get(`/api/characters/${heroId}/tree`)
  ).json()) as { picksGranted: number; picksSpent: number; picksRemaining: number };
  console.log(`REPRICED state: ${JSON.stringify(after)}`);

  await player.goto(`/questboard/campaigns/${campaign.id}/characters/${heroId}/web`);
  const chip = picksChip(player);
  await expect(chip).toBeVisible();
  const chipText = (await chip.textContent()) ?? "";
  console.log(`REPRICED chip reads: ${JSON.stringify(chipText)}`);
  await player.screenshot({ path: "exp-shots/trees/11-repriced-picks.png", fullPage: true });

  // -- an entry-less web: picks in hand, nothing can ever be claimed ----------
  const t2 = (await (
    await dm.request.post(`/api/campaigns/${campaign.id}/trees`, {
      data: { name: unique("No Door "), keystonePickCost: 1 },
    })
  ).json()) as { id: string };
  const lost = (await (
    await dm.request.post(`/api/trees/${t2.id}/nodes`, {
      data: { name: "Lost Door", rarity: "minor", isEntry: false, description: "A door with no key." },
    })
  ).json()) as { id: string };
  expect(
    (
      await dm.request.put(`/api/characters/${heroId}/tree`, { data: { treeId: t2.id } })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await dm.request.post(`/api/characters/${heroId}/tree/grants`, { data: { picks: 1 } })
    ).ok(),
  ).toBeTruthy();

  await player.goto(`/questboard/campaigns/${campaign.id}/characters/${heroId}/web`);
  await expect(player.getByText("The mark stirs")).toBeVisible();
  await webNode(player, "Lost Door").click();
  const deadDialog = player.getByRole("dialog");
  await expect(deadDialog).toBeVisible();
  await expect(deadDialog.getByRole("button", { name: "Claim this power" })).toHaveCount(0);
  await player.screenshot({ path: "exp-shots/trees/12-entryless-web.png", fullPage: true });
  await deadDialog.locator("button.btn-ghost-ink", { hasText: "Close" }).click();
  const deadSpend = await player.request.post(`/api/characters/${heroId}/tree/picks`, {
    data: { nodeId: lost.id },
  });
  expect(deadSpend.status(), "entry-less node refused server-side too").toBe(400);

  // -- spending on a hero you do not own is refused ---------------------------
  const tableBorn = await quickAddHero(dm.request, campaign.id, unique("Hireling "));
  expect(
    (
      await dm.request.put(`/api/characters/${tableBorn}/tree`, { data: { treeId: t2.id } })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await dm.request.post(`/api/characters/${tableBorn}/tree/grants`, { data: { picks: 1 } })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await player.request.post(`/api/characters/${tableBorn}/tree/picks`, {
        data: { nodeId: lost.id },
      })
    ).status(),
    "player spends another's picks",
  ).toBe(403);

  // -- deleting a claimed node: what happens to the spent pick and the chain? -
  const t3 = (await (
    await dm.request.post(`/api/campaigns/${campaign.id}/trees`, {
      data: { name: unique("Severed Debt "), keystonePickCost: 1 },
    })
  ).json()) as { id: string };
  const e1 = (await (
    await dm.request.post(`/api/trees/${t3.id}/nodes`, {
      data: { name: "Gate", rarity: "minor", isEntry: true },
    })
  ).json()) as { id: string };
  const e2 = (await (
    await dm.request.post(`/api/trees/${t3.id}/nodes`, {
      data: { name: "Beyond", rarity: "minor", isEntry: false },
    })
  ).json()) as { id: string };
  const wired3 = await dm.request.put(`/api/trees/${t3.id}/edges`, { data: { edges: [{ a: e1.id, b: e2.id }] } });
  expect(wired3.ok(), await wired3.text()).toBeTruthy();
  const bound3 = await dm.request.put(`/api/characters/${heroId}/tree`, { data: { treeId: t3.id } });
  expect(bound3.ok(), await bound3.text()).toBeTruthy();
  const granted3 = await dm.request.post(`/api/characters/${heroId}/tree/grants`, { data: { picks: 2 } });
  expect(granted3.ok(), await granted3.text()).toBeTruthy();
  const spend1 = await player.request.post(`/api/characters/${heroId}/tree/picks`, { data: { nodeId: e1.id } });
  expect(spend1.ok(), await spend1.text()).toBeTruthy();
  const spend2 = await player.request.post(`/api/characters/${heroId}/tree/picks`, { data: { nodeId: e2.id } });
  expect(spend2.ok(), await spend2.text()).toBeTruthy();
  // The DM severs the claimed entry node.
  expect((await dm.request.delete(`/api/nodes/${e1.id}`)).status()).toBe(204);
  const afterSever = (await (
    await player.request.get(`/api/characters/${heroId}/tree`)
  ).json()) as { picksGranted: number; picksSpent: number; picksRemaining: number; takenNodeIds: string[] };
  console.log(`SEVERED-CLAIMED state: ${JSON.stringify(afterSever)}`);

  console.log(`CONSOLE-ERRORS ${JSON.stringify(errors)}`);
  await dmCtx.close();
  await playerCtx.close();
  await outsiderCtx.close();
});
