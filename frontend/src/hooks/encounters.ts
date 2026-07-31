/*
 * The prepared encounter library and the initiative tracker it becomes.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AddCombatantInput } from "../api/client";
import { apiFetch } from "../lib/http";

export function useEncounters(campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["encounters", campaignId],
    enabled,
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/encounters", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** The running encounter for a campaign (members). null when none is active. */
export function useActiveEncounter(campaignId: string) {
  return useQuery({
    queryKey: ["encounter-active", campaignId],
    refetchInterval: 8000, // no sockets yet — poll so the table stays in sync
    queryFn: async () => {
      const res = await apiFetch(`/api/campaigns/${campaignId}/encounters/active`);
      if (res.status === 204) return null;
      if (!res.ok) throw new Error("failed to load encounter");
      return (await res.json()) as import("../api/client").EncounterDetail;
    },
  });
}

export function useEncounter(encounterId: string | undefined) {
  return useQuery({
    queryKey: ["encounter", encounterId],
    enabled: !!encounterId,
    queryFn: async () => {
      const { data, error } = await api.GET("/encounters/{encounterId}", {
        params: { path: { encounterId: encounterId! } },
      });
      if (error) throw error;
      return data;
    },
  });
}

/** Invalidate everything an encounter mutation can touch. */
function invalidateEncounters(qc: ReturnType<typeof useQueryClient>, campaignId: string, encounterId?: string) {
  qc.invalidateQueries({ queryKey: ["encounters", campaignId] });
  qc.invalidateQueries({ queryKey: ["encounter-active", campaignId] });
  if (encounterId) qc.invalidateQueries({ queryKey: ["encounter", encounterId] });
}

export function useCreateEncounter(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    // A fight can be filed as it's prepared — under a session, a place, or
    // neither; the library groups on whichever the DM used.
    mutationFn: async (vars: { name: string; tag?: string; locationId?: string | null }) => {
      const { data, error } = await api.POST("/campaigns/{campaignId}/encounters", {
        params: { path: { campaignId } },
        body: { name: vars.name, tag: vars.tag, locationId: vars.locationId ?? undefined },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateEncounters(qc, campaignId),
  });
}

/** Refile a prepared encounter. The body replaces the whole filing, so this is
 * also how a fight is unpinned from a place or stripped of its tag. */
export function useFileEncounter(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { encounterId: string; tag: string; locationId: string | null }) => {
      const { data, error } = await api.PUT("/encounters/{encounterId}/filing", {
        params: { path: { encounterId: vars.encounterId } },
        body: { tag: vars.tag, locationId: vars.locationId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => invalidateEncounters(qc, campaignId, v.encounterId),
  });
}

export function useUpdateEncounter(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      encounterId: string;
      body: { name?: string; status?: string; round?: number; turnIndex?: number };
    }) => {
      const { data, error } = await api.PATCH("/encounters/{encounterId}", {
        params: { path: { encounterId: vars.encounterId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => invalidateEncounters(qc, campaignId, v.encounterId),
  });
}

/**
 * Stand down every running encounter in the campaign at once — the DM's way out
 * when several fights are open and a hero is stuck in one of them.
 */
export function useStandDownEncounters(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/campaigns/{campaignId}/encounters/stand-down", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data;
    },
    // This touches every encounter, not one, so the per-encounter detail caches
    // all have to go — any of them may have just lost its party.
    onSuccess: () => {
      invalidateEncounters(qc, campaignId);
      qc.invalidateQueries({ queryKey: ["encounter"] });
    },
  });
}

export function useDeleteEncounter(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (encounterId: string) => {
      const { error } = await api.DELETE("/encounters/{encounterId}", {
        params: { path: { encounterId } },
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateEncounters(qc, campaignId),
  });
}

export function useAddCombatant(campaignId: string, encounterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: AddCombatantInput) => {
      const { data, error } = await api.POST("/encounters/{encounterId}/combatants", {
        params: { path: { encounterId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateEncounters(qc, campaignId, encounterId),
  });
}

export function useRollInitiative(campaignId: string, encounterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/encounters/{encounterId}/roll-initiative", {
        params: { path: { encounterId } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateEncounters(qc, campaignId, encounterId),
  });
}

export function useUpdateCombatant(campaignId: string, encounterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      combatantId: string;
      body: { label?: string; playerLabel?: string; initiative?: number | null; hpCurrent?: number; hpMax?: number; ac?: number; hidden?: boolean };
    }) => {
      const { data, error } = await api.PATCH("/combatants/{combatantId}", {
        params: { path: { combatantId: vars.combatantId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateEncounters(qc, campaignId, encounterId);
      // A PC's HP here can mirror onto its character (see syncCharacterHP
      // server-side) — refresh the Party roster too.
      qc.invalidateQueries({ queryKey: ["characters", campaignId] });
    },
  });
}

export function useDeleteCombatant(campaignId: string, encounterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (combatantId: string) => {
      const { error } = await api.DELETE("/combatants/{combatantId}", {
        params: { path: { combatantId } },
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateEncounters(qc, campaignId, encounterId),
  });
}

/* Clear a whole mob in one call — twelve skeletons shouldn't be twelve taps. */
export function useDeleteCombatantGroup(campaignId: string, encounterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await api.DELETE("/encounters/{encounterId}/combatant-groups/{groupId}", {
        params: { path: { encounterId, groupId } },
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateEncounters(qc, campaignId, encounterId),
  });
}

export function useRollCombatant(campaignId: string, encounterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (combatantId: string) => {
      const { data, error } = await api.POST("/combatants/{combatantId}/roll", {
        params: { path: { combatantId } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateEncounters(qc, campaignId, encounterId),
  });
}
