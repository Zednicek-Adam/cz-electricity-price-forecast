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
  Metric,
  ModelMetrics,
  ModelSlug,
  RunningMetric,
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

export function runningMetric(data: Dashboard, metric: Metric): RunningMetric {
  return {
    metric,
    deliveryDates: data.running.dates,
    series: data.models.flatMap((model) => {
      const values = data.running[metric][model];
      return values ? [{ model, values }] : [];
    }),
  };
}

export function accuracy(data: Dashboard): ModelMetrics[] {
  return rows(data.models, data.accuracy);
}

export function comparison(data: Dashboard, model: ModelSlug): Comparison {
  const against = data.comparisons[model] ?? {};
  return {
    model,
    opponents: data.models.flatMap((opponent) => {
      const dmStatistic = against[opponent];
      return dmStatistic ? [{ opponent, dmStatistic }] : [];
    }),
  };
}
