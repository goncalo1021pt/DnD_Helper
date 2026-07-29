/*
 * A campaign's codex — what content the DM admits to their world.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

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
