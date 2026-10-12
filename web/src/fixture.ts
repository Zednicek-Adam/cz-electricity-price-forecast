/**
 * A five-day record the seam-4 tests hand the dashboard, typed by `Dashboard`.
 * The headline model's worst and best days differ by metric, so a navigator
 * that ignores the selected metric lands wrong. A variant carries a pending
 * day after them.
 */
import type { Dashboard, Day, Figures, Metric, ModelSlug } from "./types.ts";

export const DAYS = [
  "2024-12-27",
  "2024-12-28",
  "2024-12-29",
  "2024-12-30",
  "2024-12-31",
];

/** The day after the record, forecast and not yet published. */
export const PENDING_DAY = "2025-01-01";

/** chronos2's published figure per day, per metric. */
export const DAILY: Record<Metric, number[]> = {
  // worst 2024-12-28, best 2024-12-29
  mae: [10, 40, 5, 20, 15],
  rmse: [12, 44, 6, 22, 17],
  smape: [9, 30, 4, 12, 11],
  // worst 2024-12-30, best 2024-12-27
  rmae: [0.2, 0.8, 0.5, 1.4, 0.6],
};

const MODELS: ModelSlug[] = ["chronos2", "ar168", "daylag"];
const hours = Array.from({ length: 24 }, (_, i) => i);

function forecasts(base: number): Day["forecasts"] {
  return {
    chronos2: hours.map((h) => base + 2 + h),
    ar168: hours.map((h) => base + 5 + h),
    daylag: hours.map((h) => base + 10.5 + h),
  };
}

function day(i: number): Day {
  const base = 50 + 10 * i;
  const figure = (m: Metric) => DAILY[m][i] ?? null;
  return {
    // Period ordinal 14 of the last day cleared negative.
    observed: hours.map((h) => (i === 4 && h === 13 ? -138.75 : base + h)),
    forecasts: forecasts(base),
    metrics: {
      chronos2: {
        mae: figure("mae"),
        rmse: figure("rmse"),
        smape: figure("smape"),
        rmae: figure("rmae"),
      },
      ar168: { mae: 15.05, rmse: 22.5, smape: 21.25, rmae: 0.7525 },
      daylag: { mae: 20, rmse: 30, smape: 25, rmae: 1 },
    },
  };
}

/** The running series spans a new year, so the Over time view has a year line. */
const RUNNING_DAYS = [
  "2023-12-30",
  "2023-12-31",
  "2024-01-01",
  "2024-01-02",
  "2024-01-03",
];

function running(metric: Metric): Record<ModelSlug, number[]> {
  const scale = metric === "rmae" ? 0.01 : 1;
  const series = (k: number) =>
    RUNNING_DAYS.map((_, i) => (10 + k * 5 + i) * scale);
  return { chronos2: series(0), ar168: series(1), daylag: series(2) };
}

/** The trailing series has no figure until a whole window fits. */
function trailing(metric: Metric): Record<ModelSlug, (number | null)[]> {
  const scale = metric === "rmae" ? 0.01 : 1;
  const series = (k: number) =>
    RUNNING_DAYS.map((_, i) => (i < 2 ? null : (30 + k * 5 - i) * scale));
  return { chronos2: series(0), ar168: series(1), daylag: series(2) };
}

const WHOLE: Record<ModelSlug, Figures> = {
  chronos2: { mae: 16.64, rmse: 30.1, smape: 20.2, rmae: 0.638 },
  ar168: { mae: 20.114, rmse: 34.2, smape: 23.8, rmae: 0.77115 },
  daylag: { mae: 26.083, rmse: 44.8, smape: 32.0, rmae: 1 },
};

/** The last 30 days: AR-168 leads here, unlike over the whole record. */
const WINDOW: Record<ModelSlug, Figures> = {
  chronos2: { mae: 31.77, rmse: 44.7, smape: 29.7, rmae: 0.669 },
  ar168: { mae: 30.2, rmse: 43.1, smape: 28.4, rmae: 0.636 },
  daylag: { mae: 47.5, rmse: 64.0, smape: 42.9, rmae: 1 },
};

function comparisons(
  model: ModelSlug,
  sign = 1,
): Partial<Record<ModelSlug, (number | null)[]>> {
  return Object.fromEntries(
    MODELS.filter((o) => o !== model).map((opponent, k) => [
      opponent,
      hours.map((h) => (h === 23 ? null : sign * (-1 - k - h / 10))),
    ]),
  );
}

export const DASHBOARD: Dashboard = {
  record: { first: DAYS[0] as string, last: "2024-12-31", pending: null },
  models: MODELS,
  days: Object.fromEntries(DAYS.map((date, i) => [date, day(i)])),
  running: {
    dates: RUNNING_DAYS,
    mae: running("mae"),
    rmse: running("rmse"),
    smape: running("smape"),
    rmae: running("rmae"),
  },
  trailing: {
    mae: trailing("mae"),
    rmse: trailing("rmse"),
    smape: trailing("smape"),
    rmae: trailing("rmae"),
  },
  window: { days: 30, first: "2023-12-05", last: "2024-01-03" },
  accuracy: { whole: WHOLE, window: WINDOW },
  comparisons: {
    whole: {
      chronos2: comparisons("chronos2"),
      ar168: comparisons("ar168"),
      daylag: comparisons("daylag"),
    },
    window: {
      chronos2: comparisons("chronos2", -1),
      ar168: comparisons("ar168", -1),
      daylag: comparisons("daylag", -1),
    },
  },
};

export const DASHBOARD_WITH_PENDING: Dashboard = {
  ...DASHBOARD,
  record: { ...DASHBOARD.record, last: PENDING_DAY, pending: PENDING_DAY },
  days: {
    ...DASHBOARD.days,
    [PENDING_DAY]: { observed: null, forecasts: forecasts(90), metrics: {} },
  },
};
