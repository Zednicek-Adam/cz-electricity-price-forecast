/**
 * The API/client contract. `web/` imports these types from `@cz-epf/api`
 * rather than restating what the API returns, so there is nothing to generate
 * and nothing to keep in step by hand (ADR-0004). This module holds types only,
 * so importing it pulls no server code into the client.
 *
 * Every price is EUR/MWh, as the market publishes it, at every layer: nothing
 * here or behind it converts a currency (ADR-0008).
 */

/** The three models of ADR-0003, as they are written on a stored row. */
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
 * `GET /api/days/:deliveryDate` — the Day view: the repaired observed price and every
 * model's forecasts over the 24 period ordinals of one delivery day. A
 * daylight-saving day is on the repaired grid like any other (ADR-0006).
 */
export interface DeliveryDayResponse {
  deliveryDate: DeliveryDate;
  /** Repaired observed prices, EUR/MWh, indexed by period ordinal minus one. */
  observed: number[];
  forecasts: ModelForecast[];
  /**
   * Each model's published metrics for this delivery day, as stored: the
   * headline numbers of the Day view. Read, never computed here or in the
   * client (ADR-0004).
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

/** The first and last delivery days the backtest covers. */
export interface RecordExtent {
  first: DeliveryDate;
  last: DeliveryDate;
}

/** 404: the delivery day is not one the record holds. */
export interface NotInRecordResponse {
  error: "not_in_record";
  deliveryDate: DeliveryDate;
  /** The record's extent, or null while the store holds no forecasts. */
  record: RecordExtent | null;
}

/** 400: the request itself is malformed. */
export interface BadRequestResponse {
  error: "bad_request";
  message: string;
}

/** The four published metrics, as stored and as the metric selector names them. */
export type Metric = "mae" | "rmse" | "smape" | "rmae";

/** One model's figures, aligned with a response's `deliveryDates`. */
export interface MetricSeries {
  model: ModelSlug;
  /** `null` before the model's first scored day, or where the figure is undefined. */
  values: (number | null)[];
}

/**
 * `GET /api/running/:metric` — the Over time view: the running metric for
 * every model across every delivery day of the record (ADR-0007). Derived in
 * the Worker from the per-day published metrics (ADR-0015): a cumulative sum
 * over a cumulative count of delivery periods, and for rMAE the ratio of two
 * running MAEs, never a running mean of per-day ratios.
 */
export interface RunningMetricResponse {
  metric: Metric;
  deliveryDates: DeliveryDate[];
  series: MetricSeries[];
}

/**
 * `GET /api/daily/:metric` — the ribbon, and the worst / best / random day:
 * the headline model's published metric on each delivery day, as stored. A
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

/** `GET /api/accuracy` — the accuracy table: every model × four metrics. */
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
 * `GET /api/comparisons/:model` — the Diebold-Mariano card: a model against
 * each opponent, by period ordinal. The tests are on absolute loss, so they
 * rank what MAE ranks, whatever metric the page shows (ADR-0005).
 */
export interface ComparisonResponse {
  model: ModelSlug;
  opponents: Opponent[];
}
