import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api/client";
import type {
  CharacterInput,
  CreateQuestInput,
  SkillEdge,
  SkillNodeInput,
  SkillTreeInput,
  UpdateQuestInput,
} from "./api/client";

export interface AuthConfig {
  devLogin: boolean;
  providers: string[];
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-characters"] });
      qc.invalidateQueries({ queryKey: ["characters"] });
    },
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
