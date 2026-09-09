/**
 * The Python/TypeScript seam is the schema, and the API/client seam is this
 * file: `web/` imports these types from `@cz-epf/api` rather than restating
 * them, so there is nothing to generate and nothing to keep in step by hand
 * (ADR-0004).
 *
 * What is here now is only the closed vocabularies that `CONTEXT.md` and
 * ADR-0005 already fix. The response shapes arrive with the endpoints, in
 * phase 2, and an endpoint exists because a view needs it.
 */

/** The three models of ADR-0003, as they are written on a stored row. */
export type ModelSlug = "chronos2" | "ar168" | "daylag";

/** Stored unqualified, so `CONTEXT.md` is the definition of record. */
export type MetricName = "mae" | "rmse" | "smape" | "rmae";

/** Closed by ADR-0002, and the one set the schema constrains. */
export type RunType = "backtest" | "live";
