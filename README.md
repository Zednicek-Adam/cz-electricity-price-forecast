# CZ Day-Ahead Price Forecast

[![main](https://github.com/Zednicek-Adam/cz-electricity-price-forecast/actions/workflows/main.yml/badge.svg?branch=main)](https://github.com/Zednicek-Adam/cz-electricity-price-forecast/actions/workflows/main.yml)

A public dashboard that forecasts day-ahead electricity prices for the Czech
bidding zone (`BZN|CZ`) and scores its own forecasts against the market outcome
once it is known.

`CONTEXT.md` fixes the vocabulary; `docs/adr/` holds the decisions; ADR-0013 is
the build order. This README carries only what a developer needs to run the
repository locally. The project's narrative, its accuracy disclosures and
issue #20's attribution obligations land here in phase 3 (issue #51).

ADR-0013 dates those obligations at the first preview deploy, which phase 3
builds. Until then `data/NOTICE` carries the attribution, the no-endorsement
line and the take-down commitment beside the data they cover.

## The four units

| Directory | What it is | Toolchain |
|---|---|---|
| `forecast/` | The loader, the models and the runner | Python, `uv` |
| `db/` | Plain SQL migrations and the generated schema | `dbmate` |
| `api/` | The read-only API, a Cloudflare Worker | TypeScript, `pnpm` |
| `web/` | The dashboard, static assets on the same Worker | TypeScript, `pnpm` |

`api/` and `web/` are one pnpm workspace, so the API-to-client contract is
TypeScript on both sides and shared by import. There is no monorepo
orchestrator: the four units are plain directories (ADR-0004).

Most of this is still scaffolding. Nothing forecasts and nothing renders yet.

## Local development

**Prerequisites:** [Docker](https://docs.docker.com/get-started/get-docker/),
[Node 22+](https://nodejs.org) with [pnpm](https://pnpm.io/installation), and
[uv](https://docs.astral.sh/uv/getting-started/installation/). No local
Postgres client and no local `dbmate` — both run in containers.

Two commands take a clone to a migrated local database. Neither needs a
toolchain installed, because both run in containers:

```sh
docker compose up -d db                # Postgres on localhost:5432
docker compose run --rm dbmate up      # apply db/migrations/
```

The two toolchains are a separate step. The database does not need them;
everything else does:

```sh
pnpm install                  # api/ and web/
uv sync --project forecast    # forecast/
```

Nothing is *developed* inside a container: `uv`, `pnpm`, `wrangler dev` and
Vite all run natively (ADR-0004). Docker runs Postgres, and runs `dbmate` as a
one-shot for the reason the next section gives.

The local Postgres also creates the two application roles, `app_writer` and
`app_reader`, from `db/local-roles.sql` when its volume is first initialised,
so the grant migration applies locally as it does on Neon. A volume created
before that file existed needs `docker compose down -v` once.

The database listens on `localhost:5432` as
`postgres://postgres:postgres@localhost:5432/czepf`. `docker-compose.yml` is
where its version is fixed; the pull request gate runs against the same image,
so migrations and persistence tests have one code path rather than two
(ADR-0010).

### Migrations

Plain SQL up/down files in `db/migrations/`, applied by `dbmate`. The generated
`db/schema.sql` is committed, and the pull request gate fails if it does not
match what the migrations produce — so regenerate it in the same commit that
adds a migration:

```sh
docker compose run --rm dbmate new add_a_table         # scaffold a migration
docker compose run --rm dbmate up                      # apply, and rewrite db/schema.sql
docker compose run --rm dbmate dump                    # rewrite db/schema.sql alone
```

`dbmate` runs in a container so that `pg_dump` is pinned: it writes its own
version and the server's into the dump, so a `pg_dump` from a different release
rewrites `db/schema.sql` for reasons that have nothing to do with the
migration. Both images are pinned to the patch for that reason, and bumping
either is a commit that regenerates the schema file.

`db/schema.sql` is a record of what the migrations add up to, so that a pull
request changing the cross-language contract shows that change in its diff
(ADR-0005). It is never applied: the migrations are. It is also written by
`pg_dump` 18, so it carries `\restrict` meta-commands that an older `psql`
cannot read.

Migrations against Neon run from GitHub Actions on merge to `main`, as the
owner role. `dbmate down` is never run against Neon (ADR-0010).

### Checks

The same three sets the pull request gate runs:

```sh
cd forecast && uv run ruff check . && uv run ruff format --check . && uv run pytest  # needs the migrated db
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
docker compose run --rm dbmate up   # then: git diff --exit-code db/schema.sql
```

In CI these are the `python`, `typescript` and `db` jobs of
`.github/workflows/gate.yml`. They run in parallel on every pull request, with
no path filtering, and `all-green` is the one required check behind them. The
`db` job brings up the same `docker-compose.yml` services, so CI and a laptop
share one pin for both images.

A merge to `main` runs `.github/workflows/main.yml`. Its `migrate` job runs
`dbmate up` against Neon as the owner role, from the `production` Environment.
Migrations are expand-only, and `dbmate down` is never run against Neon. The
badge at the top of this file is that workflow's status: if it is red, `main`
is not what is running.

Ruff's scope is the `forecast/` unit. `data/` and `analysis/` hold one-off
scripts that ran once and are kept for their provenance, and they are outside
the gate deliberately.

Each language has a linter and a formatter: `ruff check` and `ruff format` for
Python, `eslint` and `prettier` for TypeScript. `pnpm format` writes the fixes;
`pnpm format:check` is what the gate runs. Prettier's scope is code — prose is
hand-wrapped, so `.prettierignore` excludes `*.md` along with the generated
files the gate compares byte for byte.

### The replay

The replay fills the store. It loads the frozen dataset, forecasts a set of
models over a range of delivery days, and rebuilds every published metric and
model comparison (ADR-0010):

```sh
cd forecast
DATABASE_URL=postgresql://app_writer:app_writer@localhost:5432/czepf \
  uv run python -m forecast.replay --models daylag,ar168 --start 2020-01-01 --end 2024-12-31
```

Against Neon it runs from the `replay` workflow, which is `workflow_dispatch`
only, as the writer role. Nothing runs it on a merge or on a schedule. The
tests expect an empty local database, so replay into a separate one, or
truncate afterwards.

### Stopping

```sh
docker compose down     # keep the data
docker compose down -v  # and drop it
```

## Models

Three models, all univariate, on the roster in `CONTEXT.md` (ADR-0003). The
day-lag naïve (`daylag`) is what rMAE divides by. AR-168 (`ar168`) is a hand-written
port of `ar_lm_predict` from the author's diploma thesis repository,
`epf-diploma` (`models/_utils.R`, run by `models/R/AR168.R`). No history was
transplanted from it, and the bar for the port is its specification, not the
thesis's output. Chronos-2 joins in phase 4.

## Data

`data/` holds the frozen observed-price dataset the whole of v1 replays over,
with its provenance and licence in `data/NOTICE`. See `data/README.md`.
