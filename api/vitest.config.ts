import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Seam 3: the app against a real, seeded Postgres. The fixture is written
    // once for the whole run and removed afterwards; every test only reads.
    globalSetup: ["test/fixture.ts"],
  },
});
