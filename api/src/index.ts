/**
 * The read API: screen-shaped, read-only endpoints over the store, run as a
 * Cloudflare Worker (ADR-0004).
 *
 * There is no Hono app yet. ADR-0013 puts the API in phase 2, after the store
 * and the runner, and ADR-0007's views are what specify its endpoints - so at
 * the scaffold stage this unit is the shared contract and nothing else.
 */

export type { MetricName, ModelSlug, RunType } from "./contract.ts";
