import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    // `pnpm dev` here and `wrangler dev` in api/ side by side: the client's
    // requests to /api reach the local Worker.
    proxy: { "/api": "http://localhost:8787" },
  },
  test: {
    environment: "jsdom",
  },
});
