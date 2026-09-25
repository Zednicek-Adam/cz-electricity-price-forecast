/**
 * The read API: Hono on a Cloudflare Worker (ADR-0004).
 *
 * Screen-shaped and read-only. An endpoint exists because a view needs it
 * (ADR-0007), and the request path selects rows the replay already wrote; the
 * running metric is the one thing it derives (ADR-0015). There is no write
 * path, and the credential it holds could not use one.
 *
 * Every figure is a backtest: v1 has no live forecasts, and the two are never
 * pooled (ADR-0002).
 */
import { Hono } from "hono";

import type { ForecastRow, RepairedObservedPriceRow } from "./db.generated.ts";
import { connect, type Sql } from "./db.ts";
import type {
  BadRequestResponse,
  DeliveryDayResponse,
  ModelForecast,
  ModelSlug,
  NotInRecordResponse,
  ReplayedRecord,
} from "./index.ts";

export interface Bindings {
  /** The Postgres URL of Neon's reader role; locally, any role that can read. */
  NEON_READER: string;
}

const PERIODS = 24;
const RESOLUTION_MINUTES = 60;
const ROSTER_ORDER: ModelSlug[] = ["chronos2", "ar168", "daylag"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Env = { Bindings: Bindings; Variables: { sql: Sql } };

export const app = new Hono<Env>().basePath("/api");

app.use(async (c, next) => {
  const sql = connect(c.env.NEON_READER);
  c.set("sql", sql);
  try {
    await next();
  } finally {
    await sql.end({ timeout: 1 });
  }
});

function isDeliveryDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

async function replayedRecord(sql: Sql): Promise<ReplayedRecord | null> {
  const [row] = await sql<{ first: string | null; last: string | null }[]>`
    SELECT min(delivery_date) AS first, max(delivery_date) AS last
    FROM forecast WHERE run_type = 'backtest'
  `;
  return row?.first && row.last ? { first: row.first, last: row.last } : null;
}

app.get("/days/:date", async (c) => {
  const deliveryDate = c.req.param("date");
  if (!isDeliveryDate(deliveryDate)) {
    return c.json<BadRequestResponse>(
      {
        error: "bad_request",
        message: `not a YYYY-MM-DD date: ${deliveryDate}`,
      },
      400,
    );
  }
  const sql = c.get("sql");

  const observed = await sql<Pick<RepairedObservedPriceRow, "price">[]>`
    SELECT price FROM repaired_observed_price
    WHERE delivery_date = ${deliveryDate}
      AND resolution_minutes = ${RESOLUTION_MINUTES}
    ORDER BY period_ordinal
  `;
  const rows = await sql<Pick<ForecastRow, "model" | "price">[]>`
    SELECT model, price FROM forecast
    WHERE delivery_date = ${deliveryDate}
      AND resolution_minutes = ${RESOLUTION_MINUTES}
      AND run_type = 'backtest'
    ORDER BY model, period_ordinal
  `;
  if (rows.length === 0 || observed.length !== PERIODS) {
    return c.json<NotInRecordResponse>(
      {
        error: "not_in_record",
        deliveryDate,
        record: await replayedRecord(sql),
      },
      404,
    );
  }

  const byModel = new Map<string, number[]>();
  for (const row of rows) {
    const prices = byModel.get(row.model) ?? [];
    prices.push(Number(row.price));
    byModel.set(row.model, prices);
  }
  const forecasts: ModelForecast[] = ROSTER_ORDER.filter((m) =>
    byModel.has(m),
  ).map((model) => ({ model, prices: byModel.get(model) ?? [] }));

  return c.json<DeliveryDayResponse>({
    deliveryDate,
    observed: observed.map((row) => Number(row.price)),
    forecasts,
  });
});
