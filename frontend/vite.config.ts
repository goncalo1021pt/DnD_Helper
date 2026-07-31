/// <reference types="vitest/config" />
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
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  // Unit tests (#125). Node environment on purpose: what is worth testing here
  // is the pure derivation — sheet values, spell slots, progression — and none
  // of it touches the DOM. Journeys are Playwright's job, in e2e/.
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
