/**
 * The client: React on visx, built with Vite and served as static assets by
 * the same Worker (ADR-0004, ADR-0009).
 *
 * Nothing renders yet — ADR-0013 puts the client in phase 3, with the deploy
 * job and the README. What this file proves is the seam: the API's response
 * shapes cross the workspace boundary by import, with nothing generated.
 */

import type { DeliveryDayResponse, ModelSlug } from "@cz-epf/api";

/** The dashboard leads with univariate Chronos-2 (ADR-0003). */
export const headlineModel: ModelSlug = "chronos2";

/** The Day view's request, typed by the API's own contract. */
export async function fetchDeliveryDay(
  date: string,
): Promise<DeliveryDayResponse> {
  const response = await fetch(`/api/days/${date}`);
  return (await response.json()) as DeliveryDayResponse;
}
