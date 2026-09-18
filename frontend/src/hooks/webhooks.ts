/*
 * Webhooks (#295): a person's standing order to be told, at a URL of their
 * choosing, when chosen events happen. Managed on the profile; the same
 * endpoints answer a token under the webhooks scope.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { WebhookInput } from "../api/client";

export function useWebhooks() {
  return useQuery({
    queryKey: ["webhooks"],
    queryFn: async () => {
      const { data, error } = await api.GET("/me/webhooks");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useWebhookDeliveries(webhookId: string) {
  return useQuery({
    queryKey: ["webhooks", webhookId, "deliveries"],
    enabled: !!webhookId,
    // The worker posts every two seconds; a person watching the log is
    // usually waiting for a ping to land.
    refetchInterval: 3000,
    queryFn: async () => {
      const { data, error } = await api.GET("/me/webhooks/{webhookId}/deliveries", { params: { path: { webhookId } } });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: WebhookInput) => {
      const { data, error } = await api.POST("/me/webhooks", { body: input });
      if (error) throw error;
      return data!;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (webhookId: string) => {
      const { error } = await api.DELETE("/me/webhooks/{webhookId}", { params: { path: { webhookId } } });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });
}

export function useEnableWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (webhookId: string) => {
      const { data, error } = await api.POST("/me/webhooks/{webhookId}/enable", { params: { path: { webhookId } } });
      if (error) throw error;
      return data!;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });
}

export function usePingWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (webhookId: string) => {
      const { data, error } = await api.POST("/me/webhooks/{webhookId}/ping", { params: { path: { webhookId } } });
      if (error) throw error;
      return data!;
    },
    onSuccess: (_d, webhookId) => qc.invalidateQueries({ queryKey: ["webhooks", webhookId, "deliveries"] }),
  });
}
