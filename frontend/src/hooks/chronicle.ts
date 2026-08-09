/*
 * The shared table log, and the XP and milestones that ride along with it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

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

/**
 * Roll dice where the table can see them (#176). The server rolls and writes
 * the result into the chronicle's rolls channel; the feed refreshes through
 * the same invalidation any chronicle entry uses.
 *
 * Quiet on failure: the tower shows its own refusal beside the dice, and a
 * notice sliding in over the tray would say the same thing twice.
 */
export function useRollInTheOpen(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      groups: Array<{ count: number; sides: number }>;
      // Required, not optional: the schema gives it a default, which openapi
      // -typescript reads as "always present in the body".
      modifier: number;
      label?: string;
    }) => {
      const { data, error } = await api.POST("/campaigns/{campaignId}/rolls", {
        params: { path: { campaignId } },
        body: vars,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
    },
    meta: { quiet: true },
  });
}
