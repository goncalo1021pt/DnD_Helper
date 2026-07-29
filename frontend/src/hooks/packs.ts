/*
 * Private content packs: importing them, and clearing out what they brought.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { RulesKind } from "../api/client";

export function useImportPack() {
  const qc = useQueryClient();
  return useMutation({
    // book stamps every entry that doesn't name its own source, so imported
    // content reads as its pack rather than a flat "Homebrew".
    mutationFn: async (pack: { entries: unknown[]; book?: string }) => {
      const { data, error } = await api.POST("/rules/import", {
        body: { entries: pack.entries as never, book: pack.book || undefined },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] });
      qc.invalidateQueries({ queryKey: ["homebrew-books"] });
      qc.invalidateQueries({ queryKey: ["homebrew-impact"] });
    },
  });
}

// The blast radius of a homebrew reset, per kind. Kept fresh (no staleTime) so
// the reset modal always shows current counts.
export function useHomebrewImpact(enabled = true) {
  return useQuery({
    queryKey: ["homebrew-impact"],
    enabled,
    queryFn: async () => {
      const { data, error } = await api.GET("/rules/homebrew/impact");
      if (error) throw error;
      return data;
    },
  });
}

// The caller's homebrew grouped by source book — the imported-packs shelf.
export function useHomebrewBooks() {
  return useQuery({
    queryKey: ["homebrew-books"],
    queryFn: async () => {
      const { data, error } = await api.GET("/rules/homebrew/books");
      if (error) throw error;
      return data;
    },
  });
}

// Wipe the caller's homebrew — everything, one kind, or one imported book.
// Invalidates every rules shelf plus the impact preview and the book shelf.
export function useResetHomebrew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (scope?: { kind?: RulesKind; book?: string }) => {
      const query: { kind?: RulesKind; book?: string } = {};
      if (scope?.kind) query.kind = scope.kind;
      if (scope?.book) query.book = scope.book;
      const { data, error } = await api.DELETE("/rules/homebrew", {
        params: Object.keys(query).length ? { query } : {},
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] });
      qc.invalidateQueries({ queryKey: ["homebrew-impact"] });
      qc.invalidateQueries({ queryKey: ["homebrew-books"] });
    },
  });
}
