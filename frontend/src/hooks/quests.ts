/*
 * Notices on the board, and the claiming of them.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CreateQuestInput, UpdateQuestInput } from "../api/client";

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

// --- Locations ---
//
// Revealing a place changes which notices the board returns, so every
// visibility mutation refreshes the quests cache alongside the locations one.
