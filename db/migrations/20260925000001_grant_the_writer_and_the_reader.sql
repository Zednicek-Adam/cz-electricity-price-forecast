-- Every GRANT lives in a migration (ADR-0005), so a table cannot ship
-- ungranted or over-granted. The roles themselves are created once by hand in
-- Neon (docs/provisioning.md), and by `db/local-roles.sql` in the local and CI
-- Postgres. On a database where either role is missing this migration fails,
-- which is the point: a grant that is skipped quietly is a reader that 500s in
-- production or a writer that cannot write.
--
-- The writer gets the verbs the write semantics use and no others (ADR-0005):
--   * observed and repaired prices are append-only: INSERT, never UPDATE or
--     DELETE, so the historical record is immutable as a database fact;
--   * forecasts and the two derived metric tables are replaced by delete and
--     re-insert, never upserted, so there is no UPDATE there either.
-- The reader gets SELECT and nothing else (ADR-0004, ADR-0010).
--
-- A later migration that adds a table grants on it explicitly, here in SQL,
-- rather than relying on default privileges: the grant is then in the diff of
-- the pull request that adds the table.

-- migrate:up

GRANT USAGE ON SCHEMA public TO app_writer, app_reader;

GRANT SELECT, INSERT ON observed_price, repaired_observed_price TO app_writer;
GRANT SELECT, INSERT, DELETE ON forecast, published_metric, model_comparison
    TO app_writer;

GRANT SELECT ON observed_price, repaired_observed_price, forecast,
    published_metric, model_comparison TO app_reader;

-- migrate:down

REVOKE ALL ON observed_price, repaired_observed_price, forecast,
    published_metric, model_comparison FROM app_writer, app_reader;
REVOKE USAGE ON SCHEMA public FROM app_writer, app_reader;
