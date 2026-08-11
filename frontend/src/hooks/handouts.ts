/*
 * Handouts — the props the DM hands the table.
 *
 * Every mutation invalidates the chronicle alongside the satchel: revealing a
 * prop writes the line that announces it, and veiling one takes that line back
 * off the players' feed, so the two are never stale apart.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  CreateHandoutInput,
  SetVisibilityInput,
  UpdateHandoutInput,
} from "../api/client";

/** Where a handout's picture comes from. Same-origin, so the session rides along. */
export function handoutImageUrl(handoutId: string): string {
  return `/api/handouts/${handoutId}/image`;
}

export function useHandouts(campaignId: string) {
  return useQuery({
    queryKey: ["handouts", campaignId],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/handouts", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function invalidateSatchel(qc: ReturnType<typeof useQueryClient>, campaignId: string) {
  qc.invalidateQueries({ queryKey: ["handouts", campaignId] });
  qc.invalidateQueries({ queryKey: ["events", campaignId] });
}

export function useCreateHandout(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateHandoutInput) => {
      const { data, error } = await api.POST("/campaigns/{campaignId}/handouts", {
        params: { path: { campaignId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateSatchel(qc, campaignId),
  });
}

export function useUpdateHandout(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ handoutId, body }: { handoutId: string; body: UpdateHandoutInput }) => {
      const { data, error } = await api.PATCH("/handouts/{handoutId}", {
        params: { path: { handoutId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateSatchel(qc, campaignId),
  });
}

export function useDeleteHandout(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (handoutId: string) => {
      const { error } = await api.DELETE("/handouts/{handoutId}", {
        params: { path: { handoutId } },
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateSatchel(qc, campaignId),
  });
}

export function useSetHandoutVisibility(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ handoutId, body }: { handoutId: string; body: SetVisibilityInput }) => {
      const { data, error } = await api.PUT("/handouts/{handoutId}/visibility", {
        params: { path: { handoutId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateSatchel(qc, campaignId),
  });
}

// Dropping a hero's exception puts them back on whatever the party sees.
export function useClearHandoutOverride(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ handoutId, characterId }: { handoutId: string; characterId: string }) => {
      const { error } = await api.DELETE("/handouts/{handoutId}/visibility/{characterId}", {
        params: { path: { handoutId, characterId } },
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateSatchel(qc, campaignId),
  });
}
