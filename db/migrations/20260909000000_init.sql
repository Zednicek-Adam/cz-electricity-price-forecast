-- The schema is the contract between Python and TypeScript (ADR-0004), and
-- plain SQL migrations are its source of truth. This first one is empty on
-- purpose: ADR-0013 puts ADR-0005's five tables in phase 1, and the scaffold
-- only has to leave the migration path wired and `db/schema.sql` a real
-- regenerated artifact.
--
-- Every `GRANT` belongs in a migration too (ADR-0005), which is why `migrate`
-- connects to Neon as the owner role.

-- migrate:up

-- migrate:down
