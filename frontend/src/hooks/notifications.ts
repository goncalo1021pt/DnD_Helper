/*
 * Notifications that reach you outside the app (#316): which events are
 * emailed to me, a table I muted, and the Discord channel a DM hangs on a
 * table. A Discord channel of my own is a webhook with `format: discord`,
 * managed in hooks/webhooks.ts.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { NotificationSettingsInput, TableChannelInput } from "../api/client";

export function useNotificationSettings() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const { data, error } = await api.GET("/me/notifications");
      if (error) throw error;
      return data!;
    },
  });
}

export function useSetNotificationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NotificationSettingsInput) => {
      const { data, error } = await api.PUT("/me/notifications", { body: input });
      if (error) throw error;
      return data!;
    },
    onSuccess: (data) => qc.setQueryData(["notifications"], data),
  });
}

// Any member — a fact about my membership, so it rides /me.
export function useSetCampaignMute(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (muted: boolean) => {
      const { error } = await api.PUT("/campaigns/{campaignId}/mute", {
        params: { path: { campaignId } },
        body: { muted },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

// DM only — hang, replace or take down the table's channel.
export function useSetTableChannel(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TableChannelInput) => {
      const { data, error } = await api.PUT("/campaigns/{campaignId}/channel", {
        params: { path: { campaignId } },
        body: input,
      });
      if (error) throw error;
      return data!;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] }),
  });
}

export function useRemoveTableChannel(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await api.DELETE("/campaigns/{campaignId}/channel", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data!;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] }),
  });
}

export function usePingTableChannel(campaignId: string) {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/campaigns/{campaignId}/channel/ping", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data!;
    },
  });
}
