import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api/client";
import type {
  BestiarySection,
  CharacterInput,
  InventoryItemInput,
  CreateQuestInput,
  ForgeRequest,
  LevelUpRequest,
  MapPinInput,
  AddCombatantInput,
  RulesContentInput,
  RulesKind,
  SkillEdge,
  SkillNodeInput,
  SkillTreeInput,
  UpdateQuestInput,
} from "./api/client";

export interface AuthConfig {
  devLogin: boolean;
  localAuth: boolean;
  providers: string[];
  version?: string;
}

// Public endpoint describing which login options the backend actually offers.
// Lets a static SPA build render the right buttons (the build flag can't know
// the backend's mode). Lives outside the OpenAPI surface (auth routes).
export function useAuthConfig() {
  return useQuery({
    queryKey: ["auth-config"],
    queryFn: async (): Promise<AuthConfig> => {
      const res = await fetch("/api/auth/config");
      if (!res.ok) throw new Error("failed to load auth config");
      return res.json();
    },
  });
}

// Current user (or null when unauthenticated). A 401 is an expected, non-error
// state for the login gate.
export function useCurrentUser() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/me");
      if (response.status === 401) return null;
      if (error) throw error;
      return data ?? null;
    },
  });
}

export function useCampaigns() {
  return useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await api.POST("/campaigns", { body: { name } });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useJoinCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await api.POST("/campaigns/join", { body: { code } });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useRegenerateInvite(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/campaigns/{campaignId}/regenerate-invite", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] }),
  });
}

// --- Members (the DM Menu) ---

export function useMembers(campaignId: string) {
  return useQuery({
    queryKey: ["members", campaignId],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/members", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// DM only — keep disabled for players so the 403 never surfaces as an error.
export function useBans(campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["bans", campaignId],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/bans", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data ?? [];
    },
    enabled,
  });
}

// A kick touches more than the member list: the player's heroes are unseated
// and their open quest claims released, so those caches go stale too.
function invalidateAfterRemoval(qc: ReturnType<typeof useQueryClient>, campaignId: string) {
  qc.invalidateQueries({ queryKey: ["members", campaignId] });
  qc.invalidateQueries({ queryKey: ["bans", campaignId] });
  qc.invalidateQueries({ queryKey: ["characters", campaignId] });
  qc.invalidateQueries({ queryKey: ["quests", campaignId] });
}

export function useKickMember(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await api.DELETE("/campaigns/{campaignId}/members/{userId}", {
        params: { path: { campaignId, userId } },
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateAfterRemoval(qc, campaignId),
  });
}

export function useBanMember(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await api.POST("/campaigns/{campaignId}/bans", {
        params: { path: { campaignId } },
        body: { userId },
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateAfterRemoval(qc, campaignId),
  });
}

export function useUnbanMember(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await api.DELETE("/campaigns/{campaignId}/bans/{userId}", {
        params: { path: { campaignId, userId } },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bans", campaignId] }),
  });
}

// --- Quests ---

export function useQuests(campaignId: string) {
  return useQuery({
    queryKey: ["quests", campaignId],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/quests", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateQuest(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateQuestInput) => {
      const { data, error } = await api.POST("/campaigns/{campaignId}/quests", {
        params: { path: { campaignId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quests", campaignId] }),
  });
}

export function useUpdateQuest(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ questId, body }: { questId: string; body: UpdateQuestInput }) => {
      const { data, error } = await api.PATCH("/quests/{questId}", {
        params: { path: { questId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quests", campaignId] }),
  });
}

export function useDeleteQuest(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (questId: string) => {
      const { error } = await api.DELETE("/quests/{questId}", {
        params: { path: { questId } },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quests", campaignId] }),
  });
}

export function useClaimQuest(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ questId, claimed }: { questId: string; claimed: boolean }) => {
      const path = { params: { path: { questId } } } as const;
      const { error } = claimed
        ? await api.DELETE("/quests/{questId}/claim", path)
        : await api.POST("/quests/{questId}/claim", path);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quests", campaignId] }),
  });
}

export function useSetNextSession(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nextSessionAt: string | null) => {
      const { data, error } = await api.PUT("/campaigns/{campaignId}/next-session", {
        params: { path: { campaignId } },
        body: { nextSessionAt },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] }),
  });
}

// --- Party roster ---

export function useCharacters(campaignId: string) {
  return useQuery({
    queryKey: ["characters", campaignId],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/characters", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateCharacter(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CharacterInput) => {
      const { data, error } = await api.POST("/campaigns/{campaignId}/characters", {
        params: { path: { campaignId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["characters", campaignId] }),
  });
}

export function useUpdateCharacter(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      characterId,
      body,
    }: {
      characterId: string;
      body: CharacterInput;
    }) => {
      const { data, error } = await api.PATCH("/characters/{characterId}", {
        params: { path: { characterId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["characters", campaignId] }),
  });
}

export function useDeleteCharacter(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (characterId: string) => {
      const { error } = await api.DELETE("/characters/{characterId}", {
        params: { path: { characterId } },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["characters", campaignId] }),
  });
}

// --- My Heroes (account-level characters) ---

export function useMyCharacters() {
  return useQuery({
    queryKey: ["my-characters"],
    queryFn: async () => {
      const { data, error } = await api.GET("/me/characters");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateMyCharacter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CharacterInput) => {
      const { data, error } = await api.POST("/me/characters", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-characters"] }),
  });
}

export function useSeatCharacter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      characterId,
      campaignId,
    }: {
      characterId: string;
      campaignId: string | null;
    }) => {
      const { data, error } = await api.PUT("/characters/{characterId}/seat", {
        params: { path: { characterId } },
        body: { campaignId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["my-characters"] });
      qc.invalidateQueries({ queryKey: ["characters"] });
      qc.invalidateQueries({ queryKey: ["character-detail", vars.characterId] });
    },
  });
}

// --- Rules content + the forge ---

export function useRules(kind: RulesKind, enabled = true) {
  return useQuery({
    queryKey: ["rules", kind],
    enabled,
    staleTime: 5 * 60_000, // rules change on deploy, not per click
    queryFn: async () => {
      const { data, error } = await api.GET("/rules/{kind}", {
        params: { path: { kind } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

const ALL_KINDS: RulesKind[] = [
  "class", "subclass", "species", "background", "feat", "spell", "item",
];

/** Every visible rules entry across all kinds — for codex-wide rulings. */
export function useAllRules() {
  return useQueries({
    queries: ALL_KINDS.map((kind) => ({
      queryKey: ["rules", kind],
      staleTime: 5 * 60_000,
      queryFn: async () => {
        const { data, error } = await api.GET("/rules/{kind}", {
          params: { path: { kind } },
        });
        if (error) throw error;
        return data ?? [];
      },
    })),
    combine: (results) => results.flatMap((r) => r.data ?? []),
  });
}

export function useCharacterDetail(characterId: string | undefined) {
  return useQuery({
    queryKey: ["character-detail", characterId],
    enabled: !!characterId,
    queryFn: async () => {
      const { data, error } = await api.GET("/characters/{characterId}", {
        params: { path: { characterId: characterId! } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useSetSpellSlots(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (used: number[]) => {
      const { data, error } = await api.PUT("/characters/{characterId}/slots", {
        params: { path: { characterId } },
        body: { used },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["character-detail", characterId] });
      qc.invalidateQueries({ queryKey: ["characters"] });
      qc.invalidateQueries({ queryKey: ["my-characters"] });
    },
  });
}

export function useAddItem(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: InventoryItemInput) => {
      const { data, error } = await api.POST("/characters/{characterId}/items", {
        params: { path: { characterId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["character-detail", characterId] }),
  });
}

export function useUpdateItem(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      itemId: string;
      qty?: number;
      equipped?: boolean;
      slot?: "armor" | "mainhand" | "offhand";
    }) => {
      const { data, error } = await api.PATCH(
        "/characters/{characterId}/items/{itemId}",
        {
          params: { path: { characterId, itemId: vars.itemId } },
          body: { qty: vars.qty, equipped: vars.equipped, slot: vars.slot },
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["character-detail", characterId] }),
  });
}

export function useDeleteItem(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await api.DELETE(
        "/characters/{characterId}/items/{itemId}",
        { params: { path: { characterId, itemId } } },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["character-detail", characterId] }),
  });
}

export function useEvents(campaignId: string, category = "all", limit = 50) {
  return useQuery({
    queryKey: ["events", campaignId, category, limit],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/events", {
        params: { path: { campaignId }, query: { limit, category } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAddNote(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { message: string; category?: "dm" | "rules" }) => {
      const { data, error } = await api.POST("/campaigns/{campaignId}/events", {
        params: { path: { campaignId } },
        body: { message: vars.message, ...(vars.category ? { category: vars.category } : {}) },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events", campaignId] }),
  });
}

export function useGrantXP(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { amount: number; characterIds?: string[]; reason?: string }) => {
      const { data, error } = await api.POST("/campaigns/{campaignId}/xp", {
        params: { path: { campaignId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["characters", campaignId] });
      qc.invalidateQueries({ queryKey: ["my-characters"] });
      qc.invalidateQueries({ queryKey: ["events", campaignId] });
    },
  });
}

export function useDeclareMilestone(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    // Omit characterIds to raise the whole party; name heroes to single them out.
    mutationFn: async (input?: { note?: string; characterIds?: string[] }) => {
      const { error } = await api.POST("/campaigns/{campaignId}/milestone", {
        params: { path: { campaignId } },
        body: { note: input?.note, characterIds: input?.characterIds },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["characters", campaignId] });
      qc.invalidateQueries({ queryKey: ["my-characters"] });
      qc.invalidateQueries({ queryKey: ["events", campaignId] });
    },
  });
}

export function useRevokeMilestone(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    // Omit characterIds to take one back from everyone.
    mutationFn: async (characterIds?: string[]) => {
      const { error } = await api.POST("/campaigns/{campaignId}/milestone/revoke", {
        params: { path: { campaignId } },
        body: { characterIds },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["characters", campaignId] });
      qc.invalidateQueries({ queryKey: ["my-characters"] });
      qc.invalidateQueries({ queryKey: ["events", campaignId] });
    },
  });
}

export function useSetMaxLevel(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (maxLevel: number | null) => {
      const { data, error } = await api.PUT("/campaigns/{campaignId}/max-level", {
        params: { path: { campaignId } },
        body: { maxLevel },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["events", campaignId] });
    },
  });
}

export function useSetProgression(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mode: "milestone" | "xp") => {
      const { data, error } = await api.PUT("/campaigns/{campaignId}/progression", {
        params: { path: { campaignId } },
        body: { mode },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["events", campaignId] });
    },
  });
}

export function useImportPack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entries: unknown[]) => {
      const { data, error } = await api.POST("/rules/import", {
        body: { entries: entries as never },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] });
      qc.invalidateQueries({ queryKey: ["homebrew-books"] });
      qc.invalidateQueries({ queryKey: ["homebrew-impact"] });
    },
  });
}

// The blast radius of a homebrew reset, per kind. Kept fresh (no staleTime) so
// the reset modal always shows current counts.
export function useHomebrewImpact(enabled = true) {
  return useQuery({
    queryKey: ["homebrew-impact"],
    enabled,
    queryFn: async () => {
      const { data, error } = await api.GET("/rules/homebrew/impact");
      if (error) throw error;
      return data;
    },
  });
}

// The caller's homebrew grouped by source book — the imported-packs shelf.
export function useHomebrewBooks() {
  return useQuery({
    queryKey: ["homebrew-books"],
    queryFn: async () => {
      const { data, error } = await api.GET("/rules/homebrew/books");
      if (error) throw error;
      return data;
    },
  });
}

// Wipe the caller's homebrew — everything, one kind, or one imported book.
// Invalidates every rules shelf plus the impact preview and the book shelf.
export function useResetHomebrew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (scope?: { kind?: RulesKind; book?: string }) => {
      const query: { kind?: RulesKind; book?: string } = {};
      if (scope?.kind) query.kind = scope.kind;
      if (scope?.book) query.book = scope.book;
      const { data, error } = await api.DELETE("/rules/homebrew", {
        params: Object.keys(query).length ? { query } : {},
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] });
      qc.invalidateQueries({ queryKey: ["homebrew-impact"] });
      qc.invalidateQueries({ queryKey: ["homebrew-books"] });
    },
  });
}

export function useSetCodexStatusBulk(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { contentIds: string[]; status: "enabled" | "banned" }) => {
      const { error } = await api.POST("/campaigns/{campaignId}/codex/bulk", {
        params: { path: { campaignId } },
        body: vars,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["codex", campaignId] });
      qc.invalidateQueries({ queryKey: ["rules"] });
      qc.invalidateQueries({ queryKey: ["events", campaignId] });
    },
  });
}

export function useCodex(campaignId: string | undefined) {
  return useQuery({
    queryKey: ["codex", campaignId],
    enabled: !!campaignId,
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/codex", {
        params: { path: { campaignId: campaignId! } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSetCodexStatus(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { contentId: string; status: "enabled" | "banned" }) => {
      const { error } = await api.PUT("/campaigns/{campaignId}/codex/{contentId}", {
        params: { path: { campaignId, contentId: vars.contentId } },
        body: { status: vars.status },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["codex", campaignId] });
      qc.invalidateQueries({ queryKey: ["rules"] });
    },
  });
}

export function useClearCodexStatus(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contentId: string) => {
      const { error } = await api.DELETE("/campaigns/{campaignId}/codex/{contentId}", {
        params: { path: { campaignId, contentId } },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["codex", campaignId] });
      qc.invalidateQueries({ queryKey: ["rules"] });
    },
  });
}

export function useProposeCodex(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contentIds: string[]) => {
      const { error } = await api.POST("/campaigns/{campaignId}/codex", {
        params: { path: { campaignId } },
        body: { contentIds },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["codex", campaignId] }),
  });
}

export function useCreateRules(kind: RulesKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RulesContentInput) => {
      const { data, error } = await api.POST("/rules/{kind}", {
        params: { path: { kind } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules", kind] }),
  });
}

export function useUpdateRules(kind: RulesKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { contentId: string; body: RulesContentInput }) => {
      const { data, error } = await api.PUT("/rules/content/{contentId}", {
        params: { path: { contentId: vars.contentId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules", kind] }),
  });
}

export function useDeleteRules(kind: RulesKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contentId: string) => {
      const { error } = await api.DELETE("/rules/content/{contentId}", {
        params: { path: { contentId } },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules", kind] }),
  });
}

export function useLevelUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { characterId: string; body: LevelUpRequest }) => {
      const { data, error } = await api.POST("/characters/{characterId}/levelup", {
        params: { path: { characterId: vars.characterId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["my-characters"] });
      qc.invalidateQueries({ queryKey: ["characters"] });
      qc.invalidateQueries({ queryKey: ["character-detail", vars.characterId] });
    },
  });
}

export function useForgeCharacter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ForgeRequest) => {
      const { data, error } = await api.POST("/me/characters/forge", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-characters"] }),
  });
}

// --- Skill trees ---

export function useTrees(campaignId: string) {
  return useQuery({
    queryKey: ["trees", campaignId],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/trees", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateTree(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: SkillTreeInput) => {
      const { data, error } = await api.POST("/campaigns/{campaignId}/trees", {
        params: { path: { campaignId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trees", campaignId] }),
  });
}

export function useTree(treeId: string) {
  return useQuery({
    queryKey: ["tree", treeId],
    queryFn: async () => {
      const { data, error } = await api.GET("/trees/{treeId}", {
        params: { path: { treeId } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateTree(campaignId: string, treeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: SkillTreeInput) => {
      const { data, error } = await api.PATCH("/trees/{treeId}", {
        params: { path: { treeId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tree", treeId] });
      qc.invalidateQueries({ queryKey: ["trees", campaignId] });
    },
  });
}

export function useDeleteTree(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (treeId: string) => {
      const { error } = await api.DELETE("/trees/{treeId}", {
        params: { path: { treeId } },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trees", campaignId] }),
  });
}

export function useCreateNode(treeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: SkillNodeInput) => {
      const { data, error } = await api.POST("/trees/{treeId}/nodes", {
        params: { path: { treeId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tree", treeId] }),
  });
}

export function useUpdateNode(treeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ nodeId, body }: { nodeId: string; body: SkillNodeInput }) => {
      const { data, error } = await api.PATCH("/nodes/{nodeId}", {
        params: { path: { nodeId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tree", treeId] }),
  });
}

export function useDeleteNode(treeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nodeId: string) => {
      const { error } = await api.DELETE("/nodes/{nodeId}", {
        params: { path: { nodeId } },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tree", treeId] }),
  });
}

export function useSetEdges(treeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (edges: SkillEdge[]) => {
      const { data, error } = await api.PUT("/trees/{treeId}/edges", {
        params: { path: { treeId } },
        body: { edges },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tree", treeId] }),
  });
}

export function useCharacterTree(characterId: string) {
  return useQuery({
    queryKey: ["character-tree", characterId],
    queryFn: async () => {
      const { data, error } = await api.GET("/characters/{characterId}/tree", {
        params: { path: { characterId } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useSetPact(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (treeId: string) => {
      const { data, error } = await api.PUT("/characters/{characterId}/tree", {
        params: { path: { characterId } },
        body: { treeId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["character-tree", characterId] }),
  });
}

export function useGrantPicks(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (picks: number) => {
      const { data, error } = await api.POST("/characters/{characterId}/tree/grants", {
        params: { path: { characterId } },
        body: { picks },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["character-tree", characterId] }),
  });
}

export function useSpendPick(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nodeId: string) => {
      const { data, error } = await api.POST("/characters/{characterId}/tree/picks", {
        params: { path: { characterId } },
        body: { nodeId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["character-tree", characterId] }),
  });
}

// --- The Bestiary ---------------------------------------------------------

// ── the Map ────────────────────────────────────────────────────────────────

export function useMaps(campaignId: string) {
  return useQuery({
    queryKey: ["maps", campaignId],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/maps", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateMap(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      name: string;
      imageBase64: string;
      parentMapId?: string;
    }) => {
      const { data, error } = await api.POST("/campaigns/{campaignId}/maps", {
        params: { path: { campaignId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maps", campaignId] }),
  });
}

export function useMapDetail(mapId: string | undefined) {
  return useQuery({
    queryKey: ["map", mapId],
    enabled: !!mapId,
    queryFn: async () => {
      const { data, error } = await api.GET("/maps/{mapId}", {
        params: { path: { mapId: mapId! } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateMap(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      mapId: string;
      body: { name: string; parentMapId?: string; fogEnabled?: boolean };
    }) => {
      const { data, error } = await api.PATCH("/maps/{mapId}", {
        params: { path: { mapId: vars.mapId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["maps", campaignId] });
      qc.invalidateQueries({ queryKey: ["map", vars.mapId] });
    },
  });
}

export function useDeleteMap(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mapId: string) => {
      const { error } = await api.DELETE("/maps/{mapId}", {
        params: { path: { mapId } },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maps", campaignId] }),
  });
}

export function useCreateMapPin(mapId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: MapPinInput) => {
      const { data, error } = await api.POST("/maps/{mapId}/pins", {
        params: { path: { mapId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["map", mapId] }),
  });
}

export function useUpdateMapPin(mapId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { pinId: string; body: MapPinInput }) => {
      const { data, error } = await api.PATCH("/pins/{pinId}", {
        params: { path: { pinId: vars.pinId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["map", mapId] }),
  });
}

export function useDeleteMapPin(mapId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pinId: string) => {
      const { error } = await api.DELETE("/pins/{pinId}", {
        params: { path: { pinId } },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["map", mapId] }),
  });
}

export function useRevealBatches(mapId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["reveals", mapId],
    enabled: !!mapId && enabled,
    queryFn: async () => {
      const { data, error } = await api.GET("/maps/{mapId}/reveals", {
        params: { path: { mapId: mapId! } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useSubmitReveals(mapId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      note?: string;
      circles: { x: number; y: number; r: number }[];
    }) => {
      const { data, error } = await api.POST("/maps/{mapId}/reveals", {
        params: { path: { mapId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["map", mapId] });
      qc.invalidateQueries({ queryKey: ["reveals", mapId] });
    },
  });
}

export function useDeleteReveals(mapId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (batchId: string) => {
      const { error } = await api.DELETE("/reveals/{batchId}", {
        params: { path: { batchId } },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["map", mapId] });
      qc.invalidateQueries({ queryKey: ["reveals", mapId] });
    },
  });
}

// ── Encounters ───────────────────────────────────────────────────────────

export function useEncounters(campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["encounters", campaignId],
    enabled,
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/encounters", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** The running encounter for a campaign (members). null when none is active. */
export function useActiveEncounter(campaignId: string) {
  return useQuery({
    queryKey: ["encounter-active", campaignId],
    refetchInterval: 8000, // no sockets yet — poll so the table stays in sync
    queryFn: async () => {
      const res = await fetch(`/api/campaigns/${campaignId}/encounters/active`);
      if (res.status === 204) return null;
      if (!res.ok) throw new Error("failed to load encounter");
      return (await res.json()) as import("./api/client").EncounterDetail;
    },
  });
}

export function useEncounter(encounterId: string | undefined) {
  return useQuery({
    queryKey: ["encounter", encounterId],
    enabled: !!encounterId,
    queryFn: async () => {
      const { data, error } = await api.GET("/encounters/{encounterId}", {
        params: { path: { encounterId: encounterId! } },
      });
      if (error) throw error;
      return data;
    },
  });
}

/** Invalidate everything an encounter mutation can touch. */
function invalidateEncounters(qc: ReturnType<typeof useQueryClient>, campaignId: string, encounterId?: string) {
  qc.invalidateQueries({ queryKey: ["encounters", campaignId] });
  qc.invalidateQueries({ queryKey: ["encounter-active", campaignId] });
  if (encounterId) qc.invalidateQueries({ queryKey: ["encounter", encounterId] });
}

export function useCreateEncounter(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await api.POST("/campaigns/{campaignId}/encounters", {
        params: { path: { campaignId } },
        body: { name },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateEncounters(qc, campaignId),
  });
}

export function useUpdateEncounter(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      encounterId: string;
      body: { name?: string; status?: string; round?: number; turnIndex?: number };
    }) => {
      const { data, error } = await api.PATCH("/encounters/{encounterId}", {
        params: { path: { encounterId: vars.encounterId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => invalidateEncounters(qc, campaignId, v.encounterId),
  });
}

export function useDeleteEncounter(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (encounterId: string) => {
      const { error } = await api.DELETE("/encounters/{encounterId}", {
        params: { path: { encounterId } },
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateEncounters(qc, campaignId),
  });
}

export function useAddCombatant(campaignId: string, encounterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: AddCombatantInput) => {
      const { data, error } = await api.POST("/encounters/{encounterId}/combatants", {
        params: { path: { encounterId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateEncounters(qc, campaignId, encounterId),
  });
}

export function useRollInitiative(campaignId: string, encounterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/encounters/{encounterId}/roll-initiative", {
        params: { path: { encounterId } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateEncounters(qc, campaignId, encounterId),
  });
}

export function useUpdateCombatant(campaignId: string, encounterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      combatantId: string;
      body: { label?: string; playerLabel?: string; initiative?: number | null; hpCurrent?: number; hpMax?: number; ac?: number; hidden?: boolean };
    }) => {
      const { data, error } = await api.PATCH("/combatants/{combatantId}", {
        params: { path: { combatantId: vars.combatantId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateEncounters(qc, campaignId, encounterId),
  });
}

export function useDeleteCombatant(campaignId: string, encounterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (combatantId: string) => {
      const { error } = await api.DELETE("/combatants/{combatantId}", {
        params: { path: { combatantId } },
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateEncounters(qc, campaignId, encounterId),
  });
}

export function useRollCombatant(campaignId: string, encounterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (combatantId: string) => {
      const { data, error } = await api.POST("/combatants/{combatantId}/roll", {
        params: { path: { combatantId } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateEncounters(qc, campaignId, encounterId),
  });
}

export function useBestiary(campaignId: string) {
  return useQuery({
    queryKey: ["bestiary", campaignId],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/bestiary", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateBestiaryEntry(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (title: string) => {
      const { data, error } = await api.POST("/campaigns/{campaignId}/bestiary", {
        params: { path: { campaignId } },
        body: { title },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bestiary", campaignId] }),
  });
}

export function useUpdateBestiaryEntry(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      entryId: string;
      title?: string;
      contentId?: string;
      revealed?: BestiarySection[];
    }) => {
      const { data, error } = await api.PATCH(
        "/campaigns/{campaignId}/bestiary/{entryId}",
        {
          params: { path: { campaignId, entryId: vars.entryId } },
          body: { title: vars.title, contentId: vars.contentId, revealed: vars.revealed },
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bestiary", campaignId] }),
  });
}

export function useDeleteBestiaryEntry(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await api.DELETE(
        "/campaigns/{campaignId}/bestiary/{entryId}",
        { params: { path: { campaignId, entryId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bestiary", campaignId] }),
  });
}

export function useAddBestiaryNote(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { entryId: string; body: string }) => {
      const { data, error } = await api.POST(
        "/campaigns/{campaignId}/bestiary/{entryId}/notes",
        {
          params: { path: { campaignId, entryId: vars.entryId } },
          body: { body: vars.body },
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bestiary", campaignId] }),
  });
}

export function useDeleteBestiaryNote(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { entryId: string; noteId: string }) => {
      const { error } = await api.DELETE(
        "/campaigns/{campaignId}/bestiary/{entryId}/notes/{noteId}",
        { params: { path: { campaignId, entryId: vars.entryId, noteId: vars.noteId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bestiary", campaignId] }),
  });
}

// Logout lives outside the OpenAPI surface (auth routes), so call it directly.
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetch("/api/auth/logout", { method: "POST" });
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

// ── Two-factor auth (TOTP) ──────────────────────────────────────────────────
// These auth routes live outside the OpenAPI surface, so call them directly.
// A failed call throws with { status, data } so callers can read field errors.
type TwofaError = Error & { status: number; data: { field?: string; error?: string } };

async function authPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error("request failed"), { status: res.status, data }) as TwofaError;
  }
  return data as T;
}

export type TwofaSetup = { otpauthUrl: string; secret: string; qrPng: string };

export function useTwofaSetup() {
  return useMutation({ mutationFn: () => authPost<TwofaSetup>("/api/auth/2fa/setup") });
}

export function useTwofaEnable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => authPost<{ recoveryCodes: string[] }>("/api/auth/2fa/enable", { code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useTwofaDisable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => authPost<Record<string, never>>("/api/auth/2fa/disable", { password }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}
