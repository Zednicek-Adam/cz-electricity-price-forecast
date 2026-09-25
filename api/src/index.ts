/**
 * The Python/TypeScript seam is the schema, and the API/client seam is this
 * file: `web/` imports from `@cz-epf/api` rather than restating what the API
 * returns, so there is nothing to generate and nothing to keep in step by hand
 * (ADR-0004).
 *
 * There is no Hono app yet. ADR-0013 puts the API in phase 2, after the store
 * and the runner, and ADR-0007's views are what specify its endpoints — so an
 * endpoint, and the response shape that goes with it, arrives when a view
 * needs it.
 *
 * One type is here now, and only because `CONTEXT.md` is already its authority
 * rather than the schema: ADR-0005 leaves `model` free text in the database
 * precisely so that the roster lives in one written place. Nothing else is
 * restated here ahead of the migration that constrains it.
 */

/** The three models of ADR-0003, as they are written on a stored row. */
export type ModelSlug = "chronos2" | "ar168" | "daylag";
