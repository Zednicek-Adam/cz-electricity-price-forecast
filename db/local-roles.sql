-- The two application roles, for the local and CI Postgres only. Mounted into
-- the `db` container's /docker-entrypoint-initdb.d, so it runs once, when the
-- data volume is first created.
--
-- On Neon these roles are created by hand (docs/provisioning.md), with real
-- passwords. Here the password is the role name: this database is on
-- localhost, holds nothing that is not in `data/`, and the roles exist so that
-- the grant migration applies identically everywhere and so that tests can
-- check what each role is refused.
CREATE ROLE app_writer WITH LOGIN PASSWORD 'app_writer';
CREATE ROLE app_reader WITH LOGIN PASSWORD 'app_reader';
