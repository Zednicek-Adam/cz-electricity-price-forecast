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
 *
 * Bad data fails loudly. A delivery day the record does not hold is a 404; a
 * day it holds only in part — a model short of 24 period ordinals, a slug that
 * is not on the roster, observed prices missing — is a 500, because the store
 * is broken and a short or reordered array would chart as if it were not.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ForecastRow, RepairedObservedPriceRow } from "./db.generated.ts";
import { connect, type Sql } from "./db.ts";
import type {
  BadRequestResponse,
  DeliveryDayResponse,
  ModelForecast,
  ModelSlug,
  NotInRecordResponse,
  RecordExtent,
} from "./index.ts";

export interface Bindings {
  /** The Postgres URL of Neon's reader role; locally, any role that can read. */
  NEON_READER: string;
}

export const PERIODS = 24;
export const RESOLUTION_MINUTES = 60;
/** The roster (CONTEXT.md), in the order the dashboard lists it. */
export const ROSTER: readonly ModelSlug[] = ["chronos2", "ar168", "daylag"];
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

app.get("/days/:deliveryDate", async (c) => {
  const deliveryDate = c.req.param("deliveryDate");
  if (!isDeliveryDate(deliveryDate)) {
    return c.json<BadRequestResponse>(
      {
        error: "bad_request",
        message: `not a delivery day (YYYY-MM-DD): ${deliveryDate}`,
      },
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

  type Row = (typeof rows)[number];
  const byModel = new Map<string, Row[]>();
  for (const row of rows) {
    byModel.set(row.model, [...(byModel.get(row.model) ?? []), row]);
  }
  const forecasts: ModelForecast[] = [];
  for (const [model, modelRows] of byModel) {
    if (!isModelSlug(model)) {
      throw new Error(`${deliveryDate}: ${model} is not on the roster`);
    }
    forecasts.push({
      model,
      prices: onTheGrid(`${deliveryDate} ${model}`, modelRows),
    });
  }
  forecasts.sort((a, b) => ROSTER.indexOf(a.model) - ROSTER.indexOf(b.model));

  return c.json<DeliveryDayResponse>({
    deliveryDate,
    observed: onTheGrid(`${deliveryDate} observed`, observed),
    forecasts,
  });
});
