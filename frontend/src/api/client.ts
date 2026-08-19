import createClient from "openapi-fetch";
import type { paths } from "./schema";
import { apiFetch } from "../lib/http";

// Single typed API client. baseUrl "/api" matches the OpenAPI server url; cookies
// are same-origin (dev proxy + prod embed) so the session rides along automatically.
//
// `apiFetch` rather than the platform `fetch`: every request through this client
// gets a deadline and a bounded retry, so a stalled connection ends in a said
// error rather than a button that thinks forever (#130). See lib/http.ts.
export const api = createClient<paths>({ baseUrl: "/api", fetch: apiFetch });

// Convenience aliases for the generated component schemas.
export type CurrentUser = NonNullable<
  paths["/me"]["get"]["responses"]["200"]["content"]["application/json"]
>;
export type CampaignMembership =
  paths["/campaigns"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type Campaign = CampaignMembership["campaign"];
export type Role = CampaignMembership["role"];

export type Member =
  paths["/campaigns/{campaignId}/members"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type Ban =
  paths["/campaigns/{campaignId}/bans"]["get"]["responses"]["200"]["content"]["application/json"][number];

export type Vendor =
  paths["/campaigns/{campaignId}/vendors"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type VendorStock = Vendor["stock"][number];
export type VendorInput = NonNullable<
  paths["/campaigns/{campaignId}/vendors"]["post"]["requestBody"]
>["content"]["application/json"];
export type StockInput = NonNullable<
  paths["/vendors/{vendorId}/stock"]["post"]["requestBody"]
>["content"]["application/json"];
export type StockPatch = NonNullable<
  paths["/stock/{stockId}"]["patch"]["requestBody"]
>["content"]["application/json"];

export type Npc =
  paths["/campaigns/{campaignId}/npcs"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type NpcInput = NonNullable<
  paths["/campaigns/{campaignId}/npcs"]["post"]["requestBody"]
>["content"]["application/json"];
export type Party =
  paths["/campaigns/{campaignId}/parties"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type PartyInput = NonNullable<
  paths["/campaigns/{campaignId}/parties"]["post"]["requestBody"]
>["content"]["application/json"];
export type NpcTravelInput = NonNullable<
  paths["/npcs/{npcId}/travel"]["put"]["requestBody"]
>["content"]["application/json"];
export type NpcHpInput = NonNullable<
  paths["/npcs/{npcId}/hp"]["put"]["requestBody"]
>["content"]["application/json"];

export type Quest =
  paths["/campaigns/{campaignId}/quests"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type QuestReward = Quest["rewards"][number];
export type QuestClaim = Quest["claims"][number];
export type QuestStatus = Quest["status"];
export type QuestDifficulty = Quest["difficulty"];
export type RewardType = QuestReward["type"];
export type CreateQuestInput =
  paths["/campaigns/{campaignId}/quests"]["post"]["requestBody"]["content"]["application/json"];
export type UpdateQuestInput =
  paths["/quests/{questId}"]["patch"]["requestBody"]["content"]["application/json"];
export type RewardInput = NonNullable<CreateQuestInput["rewards"]>[number];

export type Location =
  paths["/campaigns/{campaignId}/locations"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type CreateLocationInput =
  paths["/campaigns/{campaignId}/locations"]["post"]["requestBody"]["content"]["application/json"];
export type UpdateLocationInput =
  paths["/locations/{locationId}"]["patch"]["requestBody"]["content"]["application/json"];
export type SetVisibilityInput =
  paths["/locations/{locationId}/visibility"]["put"]["requestBody"]["content"]["application/json"];
export type VisibilityOverride = NonNullable<Location["visibility"]>[number];

export type Character =
  paths["/campaigns/{campaignId}/characters"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type CharacterInput =
  paths["/campaigns/{campaignId}/characters"]["post"]["requestBody"]["content"]["application/json"];
/** One class a hero holds levels in — a Rogue 5 / Wizard 3 has two (#190). */
export type CharacterClass = NonNullable<
  NonNullable<Character["sheet"]>["classes"]
>[number];

export type SkillTree =
  paths["/campaigns/{campaignId}/trees"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type SkillTreeInput =
  paths["/campaigns/{campaignId}/trees"]["post"]["requestBody"]["content"]["application/json"];
export type SkillTreeDetail =
  paths["/trees/{treeId}"]["get"]["responses"]["200"]["content"]["application/json"];
export type SkillNode = SkillTreeDetail["nodes"][number];
export type SkillEdge = SkillTreeDetail["edges"][number];
export type SkillNodeInput =
  paths["/trees/{treeId}/nodes"]["post"]["requestBody"]["content"]["application/json"];
export type CharacterTreeState =
  paths["/characters/{characterId}/tree"]["get"]["responses"]["200"]["content"]["application/json"];

export type RulesContent =
  paths["/rules/{kind}"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type RulesKind = "class" | "species" | "background" | "subclass" | "feat" | "spell" | "item" | "monster" | "rule";
export type RulesContentInput =
  paths["/rules/{kind}"]["post"]["requestBody"]["content"]["application/json"];
export type LevelUpRequest =
  paths["/characters/{characterId}/levelup"]["post"]["requestBody"]["content"]["application/json"];
export type CharacterDetail =
  paths["/characters/{characterId}"]["get"]["responses"]["200"]["content"]["application/json"];
export type InventoryItem =
  paths["/characters/{characterId}/items"]["post"]["responses"]["201"]["content"]["application/json"];
export type InventoryItemInput =
  paths["/characters/{characterId}/items"]["post"]["requestBody"]["content"]["application/json"];
export type SpellSlot = NonNullable<
  NonNullable<Character["sheet"]>["spellSlots"]
>[number];
export type ResourcePool = NonNullable<
  NonNullable<Character["sheet"]>["pools"]
>[number];
export type CharacterCreature = CharacterDetail["creatures"][number];
export type CreatureRole = CharacterCreature["role"];
export type CreatureInput =
  paths["/characters/{characterId}/creatures"]["post"]["requestBody"]["content"]["application/json"];
export type CreaturePatch =
  paths["/characters/{characterId}/creatures/{creatureId}"]["patch"]["requestBody"]["content"]["application/json"];
export type CreatureOptions =
  paths["/characters/{characterId}/creature-options"]["get"]["responses"]["200"]["content"]["application/json"];
export type CreatureOption = CreatureOptions["companions"][number];
export type FormAllowance = CreatureOptions["forms"][number];
export type ImportReport =
  paths["/rules/import"]["post"]["responses"]["200"]["content"]["application/json"];
export type HomebrewImpact =
  paths["/rules/homebrew/impact"]["get"]["responses"]["200"]["content"]["application/json"];
export type HomebrewImpactRow = HomebrewImpact["byKind"][number];
export type HomebrewBooks =
  paths["/rules/homebrew/books"]["get"]["responses"]["200"]["content"]["application/json"];
export type HomebrewBookRow = HomebrewBooks["rows"][number];
export type ChronicleEvent =
  paths["/campaigns/{campaignId}/events"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type CodexEntry =
  paths["/campaigns/{campaignId}/codex"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type SeatConflict =
  paths["/characters/{characterId}/seat"]["put"]["responses"]["409"]["content"]["application/json"];
export type ForgeRequest =
  paths["/me/characters/forge"]["post"]["requestBody"]["content"]["application/json"];
export type AbilityScores = ForgeRequest["abilities"];
export type CampaignMap =
  paths["/campaigns/{campaignId}/maps"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type MapDetail =
  paths["/maps/{mapId}"]["get"]["responses"]["200"]["content"]["application/json"];
export type MapPin = MapDetail["pins"][number];
export type MapPinInput =
  paths["/maps/{mapId}/pins"]["post"]["requestBody"]["content"]["application/json"];
export type RevealCircle = MapDetail["revealed"][number];
export type RevealBatch =
  paths["/maps/{mapId}/reveals"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type Handout =
  paths["/campaigns/{campaignId}/handouts"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type CreateHandoutInput =
  paths["/campaigns/{campaignId}/handouts"]["post"]["requestBody"]["content"]["application/json"];
export type UpdateHandoutInput =
  paths["/handouts/{handoutId}"]["patch"]["requestBody"]["content"]["application/json"];
export type Encounter =
  paths["/campaigns/{campaignId}/encounters"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type EncounterDetail =
  paths["/campaigns/{campaignId}/encounters/active"]["get"]["responses"]["200"]["content"]["application/json"];
export type Combatant = EncounterDetail["combatants"][number];
export type AddCombatantInput =
  paths["/encounters/{encounterId}/combatants"]["post"]["requestBody"]["content"]["application/json"];
export type BestiaryEntry =
  paths["/campaigns/{campaignId}/bestiary"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type BestiaryNote = BestiaryEntry["notes"][number];
export type BestiarySection = BestiaryEntry["revealed"][number];
