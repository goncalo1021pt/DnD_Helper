/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In dev, Vite serves the SPA on :5173 and proxies /api to the Go server on
// :8080 so cookies stay same-origin from the browser's perspective.
// In production the built assets are embedded into the Go binary instead.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // A regex key, not the "/api" prefix: a prefix also swallows
    // /api-docs.html, the API reference's dev page, and proxies it to Go.
    proxy: {
      "^/api(/|$)": {
        target: "http://localhost:8080",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Two pages: the SPA, and the API reference (#348) — a page of its own so
    // the app's load pays nothing for the viewer. The Go router serves
    // dist/api-docs.html at /api/docs; in dev, open /api-docs.html on :5173.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        "api-docs": fileURLToPath(new URL("./api-docs.html", import.meta.url)),
      },
    },
  },
  // Unit tests (#125). Node environment on purpose: what is worth testing here
  // is the pure derivation — sheet values, spell slots, progression — and none
  // of it touches the DOM. Journeys are Playwright's job, in e2e/.
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
