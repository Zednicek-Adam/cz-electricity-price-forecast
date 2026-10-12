import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // `public/data/` is the export's output: run `uv run python -m
  // forecast.export` in forecast/ before `pnpm dev`.
  plugins: [react()],
  test: {
    environment: "jsdom",
  },
});
