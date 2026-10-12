/**
 * The page's data: `/dashboard.json`, fetched once before the first render
 * (ADR-0016), and the pure functions that select what each view draws out of
 * it. Nothing here computes a metric: every figure arrives computed.
 */
import type {
  Comparison,
  DailyMetric,
  Dashboard,
  DeliveryDate,
  DeliveryDay,
  Figures,
  History,
  Metric,
  ModelMetrics,
  MetricOverTime,
  MetricProfile,
  ModelSlug,
  Profile,
  Scope,
} from "./types.ts";

/** The model the dashboard leads with: configuration, frozen (ADR-0003). */
export const HEADLINE_MODEL: ModelSlug = "chronos2";

export async function loadDashboard(): Promise<Dashboard> {
  const response = await fetch("/dashboard.json");
  if (!response.ok) throw new Error(`/dashboard.json: ${response.status}`);
  return (await response.json()) as Dashboard;
}

/** Each listed model that has figures, in the dashboard's order. */
function rows(
  models: ModelSlug[],
  figures: Partial<Record<ModelSlug, Figures>>,
): ModelMetrics[] {
  return models.flatMap((model) => {
    const f = figures[model];
    return f ? [{ model, ...f }] : [];
  });
}

export function deliveryDay(data: Dashboard, date: DeliveryDate): DeliveryDay {
  const day = data.days[date];
  if (!day) throw new Error(`${date} is not in the record`);
  return {
    deliveryDate: date,
    observed: day.observed,
    forecasts: data.models.flatMap((model) => {
      const prices = day.forecasts[model];
      return prices ? [{ model, prices }] : [];
    }),
    metrics: rows(data.models, day.metrics),
  };
}

export function dailyMetric(data: Dashboard, metric: Metric): DailyMetric {
  const deliveryDates: DeliveryDate[] = [];
  const values: number[] = [];
  for (const [date, day] of Object.entries(data.days)) {
    const value = day.metrics[HEADLINE_MODEL]?.[metric];
    if (value !== undefined && value !== null) {
      deliveryDates.push(date);
      values.push(value);
    }
  }
  return { model: HEADLINE_MODEL, metric, deliveryDates, values };
}

/** The Over time view's running metric, over the whole record, or its
 * trailing one, over the last 30 or 7 days. */
export function metricOverTime(
  data: Dashboard,
  history: History,
  metric: Metric,
): MetricOverTime {
  const running = history === "whole";
  const source = running ? data.running : data.trailing[history];
  return {
    kind: running ? "running" : "trailing",
    days: running ? null : data[history].days,
    metric,
    deliveryDates: data.running.dates,
    series: data.models.flatMap((model) => {
      const values = source[metric][model];
      return values ? [{ model, values }] : [];
    }),
  };
}

/** The By weekday or By hour view's figures, over the scope's days. */
export function metricProfile(
  data: Dashboard,
  by: Profile,
  scope: History,
  metric: Metric,
): MetricProfile {
  return {
    by,
    scope,
    metric,
    series: data.models.flatMap((model) => {
      const values = data.profiles[scope][by][metric][model];
      return values ? [{ model, values }] : [];
    }),
  };
}

export function accuracy(data: Dashboard, scope: History): ModelMetrics[] {
  return rows(data.models, data.accuracy[scope]);
}

export function comparison(
  data: Dashboard,
  model: ModelSlug,
  scope: Scope,
): Comparison {
  const against = data.comparisons[scope][model] ?? {};
  return {
    model,
    scope,
    opponents: data.models.flatMap((opponent) => {
      const dmStatistic = against[opponent];
      return dmStatistic ? [{ opponent, dmStatistic }] : [];
    }),
  };
}
