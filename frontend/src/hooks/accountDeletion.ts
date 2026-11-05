/*
 * Deleting an account (#322): ask, wait a week, be anonymised in place.
 *
 * Session-only on the wire, like token management — a key must never be able to
 * take an account from its owner — so these run only from the profile and the
 * emailed link's page. The mutations are quiet: the modal and the page print a
 * wrong password or a blocked table inside the form they belong to.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { announceAuthChange } from "./auth";
import { rememberDeletion } from "../lib/deletionNotice";

export function useAccountDeletion(enabled = true) {
  return useQuery({
    queryKey: ["accountDeletion"],
    enabled,
    queryFn: async () => {
      const { data, error } = await api.GET("/me/deletion");
      if (error) throw error;
      return data!;
    },
  });
}

/** The error text of a failed call, whichever shape the client threw it in. */
export function deletionError(e: unknown, fallback: string): string {
  const x = e as { error?: string; data?: { error?: string } } | null;
  return x?.data?.error ?? x?.error ?? fallback;
}

/** What a scheduled deletion leaves behind in the browser: the day, and no session. */
export function useForgetSession() {
  const qc = useQueryClient();
  return () => {
    qc.setQueryData(["me"], null);
    announceAuthChange();
  };
}

export function useRequestAccountDeletion() {
  return useMutation({
    meta: { quiet: true },
    mutationFn: async (body: { password?: string; name?: string }) => {
      const { data, error } = await api.POST("/me/deletion", { body });
      if (error) throw error;
      return data!;
    },
    onSuccess: (d) => rememberDeletion(d.scheduledFor),
  });
}

export function useSendDeletionLink() {
  return useMutation({
    meta: { quiet: true },
    mutationFn: async () => {
      const { error } = await api.POST("/me/deletion/email");
      if (error) throw error;
    },
  });
}

export function useConfirmAccountDeletion() {
  return useMutation({
    meta: { quiet: true },
    mutationFn: async (token: string) => {
      const { data, error } = await api.POST("/me/deletion/confirm", { body: { token } });
      if (error) throw error;
      return data!;
    },
    onSuccess: (d) => rememberDeletion(d.scheduledFor),
  });
}
