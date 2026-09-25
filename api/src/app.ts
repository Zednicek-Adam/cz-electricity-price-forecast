/**
 * The read API: Hono on a Cloudflare Worker (ADR-0004).
 *
 * Screen-shaped and read-only. An endpoint exists because a view needs it
 * (ADR-0007), and the request path selects rows the replay already wrote; the
 * running metric is the one thing it derives (ADR-0015). There is no write
 * path, and the credential it holds could not use one.
 *
 * | Endpoint                     | View                                    |
 * |------------------------------|-----------------------------------------|
 * | `GET /days/:deliveryDate`    | the Day view                            |
 * | `GET /running/:metric`       | the Over time view                      |
 * | `GET /daily/:metric`         | the ribbon, and worst / best / random   |
 * | `GET /accuracy`              | the accuracy table                      |
 * | `GET /comparisons/:model`    | the Diebold-Mariano card                |
 *
 * Every figure is a backtest: v1 has no live forecasts, and the two are never
 * pooled (ADR-0002).
 *
 * Bad data fails loudly. A delivery day the record does not hold is a 404; a
 * day it holds only in part — a model short of 24 period ordinals, a slug that
 * is not on the roster, observed prices missing — is a 500, because the store
 * is broken and a short or reordered array would chart as if it were not.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type {
  ForecastRow,
  ModelComparisonRow,
  PublishedMetricRow,
  RepairedObservedPriceRow,
} from "./db.generated.ts";
import { connect, type Sql } from "./db.ts";
import type {
  AccuracyResponse,
  AccuracyRow,
  BadRequestResponse,
  ComparisonResponse,
  DailyMetricResponse,
  DeliveryDayResponse,
  Metric,
  MetricSeries,
  ModelForecast,
  ModelSlug,
  NotInRecordResponse,
  Opponent,
  RecordExtent,
  RunningMetricResponse,
} from "./index.ts";
import { type DayFigure, running, runningRatio } from "./running.ts";

export interface Bindings {
  /** The Postgres URL of Neon's reader role; locally, any role that can read. */
  NEON_READER: string;
}

export const PERIODS = 24;
export const RESOLUTION_MINUTES = 60;
/** The roster (CONTEXT.md), in the order the dashboard lists it. */
export const ROSTER: readonly ModelSlug[] = ["chronos2", "ar168", "daylag"];
/** The model the dashboard leads with: configuration, frozen (ADR-0003). */
export const HEADLINE_MODEL: ModelSlug = "chronos2";
/** What rMAE divides by. */
const NAIVE: ModelSlug = "daylag";
const METRICS: readonly Metric[] = ["mae", "rmse", "smape", "rmae"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Env = { Bindings: Bindings; Variables: { sql: Sql } };

export const app = new Hono<Env>().basePath("/api");

app.use(async (c, next) => {
  const sql = connect(c.env.NEON_READER);
  c.set("sql", sql);
  try {
    await next();
  } finally {
    // In a Worker the connection closes after the response is sent; the
    // tests call the app with no execution context, so they wait for it.
    const closed = sql.end({ timeout: 1 });
    try {
      c.executionCtx.waitUntil(closed);
    } catch {
      await closed;
    }
  }
});

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  console.error(error);
  return c.json({ error: "internal", message: error.message }, 500);
});

function isDeliveryDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

function isModelSlug(value: string): value is ModelSlug {
  return (ROSTER as readonly string[]).includes(value);
}

function rosterModel(value: string): ModelSlug {
  if (!isModelSlug(value)) throw new Error(`${value} is not on the roster`);
  return value;
}

function isMetric(value: string): value is Metric {
  return (METRICS as readonly string[]).includes(value);
}

function badRequest(message: string): BadRequestResponse {
  return { error: "bad_request", message };
}

function byRoster<T>(items: T[], model: (item: T) => ModelSlug): T[] {
  return items.sort(
    (a, b) => ROSTER.indexOf(model(a)) - ROSTER.indexOf(model(b)),
  );
}

/** Append to the list a map holds under `key`. */
function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

/** The first and last delivery days the backtest covers. */
async function recordExtent(sql: Sql): Promise<RecordExtent | null> {
  const [row] = await sql<{ first: string | null; last: string | null }[]>`
    SELECT min(delivery_date) AS first, max(delivery_date) AS last
    FROM forecast WHERE run_type = 'backtest'
  `;
  return row?.first && row.last ? { first: row.first, last: row.last } : null;
}

/** 24 prices indexed by period ordinal minus one, or an error naming the gap. */
function onTheGrid(
  what: string,
  rows: { period_ordinal: number; price: string }[],
): number[] {
  const ordinals = rows.map((r) => r.period_ordinal).join(",");
  const expected = Array.from({ length: PERIODS }, (_, i) => i + 1).join(",");
  if (ordinals !== expected) {
    throw new Error(`${what}: period ordinals ${ordinals}, expected 1..24`);
  }
  return rows.map((r) => Number(r.price));
}

/** Every model's per-day published metric, grouped by model, date-ordered. */
async function dayFigures(
  sql: Sql,
  metric: Metric,
): Promise<Map<ModelSlug, DayFigure[]>> {
  const rows = await sql<
    Pick<
      PublishedMetricRow,
      "model" | "scope_start" | "value" | "n_forecasts"
    >[]
  >`
    SELECT model, scope_start, value, n_forecasts FROM published_metric
    WHERE run_type = 'backtest' AND scope_type = 'delivery_day'
      AND metric = ${metric}
    ORDER BY scope_start
  `;
  const byModel = new Map<ModelSlug, DayFigure[]>();
  for (const row of rows) {
    push(byModel, rosterModel(row.model), {
      deliveryDate: row.scope_start,
      value: Number(row.value),
      nForecasts: row.n_forecasts,
    });
  }
  return byModel;
}

app.get("/days/:deliveryDate", async (c) => {
  const deliveryDate = c.req.param("deliveryDate");
  if (!isDeliveryDate(deliveryDate)) {
    return c.json(
      badRequest(`not a delivery day (YYYY-MM-DD): ${deliveryDate}`),
      400,
    );
  }
  const sql = c.get("sql");

  const rows = await sql<
    Pick<ForecastRow, "model" | "period_ordinal" | "price">[]
  >`
    SELECT model, period_ordinal, price FROM forecast
    WHERE delivery_date = ${deliveryDate}
      AND resolution_minutes = ${RESOLUTION_MINUTES}
      AND run_type = 'backtest'
    ORDER BY model, period_ordinal
  `;
  if (rows.length === 0) {
    return c.json<NotInRecordResponse>(
      {
        error: "not_in_record",
        deliveryDate,
        record: await recordExtent(sql),
      },
      404,
    );
  }
  const observed = await sql<
    Pick<RepairedObservedPriceRow, "period_ordinal" | "price">[]
  >`
    SELECT period_ordinal, price FROM repaired_observed_price
    WHERE delivery_date = ${deliveryDate}
      AND resolution_minutes = ${RESOLUTION_MINUTES}
    ORDER BY period_ordinal
  `;

  const byModel = new Map<ModelSlug, (typeof rows)[number][]>();
  for (const row of rows) push(byModel, rosterModel(row.model), row);
  const forecasts: ModelForecast[] = [...byModel].map(([model, modelRows]) => ({
    model,
    prices: onTheGrid(`${deliveryDate} ${model}`, modelRows),
  }));

  return c.json<DeliveryDayResponse>({
    deliveryDate,
    observed: onTheGrid(`${deliveryDate} observed`, observed),
    forecasts: byRoster(forecasts, (f) => f.model),
  });
});

app.get("/running/:metric", async (c) => {
  const metric = c.req.param("metric");
  if (!isMetric(metric)) {
    return c.json(badRequest(`not a metric: ${metric}`), 400);
  }

  // Running rMAE is built from the MAE rows, never from the per-day rMAEs.
  const figures = await dayFigures(
    c.get("sql"),
    metric === "rmae" ? "mae" : metric,
  );
  const deliveryDates = [
    ...new Set([...figures.values()].flat().map((f) => f.deliveryDate)),
  ].sort();

  const series: MetricSeries[] = [...figures].map(([model, modelFigures]) => ({
    model,
    values:
      metric === "rmae"
        ? runningRatio(deliveryDates, modelFigures, figures.get(NAIVE) ?? [])
        : running(metric, deliveryDates, modelFigures),
  }));
  return c.json<RunningMetricResponse>({
    metric,
    deliveryDates,
    series: byRoster(series, (s) => s.model),
  });
});

app.get("/daily/:metric", async (c) => {
  const metric = c.req.param("metric");
  if (!isMetric(metric)) {
    return c.json(badRequest(`not a metric: ${metric}`), 400);
  }
  const figures =
    (await dayFigures(c.get("sql"), metric)).get(HEADLINE_MODEL) ?? [];
  return c.json<DailyMetricResponse>({
    model: HEADLINE_MODEL,
    metric,
    deliveryDates: figures.map((f) => f.deliveryDate),
    values: figures.map((f) => f.value),
  });
});

app.get("/accuracy", async (c) => {
  const rows = await c.get("sql")<
    Pick<PublishedMetricRow, "model" | "metric" | "value">[]
  >`
    SELECT model, metric, value FROM published_metric
    WHERE run_type = 'backtest' AND scope_type = 'overall'
  `;
  const table = new Map<ModelSlug, AccuracyRow>();
  for (const row of rows) {
    const model = rosterModel(row.model);
    if (!isMetric(row.metric)) continue;
    const entry = table.get(model) ?? {
      model,
      mae: null,
      rmse: null,
      smape: null,
      rmae: null,
    };
    entry[row.metric] = Number(row.value);
    table.set(model, entry);
  }
  return c.json<AccuracyResponse>({
    rows: byRoster([...table.values()], (r) => r.model),
  });
});

app.get("/comparisons/:model", async (c) => {
  const model = c.req.param("model");
  if (!isModelSlug(model)) {
    return c.json(badRequest(`not a model on the roster: ${model}`), 400);
  }
  const rows = await c.get("sql")<
    Pick<
      ModelComparisonRow,
      "model_b" | "period_ordinal" | "dm_statistic" | "p_value"
    >[]
  >`
    SELECT model_b, period_ordinal, dm_statistic, p_value
    FROM model_comparison
    WHERE model_a = ${model} AND run_type = 'backtest'
      AND resolution_minutes = ${RESOLUTION_MINUTES}
  `;
  const opponents = new Map<ModelSlug, Opponent>();
  for (const row of rows) {
    const opponent = rosterModel(row.model_b);
    const entry = opponents.get(opponent) ?? {
      opponent,
      dmStatistic: Array<number | null>(PERIODS).fill(null),
      pValue: Array<number | null>(PERIODS).fill(null),
    };
    entry.dmStatistic[row.period_ordinal - 1] = Number(row.dm_statistic);
    entry.pValue[row.period_ordinal - 1] = Number(row.p_value);
    opponents.set(opponent, entry);
  }
  return c.json<ComparisonResponse>({
    model,
    opponents: byRoster([...opponents.values()], (o) => o.opponent),
  });
});
