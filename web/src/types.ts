/**
 * `Dashboard` is the shape of `/dashboard.json`, the one file the page loads,
 * which `forecast.export` writes at deploy time (ADR-0016). The export is its
 * only producer and this module its only description; the two are kept in step
 * by hand, and the seam-4 fixture (`fixture.ts`) is typed by it.
 *
 * The other types are what the components draw, which `dashboard.ts` selects
 * out of it.
 *
 * Every price is EUR/MWh, as the market publishes it, at every layer: nothing
 * here or behind it converts a currency (ADR-0008).
 */

/** The three models of ADR-0003, as the record names them. */
export type ModelSlug = "chronos2" | "ar168" | "daylag";

/** A delivery day, `YYYY-MM-DD`: a calendar day in `Europe/Prague`. */
export type DeliveryDate = string;

/** The four published metrics, as the metric selector names them. */
export type Metric = "mae" | "rmse" | "smape" | "rmae";

/** A model's four metrics over one scope; `null` where a figure is undefined. */
export type Figures = Record<Metric, number | null>;

/** The two scopes the scoreboard reads: the whole record, or the trailing
 * window of its last 30 scored delivery days (ADR-0017). */
export type Scope = "whole" | "window";

/** The three the hero chart's history switch reads: a scope, or the week of
 * the last 7 scored delivery days (ADR-0018). */
export type History = Scope | "week";

/** The two trailing spans: the window and the week. */
export type Trailing = Exclude<History, "whole">;

/** The last `days` calendar delivery days up to the last scored one. */
export interface Span {
  days: number;
  first: DeliveryDate;
  last: DeliveryDate;
}

/** What a profile groups the whole record's delivery periods by (ADR-0018):
 * the weekday of their delivery day, or their period ordinal. */
export type Profile = "weekday" | "period";

/** Per metric, each model's figures, aligned with `running.dates` or with a
 * profile's buckets. */
export type MetricSeriesByModel = Record<
  Metric,
  Partial<Record<ModelSlug, (number | null)[]>>
>;

/** The statistics a price distribution is summarised by (ADR-0019): its mean,
 * and its minimum, 10th, 25th, 50th, 75th and 90th percentiles and maximum. */
export type PriceStatistic =
  "mean" | "min" | "p10" | "q1" | "median" | "q3" | "p90" | "max";

/** Per statistic, the observed price's distribution, EUR/MWh, over each of a
 * list of sets of delivery periods; `null` where a set is empty. */
export type PriceDistribution = Record<PriceStatistic, (number | null)[]>;

export interface Dashboard {
  /** Every delivery day from `first` to `last` is in `days`. `pending` is the
   * one delivery day with forecasts and no published price yet, or null. */
  record: {
    first: DeliveryDate;
    last: DeliveryDate;
    pending: DeliveryDate | null;
  };
  /** The models in the record, in the order the dashboard lists them. */
  models: ModelSlug[];
  days: Record<DeliveryDate, Day>;
  /** The running metric on every scored delivery day (ADR-0007): a
   * cumulative sum over a cumulative count of delivery periods, and for rMAE
   * the ratio of two running MAEs. Each model's values are aligned with
   * `dates`, `null` before its first scored day. */
  running: { dates: DeliveryDate[] } & MetricSeriesByModel;
  /** Per trailing span, the trailing metric on the same days (ADR-0017): each
   * figure covers the span's `days` calendar delivery days ending on that
   * day, `null` until a whole span fits inside the record. */
  trailing: Record<Trailing, MetricSeriesByModel>;
  /** The last 30 days: the `window` of every keyed record here. */
  window: Span;
  /** The last 7 days: the `week` of every keyed record here. */
  week: Span;
  /** Per history and profile, each model's figures in each bucket: the seven
   * weekdays from Monday, or the 24 period ordinals from 1. `null` where a
   * model has no figure in a bucket. */
  profiles: Record<History, Record<Profile, MetricSeriesByModel>>;
  /** Per history, each model's four metrics. */
  accuracy: Record<History, Partial<Record<ModelSlug, Figures>>>;
  /** The observed price's distribution over the cuts the metrics take
   * (ADR-0019): each scored delivery day's own periods, aligned with
   * `running.dates`; per trailing span, the span ending on each of those
   * days, `null` until a whole span fits; and per history and profile, each
   * bucket. */
  prices: {
    daily: PriceDistribution;
    trailing: Record<Trailing, PriceDistribution>;
    profiles: Record<History, Record<Profile, PriceDistribution>>;
  };
  /** Per scope, each model's Diebold–Mariano statistic against each
   * opponent, by period ordinal minus one; `null` where the test could not be
   * computed. */
  comparisons: Record<
    Scope,
    Partial<Record<ModelSlug, Partial<Record<ModelSlug, (number | null)[]>>>>
  >;
}

/** One delivery day of the record. */
export interface Day {
  /** Repaired observed prices, indexed by period ordinal minus one; null on
   * the pending day, whose price is not published yet. */
  observed: number[] | null;
  /** Each model's 24 forecasts, on the repaired grid. */
  forecasts: Partial<Record<ModelSlug, number[]>>;
  /** Each model's four metrics for the day; empty on the pending day. */
  metrics: Partial<Record<ModelSlug, Figures>>;
}

/** One model's figures, in a list that keeps the dashboard's model order. */
export type ModelMetrics = Figures & { model: ModelSlug };

/** One model's 24 forecasts for a delivery day, EUR/MWh. */
export interface ModelForecast {
  model: ModelSlug;
  prices: number[];
}

/** The Day view: one delivery day's observed price and every model's
 * forecasts over 24 period ordinals. A daylight-saving day is on the repaired
 * grid like any other (ADR-0006). */
export interface DeliveryDay {
  deliveryDate: DeliveryDate;
  observed: number[] | null;
  forecasts: ModelForecast[];
  metrics: ModelMetrics[];
}

/** The ribbon, and the worst / best / random day: the headline model's
 * metric on each scored delivery day. */
export interface DailyMetric {
  model: ModelSlug;
  metric: Metric;
  deliveryDates: DeliveryDate[];
  values: number[];
}

/** One model's running or trailing figures, aligned with
 * `MetricOverTime.deliveryDates`, or its figures in a profile's buckets. */
export interface MetricSeries {
  model: ModelSlug;
  values: (number | null)[];
}

/** The Over time view: every model's running or trailing metric
 * on every scored delivery day. */
export interface MetricOverTime {
  kind: "running" | "trailing";
  /** The trailing span's length in days; null for the running metric. */
  days: number | null;
  metric: Metric;
  deliveryDates: DeliveryDate[];
  series: MetricSeries[];
}

/** The By weekday and By hour views: every model's figure in each of a
 * profile's buckets, over the scope's days. */
export interface MetricProfile {
  by: Profile;
  scope: History;
  metric: Metric;
  series: MetricSeries[];
}

/** The price chart's Over time view: on every scored delivery day, the
 * distribution of that day's own prices, or of the trailing span ending on
 * it. */
export interface PriceOverTime {
  kind: "daily" | "trailing";
  /** The trailing span's length in days; null for the daily distribution. */
  days: number | null;
  deliveryDates: DeliveryDate[];
  distribution: PriceDistribution;
}

/** The price chart's By weekday and By hour views: the distribution of the
 * prices in each of a profile's buckets, over the history's days. */
export interface PriceProfile {
  by: Profile;
  history: History;
  distribution: PriceDistribution;
}

/** The Diebold–Mariano card: one model against each opponent. H1 is that the
 * selected model is more accurate, on absolute loss (ADR-0005). */
export interface Comparison {
  model: ModelSlug;
  scope: Scope;
  opponents: { opponent: ModelSlug; dmStatistic: (number | null)[] }[];
}
