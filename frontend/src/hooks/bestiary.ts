/*
 * The party's field journal, revealed a section at a time.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { BestiarySection } from "../api/client";

export function useBestiary(campaignId: string) {
  return useQuery({
    queryKey: ["bestiary", campaignId],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/bestiary", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateBestiaryEntry(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (title: string) => {
      const { data, error } = await api.POST("/campaigns/{campaignId}/bestiary", {
        params: { path: { campaignId } },
        body: { title },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bestiary", campaignId] }),
  });
}

export function useUpdateBestiaryEntry(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      entryId: string;
      title?: string;
      contentId?: string;
      revealed?: BestiarySection[];
    }) => {
      const { data, error } = await api.PATCH(
        "/campaigns/{campaignId}/bestiary/{entryId}",
        {
          params: { path: { campaignId, entryId: vars.entryId } },
          body: { title: vars.title, contentId: vars.contentId, revealed: vars.revealed },
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bestiary", campaignId] }),
  });
}

export function useDeleteBestiaryEntry(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await api.DELETE(
        "/campaigns/{campaignId}/bestiary/{entryId}",
        { params: { path: { campaignId, entryId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bestiary", campaignId] }),
  });
}

export function useAddBestiaryNote(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { entryId: string; body: string }) => {
      const { data, error } = await api.POST(
        "/campaigns/{campaignId}/bestiary/{entryId}/notes",
        {
          params: { path: { campaignId, entryId: vars.entryId } },
          body: { body: vars.body },
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bestiary", campaignId] }),
  });
}

export function useDeleteBestiaryNote(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { entryId: string; noteId: string }) => {
      const { error } = await api.DELETE(
        "/campaigns/{campaignId}/bestiary/{entryId}/notes/{noteId}",
        { params: { path: { campaignId, entryId: vars.entryId, noteId: vars.noteId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bestiary", campaignId] }),
  });
}
