/**
 * A small replayed record for seam 3, seeded into the local (or CI) Postgres as
 * the owner and read back by the app as `app_reader`.
 *
 * It holds the two ends of the replay window, the 2024 spring-forward day, and
 * one ordinary day between, for `daylag` and `ar168`. Prices are
 * `base + ordinal`, with one negative period, so a response shows exactly
 * which stored value it came from.
 */
import postgres from "postgres";

import { LOCAL_DATABASE_URL } from "../src/db.ts";

export const ADMIN_URL = process.env["DATABASE_URL"] ?? LOCAL_DATABASE_URL;
export const READER_URL = ADMIN_URL.replace(
  /\/\/[^@]+@/,
  "//app_reader:app_reader@",
);

export const FIRST_DAY = "2020-01-01";
export const SPRING_FORWARD = "2024-03-31";
export const ORDINARY_DAY = "2022-08-29";
export const LAST_DAY = "2024-12-31";

export const DAYS: Record<string, number> = {
  [FIRST_DAY]: 30,
  [ORDINARY_DAY]: 500,
  [SPRING_FORWARD]: 60,
  [LAST_DAY]: 90,
};
export const OFFSETS = { observed: 0, daylag: 10, ar168: 5 } as const;
/** Period ordinal 14 of the spring-forward day was cleared negative. */
export const NEGATIVE = { day: SPRING_FORWARD, ordinal: 14, price: -138.75 };

export function price(day: string, ordinal: number, offset: number): number {
  if (day === NEGATIVE.day && ordinal === NEGATIVE.ordinal && offset === 0) {
    return NEGATIVE.price;
  }
  return (DAYS[day] ?? 0) + ordinal + offset;
}

const TABLES =
  "observed_price, repaired_observed_price, forecast, published_metric, model_comparison";

export async function setup(): Promise<void> {
  const sql = postgres(ADMIN_URL, { onnotice: () => {} });
  await sql.unsafe(`TRUNCATE ${TABLES}`);
  for (const day of Object.keys(DAYS)) {
    for (let ordinal = 1; ordinal <= 24; ordinal++) {
      await sql`
        INSERT INTO repaired_observed_price
        VALUES (${day}, ${ordinal}, 60, ${price(day, ordinal, OFFSETS.observed)})
      `;
      for (const model of ["daylag", "ar168"] as const) {
        await sql`
          INSERT INTO forecast VALUES (
            ${day}, ${ordinal}, 60, ${model}, 'backtest',
            ${price(day, ordinal, OFFSETS[model])}, ${model}, 'test', now()
          )
        `;
      }
    }
  }
  await sql.end();
}

export async function teardown(): Promise<void> {
  const sql = postgres(ADMIN_URL, { onnotice: () => {} });
  await sql.unsafe(`TRUNCATE ${TABLES}`);
  await sql.end();
}
