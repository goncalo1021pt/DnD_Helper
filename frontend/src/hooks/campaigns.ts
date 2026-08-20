/*
 * The tables themselves: founding one, joining by invite code, striking one,
 * and when the party next gathers.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

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

/**
 * Found a campaign. `realmId` puts it on ground you already have (#233);
 * omitted — the default, and what every table did before realms — it gets a
 * realm of its own, named after it.
 */
export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, realmId }: { name: string; realmId?: string }) => {
      const { data, error } = await api.POST("/campaigns", {
        body: realmId ? { name, realmId } : { name },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["realms"] });
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

export function useDeleteCampaign(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE("/campaigns/{campaignId}", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["my-characters"] });
    },
  });
}

// Leaving mirrors a kick, self-served: heroes return to My Heroes, open
// quest claims release, knowledge pools forget you.
export function useLeaveCampaign(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await api.POST("/campaigns/{campaignId}/leave", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["my-characters"] });
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
