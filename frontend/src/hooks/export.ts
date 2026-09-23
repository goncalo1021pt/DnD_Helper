/*
 * Everything you own, as one document (#317). Not a query — nobody keeps a
 * whole export in cache — but a mutation-shaped action so the button has a
 * pending state and a failure is said out loud like any other.
 */

import { useMutation } from "@tanstack/react-query";
import { api } from "../api/client";

export function useDownloadMyData() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await api.GET("/me/export");
      if (error) throw error;
      const stamp = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `questboard-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return data!;
    },
  });
}
