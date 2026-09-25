/**
 * A small backtest record for seam 3, in a database of its own.
 *
 * `setup` clones the migrated local (or CI) database, schema and grants
 * included, into `czepf_api_test`, empties it and seeds it as the owner; the
 * app then reads it as `app_reader`. `teardown` drops the clone, so running
 * these tests never touches what the main database holds.
 *
 * The record holds the two ends of the backtest window, the 2024
 * spring-forward and fall-back days, and one ordinary day, for `daylag` and
 * `ar168`. Prices are `base + ordinal + offset`, with one negative period, so
 * a response shows exactly which stored value it came from.
 */
import postgres from "postgres";

import { LOCAL_DATABASE_URL } from "../src/db.ts";

const SOURCE_URL = process.env["DATABASE_URL"] ?? LOCAL_DATABASE_URL;
const TEST_DATABASE = "czepf_api_test";
const source = new URL(SOURCE_URL);
const templateName = source.pathname.slice(1);

function withDatabase(url: URL, database: string, user?: string): string {
  const copy = new URL(url);
  copy.pathname = `/${database}`;
  if (user) {
    copy.username = user;
    copy.password = user;
  }
  return copy.toString();
}

export const OWNER_URL = withDatabase(source, TEST_DATABASE);
export const READER_URL = withDatabase(source, TEST_DATABASE, "app_reader");
const MAINTENANCE_URL = withDatabase(source, "postgres");

export const FIRST_DAY = "2020-01-01";
export const ORDINARY_DAY = "2022-08-29";
export const SPRING_FORWARD = "2024-03-31";
export const FALL_BACK = "2024-10-27";
export const LAST_DAY = "2024-12-31";

export const DAYS: Record<string, number> = {
  [FIRST_DAY]: 30,
  [ORDINARY_DAY]: 500,
  [SPRING_FORWARD]: 60,
  [FALL_BACK]: 70,
  [LAST_DAY]: 90,
};
export const MODELS = ["ar168", "daylag"] as const;
export const OFFSETS = { observed: 0, daylag: 10, ar168: 5 } as const;
/**
 * Days the store holds only in part, which the API must refuse rather than
 * serve short: a model missing a period ordinal, a slug that is not on the
 * roster, and forecasts with no observed prices.
 */
export const BROKEN = {
  missingOrdinal: "2021-06-01",
  offRoster: "2021-06-02",
  noObserved: "2021-06-03",
};
/** Period ordinal 14 of the spring-forward day was cleared negative. */
export const NEGATIVE = { day: SPRING_FORWARD, ordinal: 14, price: -138.75 };

export function price(day: string, ordinal: number, offset: number): number {
  if (day === NEGATIVE.day && ordinal === NEGATIVE.ordinal && offset === 0) {
    return NEGATIVE.price;
  }
  return (DAYS[day] ?? 0) + ordinal + offset;
}

const quiet = { onnotice: () => {} };

export async function setup(): Promise<void> {
  const admin = postgres(MAINTENANCE_URL, quiet);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DATABASE} WITH (FORCE)`);
  await admin.unsafe(
    `CREATE DATABASE ${TEST_DATABASE} TEMPLATE "${templateName}"`,
  );
  await admin.end();

  const sql = postgres(OWNER_URL, quiet);
  await sql.unsafe(
    "TRUNCATE observed_price, repaired_observed_price, forecast," +
      " published_metric, model_comparison",
  );
  for (const day of Object.keys(DAYS)) {
    for (let ordinal = 1; ordinal <= 24; ordinal++) {
      await sql`
        INSERT INTO repaired_observed_price
        VALUES (${day}, ${ordinal}, 60, ${price(day, ordinal, OFFSETS.observed)})
      `;
      for (const model of MODELS) {
        await sql`
          INSERT INTO forecast VALUES (
            ${day}, ${ordinal}, 60, ${model}, 'backtest',
            ${price(day, ordinal, OFFSETS[model])}, ${model}, 'test', now()
          )
        `;
      }
    }
  }
  const full = Array.from({ length: 24 }, (_, i) => i + 1);
  const seedDay = async (
    day: string,
    observed: number[],
    forecasts: Record<string, number[]>,
  ): Promise<void> => {
    for (const ordinal of observed) {
      await sql`INSERT INTO repaired_observed_price VALUES (${day}, ${ordinal}, 60, 1)`;
    }
    for (const [model, ordinals] of Object.entries(forecasts)) {
      for (const ordinal of ordinals) {
        await sql`
          INSERT INTO forecast VALUES
          (${day}, ${ordinal}, 60, ${model}, 'backtest', 1, ${model}, 'test', now())
        `;
      }
    }
  };
  await seedDay(BROKEN.missingOrdinal, full, {
    daylag: full.filter((o) => o !== 7),
  });
  await seedDay(BROKEN.offRoster, full, { daylag: full, lear: full });
  await seedDay(BROKEN.noObserved, [], { daylag: full });
  await sql.end();
}

export async function teardown(): Promise<void> {
  const admin = postgres(MAINTENANCE_URL, quiet);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DATABASE} WITH (FORCE)`);
  await admin.end();
}
