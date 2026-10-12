/**
 * The shapes of the files under `/data/`, which `forecast.export` writes at
 * deploy time (ADR-0016). The export is the only producer and the dashboard
 * the only reader; the two are kept in step by hand, and the seam-4 fixture
 * (`fixture.ts`) is typed by this module.
 *
 * Every price is EUR/MWh, as the market publishes it, at every layer: nothing
 * here or behind it converts a currency (ADR-0008).
 */

/** The three models of ADR-0003, as the record names them. */
export type ModelSlug = "chronos2" | "ar168" | "daylag";

/** A delivery day, `YYYY-MM-DD`: a calendar day in `Europe/Prague`. */
export type DeliveryDate = string;

/** One model's 24 forecasts for a delivery day, EUR/MWh. */
export interface ModelForecast {
  model: ModelSlug;
  /** Indexed by period ordinal minus one, on the repaired 24-period grid. */
  prices: number[];
}

/**
 * `/data/record.json` — the record's extent: every delivery day from `first`
 * to `last` has a Day view file. `pending` is the one delivery day with
 * forecasts and no published price yet, or null (CONTEXT.md).
 */
export interface RecordResponse {
  first: DeliveryDate;
  last: DeliveryDate;
  pending: DeliveryDate | null;
}

/**
 * `/data/days/<delivery date>.json` — the Day view: the repaired observed
 * price and every model's forecasts over the 24 period ordinals of one
 * delivery day. A daylight-saving day is on the repaired grid like any other
 * (ADR-0006).
 */
export interface DeliveryDayResponse {
  deliveryDate: DeliveryDate;
  /**
   * Repaired observed prices, EUR/MWh, indexed by period ordinal minus one;
   * null on the pending day, whose price is not published yet.
   */
  observed: number[] | null;
  forecasts: ModelForecast[];
  /**
   * Each model's published metrics for this delivery day: the headline
   * numbers of the Day view. Read, never computed in the client (ADR-0004).
   * Empty on the pending day.
   */
  metrics: ModelMetrics[];
}

/** One model's four published metrics over one scope. `null` where the
 * figure is undefined and was not published. */
export interface ModelMetrics {
  model: ModelSlug;
  mae: number | null;
  rmse: number | null;
  smape: number | null;
  rmae: number | null;
}

/** The four published metrics, as the metric selector names them. */
export type Metric = "mae" | "rmse" | "smape" | "rmae";

/** One model's figures, aligned with a response's `deliveryDates`. */
export interface MetricSeries {
  model: ModelSlug;
  /** `null` before the model's first scored day, or where the figure is undefined. */
  values: (number | null)[];
}

/**
 * `/data/running/<metric>.json` — the Over time view: the running metric for
 * every model across every scored delivery day of the record (ADR-0007): a
 * cumulative sum over a cumulative count of delivery periods, and for rMAE the
 * ratio of two running MAEs, never a running mean of per-day ratios.
 */
export interface RunningMetricResponse {
  metric: Metric;
  deliveryDates: DeliveryDate[];
  series: MetricSeries[];
}

/**
 * `/data/daily/<metric>.json` — the ribbon, and the worst / best / random day:
 * the headline model's published metric on each scored delivery day. A
 * different series from the running one.
 */
export interface DailyMetricResponse {
  model: ModelSlug;
  metric: Metric;
  deliveryDates: DeliveryDate[];
  values: number[];
}

/** One model's row of the accuracy table: the whole record, every metric.
 * The day-lag naïve's own row reads rMAE exactly 1. */
export type AccuracyRow = ModelMetrics;

/** `/data/accuracy.json` — the accuracy table: every model × four metrics. */
export interface AccuracyResponse {
  rows: AccuracyRow[];
}

/** Diebold-Mariano tests of one model against one opponent. */
export interface Opponent {
  opponent: ModelSlug;
  /**
   * Indexed by period ordinal minus one. H1 is that the selected model is more
   * accurate than the opponent, on absolute loss; `null` where the test could
   * not be computed.
   */
  dmStatistic: (number | null)[];
  pValue: (number | null)[];
}

/**
 * `/data/comparisons/<model>.json` — the Diebold-Mariano card: a model against
 * each opponent, by period ordinal. The tests are on absolute loss, so they
 * rank what MAE ranks, whatever metric the page shows (ADR-0005).
 */
export interface ComparisonResponse {
  model: ModelSlug;
  opponents: Opponent[];
}
