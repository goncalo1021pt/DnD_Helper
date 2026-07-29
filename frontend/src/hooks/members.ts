/*
 * Managing a table: who sits at it, who is barred, and the rules the DM sets
 * over it — the DM Menu's data layer.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export function useMembers(campaignId: string) {
  return useQuery({
    queryKey: ["members", campaignId],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/members", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// DM only — keep disabled for players so the 403 never surfaces as an error.
export function useBans(campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["bans", campaignId],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/bans", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data ?? [];
    },
    enabled,
  });
}

// A kick touches more than the member list: the player's heroes are unseated
// and their open quest claims released, so those caches go stale too.
function invalidateAfterRemoval(qc: ReturnType<typeof useQueryClient>, campaignId: string) {
  qc.invalidateQueries({ queryKey: ["members", campaignId] });
  qc.invalidateQueries({ queryKey: ["bans", campaignId] });
  qc.invalidateQueries({ queryKey: ["characters", campaignId] });
  qc.invalidateQueries({ queryKey: ["quests", campaignId] });
}

export function useKickMember(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await api.DELETE("/campaigns/{campaignId}/members/{userId}", {
        params: { path: { campaignId, userId } },
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateAfterRemoval(qc, campaignId),
  });
}

export function useBanMember(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await api.POST("/campaigns/{campaignId}/bans", {
        params: { path: { campaignId } },
        body: { userId },
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateAfterRemoval(qc, campaignId),
  });
}

export function useUnbanMember(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await api.DELETE("/campaigns/{campaignId}/bans/{userId}", {
        params: { path: { campaignId, userId } },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bans", campaignId] }),
  });
}

export function useSetSeatingApproval(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { data, error } = await api.PUT("/campaigns/{campaignId}/seating-approval", {
        params: { path: { campaignId } },
        body: { enabled },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["events", campaignId] });
    },
  });
}

// DM only — the heroes waiting at the door.
export function useSeatRequests(campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["seat-requests", campaignId],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/seat-requests", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data ?? [];
    },
    enabled,
  });
}

export function useApproveSeat(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (characterId: string) => {
      const { error } = await api.POST(
        "/campaigns/{campaignId}/seat-requests/{characterId}/approve",
        { params: { path: { campaignId, characterId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["seat-requests", campaignId] });
      qc.invalidateQueries({ queryKey: ["characters", campaignId] });
      qc.invalidateQueries({ queryKey: ["events", campaignId] });
    },
  });
}

export function useDenySeat(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (characterId: string) => {
      const { error } = await api.DELETE(
        "/campaigns/{campaignId}/seat-requests/{characterId}",
        { params: { path: { campaignId, characterId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["seat-requests", campaignId] }),
  });
}

// The caller's own heroes still waiting at a door.
export function useMySeatRequests() {
  return useQuery({
    queryKey: ["my-seat-requests"],
    queryFn: async () => {
      const { data, error } = await api.GET("/me/seat-requests");
      if (error) throw error;
      return data ?? [];
    },
  });
}

// DM only — draw or lift the veil over the table's sheets.
export function useSetHiddenSheets(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { data, error } = await api.PUT("/campaigns/{campaignId}/hidden-sheets", {
        params: { path: { campaignId } },
        body: { enabled },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["characters", campaignId] });
      qc.invalidateQueries({ queryKey: ["events", campaignId] });
    },
  });
}

export function useSetMaxLevel(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (maxLevel: number | null) => {
      const { data, error } = await api.PUT("/campaigns/{campaignId}/max-level", {
        params: { path: { campaignId } },
        body: { maxLevel },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["events", campaignId] });
    },
  });
}

export function useSetProgression(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mode: "milestone" | "xp") => {
      const { data, error } = await api.PUT("/campaigns/{campaignId}/progression", {
        params: { path: { campaignId } },
        body: { mode },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["events", campaignId] });
    },
  });
}
