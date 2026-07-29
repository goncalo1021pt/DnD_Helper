/*
 * The place tree, and the veil the DM draws over it. Quests hang off places,
 * so revealing either one invalidates the board.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CreateLocationInput, UpdateLocationInput, SetVisibilityInput } from "../api/client";

export function useLocations(campaignId: string) {
  return useQuery({
    queryKey: ["locations", campaignId],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/locations", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function invalidateBoard(qc: ReturnType<typeof useQueryClient>, campaignId: string) {
  qc.invalidateQueries({ queryKey: ["locations", campaignId] });
  qc.invalidateQueries({ queryKey: ["quests", campaignId] });
}

export function useCreateLocation(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateLocationInput) => {
      const { data, error } = await api.POST("/campaigns/{campaignId}/locations", {
        params: { path: { campaignId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateBoard(qc, campaignId),
  });
}

export function useUpdateLocation(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ locationId, body }: { locationId: string; body: UpdateLocationInput }) => {
      const { data, error } = await api.PATCH("/locations/{locationId}", {
        params: { path: { locationId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateBoard(qc, campaignId),
  });
}

export function useDeleteLocation(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (locationId: string) => {
      const { error } = await api.DELETE("/locations/{locationId}", {
        params: { path: { locationId } },
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateBoard(qc, campaignId),
  });
}

export function useSetLocationVisibility(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ locationId, body }: { locationId: string; body: SetVisibilityInput }) => {
      const { data, error } = await api.PUT("/locations/{locationId}/visibility", {
        params: { path: { locationId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateBoard(qc, campaignId),
  });
}

export function useSetQuestVisibility(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ questId, body }: { questId: string; body: SetVisibilityInput }) => {
      const { data, error } = await api.PUT("/quests/{questId}/visibility", {
        params: { path: { questId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateBoard(qc, campaignId),
  });
}

// Dropping a hero's exception puts them back on whatever the party sees.
export function useClearLocationOverride(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ locationId, characterId }: { locationId: string; characterId: string }) => {
      const { error } = await api.DELETE("/locations/{locationId}/visibility/{characterId}", {
        params: { path: { locationId, characterId } },
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateBoard(qc, campaignId),
  });
}

export function useClearQuestOverride(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ questId, characterId }: { questId: string; characterId: string }) => {
      const { error } = await api.DELETE("/quests/{questId}/visibility/{characterId}", {
        params: { path: { questId, characterId } },
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateBoard(qc, campaignId),
  });
}
