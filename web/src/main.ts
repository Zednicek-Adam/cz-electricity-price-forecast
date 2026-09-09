/**
 * The client: React on visx, built with Vite and served as static assets by
 * the same Worker (ADR-0004, ADR-0009).
 *
 * Nothing renders yet - ADR-0013 puts the client in phase 3, with the deploy
 * job and the README. This file exists to prove the one thing the scaffold
 * owes: that a type crosses the workspace boundary by import.
 */

import type { ModelSlug } from "@cz-epf/api";

/** The dashboard leads with univariate Chronos-2 (ADR-0003). */
export const headlineModel: ModelSlug = "chronos2";
