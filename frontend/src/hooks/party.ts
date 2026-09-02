/*
 * The heroes seated at a table.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CharacterInput } from "../api/client";

export function useCharacters(campaignId: string) {
  return useQuery({
    queryKey: ["characters", campaignId],
    // An empty id is never a request worth making — it lets a caller say "not
    // for this viewer" without a wasted round trip (#276).
    enabled: !!campaignId,
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

/*
 * Pre-made heroes (#180): a DM offers heroes into a one-shot's pool and any
 * member claims one. Claiming and releasing move a hero between the pool and
 * the roster, so both invalidate both lists.
 */
export function usePregens(campaignId: string) {
  return useQuery({
    queryKey: ["pregens", campaignId],
    enabled: !!campaignId,
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/pregens", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function invalidatePregens(qc: ReturnType<typeof useQueryClient>, campaignId: string) {
  qc.invalidateQueries({ queryKey: ["pregens", campaignId] });
  qc.invalidateQueries({ queryKey: ["characters", campaignId] });
  qc.invalidateQueries({ queryKey: ["my-characters"] });
}

// DM only — offer one of the DM's own unseated heroes into the pool.
export function useOfferPregen(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (characterId: string) => {
      const { data, error } = await api.POST("/campaigns/{campaignId}/pregens", {
        params: { path: { campaignId } },
        body: { characterId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidatePregens(qc, campaignId),
  });
}

// DM only — pull an unclaimed pregen back to the DM's shelf.
export function useWithdrawPregen(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (characterId: string) => {
      const { error } = await api.DELETE("/campaigns/{campaignId}/pregens/{characterId}", {
        params: { path: { campaignId, characterId } },
      });
      if (error) throw error;
    },
    onSuccess: () => invalidatePregens(qc, campaignId),
  });
}

// Any member — take a pre-made hero as your own.
export function useClaimPregen(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (characterId: string) => {
      const { data, error } = await api.POST("/characters/{characterId}/claim", {
        params: { path: { characterId } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidatePregens(qc, campaignId),
  });
}

// Its player, or the DM — hand a claimed pregen back to the pool.
export function useReleasePregen(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (characterId: string) => {
      const { data, error } = await api.POST("/characters/{characterId}/release", {
        params: { path: { characterId } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidatePregens(qc, campaignId),
  });
}

// --- My Heroes (account-level characters) ---
