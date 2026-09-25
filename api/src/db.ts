/**
 * The API's one way into Postgres. It connects as whatever `NEON_READER` names:
 * Neon's reader role in production, which holds `SELECT` and nothing else
 * (ADR-0010), so nothing reachable from the public surface can write.
 */
import postgres from "postgres";

export const LOCAL_DATABASE_URL =
  "postgres://postgres:postgres@localhost:5432/czepf";

/**
 * `date` columns stay the `YYYY-MM-DD` strings Postgres sends. A delivery day is
 * a calendar day in `Europe/Prague`, not an instant, and turning it into a JS
 * `Date` would pin it to a midnight in some time zone.
 */
export const PG_TYPES = {
  date: {
    to: 1082,
    from: [1082],
    serialize: (value: string) => value,
    parse: (value: string) => value,
  },
};

export type Sql = postgres.Sql<{ date: string }>;

export function connect(url: string): Sql {
  // One connection per request: a Worker holds nothing between requests.
  return postgres(url, { types: PG_TYPES, max: 1, fetch_types: false });
}
