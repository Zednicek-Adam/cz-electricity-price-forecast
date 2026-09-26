/**
 * A five-day record the seam-4 tests serve through a stubbed `fetch`, shaped
 * by the API's own types. The headline model's worst and best days differ by
 * metric, so a navigator that ignores the selected metric lands wrong.
 */
import type {
  AccuracyResponse,
  ComparisonResponse,
  DailyMetricResponse,
  DeliveryDayResponse,
  Metric,
  ModelSlug,
  RunningMetricResponse,
} from "@cz-epf/api";

export const DAYS = [
  "2024-12-27",
  "2024-12-28",
  "2024-12-29",
  "2024-12-30",
  "2024-12-31",
];

/** chronos2's published figure per day, per metric. */
export const DAILY: Record<Metric, number[]> = {
  // worst 2024-12-28, best 2024-12-29
  mae: [10, 40, 5, 20, 15],
  rmse: [12, 44, 6, 22, 17],
  smape: [9, 30, 4, 12, 11],
  // worst 2024-12-30, best 2024-12-27
  rmae: [0.2, 0.8, 0.5, 1.4, 0.6],
};

const hours = Array.from({ length: 24 }, (_, i) => i);

export function dayPayload(day: string): DeliveryDayResponse {
  const i = DAYS.indexOf(day);
  const base = 50 + 10 * i;
  const figure = (m: Metric) => DAILY[m][i] ?? null;
  return {
    deliveryDate: day,
    // Period ordinal 14 of the last day cleared negative.
    observed: hours.map((h) =>
      day === "2024-12-31" && h === 13 ? -138.75 : base + h,
    ),
    forecasts: [
      { model: "chronos2", prices: hours.map((h) => base + 2 + h) },
      { model: "ar168", prices: hours.map((h) => base + 5 + h) },
      { model: "daylag", prices: hours.map((h) => base + 10.5 + h) },
    ],
    metrics: [
      {
        model: "chronos2",
        mae: figure("mae"),
        rmse: figure("rmse"),
        smape: figure("smape"),
        rmae: figure("rmae"),
      },
      { model: "ar168", mae: 15.05, rmse: 22.5, smape: 21.25, rmae: 0.7525 },
      { model: "daylag", mae: 20, rmse: 30, smape: 25, rmae: 1 },
    ],
  };
}

export function dailyPayload(metric: Metric): DailyMetricResponse {
  return {
    model: "chronos2",
    metric,
    deliveryDates: DAYS,
    values: DAILY[metric],
  };
}

/** The running series spans a new year, so the Over time view has a year line. */
export const RUNNING_DAYS = [
  "2023-12-30",
  "2023-12-31",
  "2024-01-01",
  "2024-01-02",
  "2024-01-03",
];

export function runningPayload(metric: Metric): RunningMetricResponse {
  const scale = metric === "rmae" ? 0.01 : 1;
  return {
    metric,
    deliveryDates: RUNNING_DAYS,
    series: (["chronos2", "ar168", "daylag"] as const).map((model, k) => ({
      model,
      values: RUNNING_DAYS.map((_, i) => (10 + k * 5 + i) * scale),
    })),
  };
}

export const ACCURACY: AccuracyResponse = {
  rows: [
    { model: "chronos2", mae: 16.64, rmse: 30.1, smape: 20.2, rmae: 0.638 },
    { model: "ar168", mae: 20.114, rmse: 34.2, smape: 23.8, rmae: 0.77115 },
    { model: "daylag", mae: 26.083, rmse: 44.8, smape: 32.0, rmae: 1 },
  ],
};

export function comparisonPayload(model: ModelSlug): ComparisonResponse {
  return {
    model,
    opponents: (["chronos2", "ar168", "daylag"] as const)
      .filter((o) => o !== model)
      .map((opponent, k) => ({
        opponent,
        dmStatistic: hours.map((h) => (h === 23 ? null : -1 - k - h / 10)),
        pValue: hours.map((h) => (h === 23 ? null : 0.01)),
      })),
  };
}

/** What the stubbed network answers for a path, or undefined for a 404. */
export function payloadFor(path: string): unknown {
  const [, , kind, arg] = path.split("/");
  if (kind === "days" && arg && DAYS.includes(arg)) return dayPayload(arg);
  if (kind === "daily" && arg) return dailyPayload(arg as Metric);
  if (kind === "running" && arg) return runningPayload(arg as Metric);
  if (kind === "accuracy") return ACCURACY;
  if (kind === "comparisons" && arg) return comparisonPayload(arg as ModelSlug);
  return undefined;
}
