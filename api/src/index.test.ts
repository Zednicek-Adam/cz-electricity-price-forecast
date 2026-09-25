import { expectTypeOf, test } from "vitest";

import type { ModelSlug } from "./index.ts";

// A behaviour-free suite: it holds the seam open until phase 2 puts real
// endpoints behind it, and gives the pull request gate of ADR-0010 something
// to run.
test("the model roster is the three slugs CONTEXT.md fixes", () => {
  expectTypeOf<ModelSlug>().toEqualTypeOf<"chronos2" | "ar168" | "daylag">();
});
