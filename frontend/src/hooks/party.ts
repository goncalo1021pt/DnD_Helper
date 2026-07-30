/*
 * The heroes seated at a table.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CharacterInput } from "../api/client";

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
    // Quiet: CharacterForm prints the ledger's objection inside the form.
    meta: { quiet: true },
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
    // Quiet: CharacterForm prints the ledger's objection inside the form.
    meta: { quiet: true },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["characters", campaignId] });
      // HP edits here can mirror into the campaign's running encounter (see
      // syncCombatantHP server-side) — refresh whichever encounter views are open.
      qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("encounter") });
    },
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

// DM only — lift or drop the veil on one hero.
export function useRevealCharacter(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      characterId,
      revealed,
    }: {
      characterId: string;
      revealed: boolean;
    }) => {
      const { data, error } = await api.PUT("/characters/{characterId}/reveal", {
        params: { path: { characterId } },
        body: { revealed },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["characters", campaignId] });
      qc.invalidateQueries({ queryKey: ["character-detail"] });
      qc.invalidateQueries({ queryKey: ["character-tree"] });
    },
  });
}

// --- My Heroes (account-level characters) ---
