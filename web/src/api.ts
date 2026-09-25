/**
 * The client's only way to the data: one GET per view, typed by the API's own
 * contract (`@cz-epf/api`), imported across the workspace with nothing
 * generated.
 *
 * Each view fetches once, when it is shown. Nothing polls and nothing
 * refreshes on a timer: previews read production Neon, so a tab left open
 * must cost nothing (ADR-0010).
 */
import type {
  AccuracyResponse,
  ComparisonResponse,
  DailyMetricResponse,
  DeliveryDayResponse,
  RunningMetricResponse,
} from "@cz-epf/api";

/** What each view receives. */
export interface ViewPayloads {
  day: DeliveryDayResponse;
  overTime: RunningMetricResponse;
  ribbon: DailyMetricResponse;
  accuracyTable: AccuracyResponse;
  dieboldMariano: ComparisonResponse;
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${path}: ${response.status}`);
  }
  return (await response.json()) as T;
}
