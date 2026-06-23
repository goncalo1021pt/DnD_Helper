import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api/client";
import type { CreateQuestInput, UpdateQuestInput } from "./api/client";

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
