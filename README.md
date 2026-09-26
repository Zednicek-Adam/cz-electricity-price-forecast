# CZ Day-Ahead Price Forecast

[![main](https://github.com/Zednicek-Adam/cz-electricity-price-forecast/actions/workflows/main.yml/badge.svg?branch=main)](https://github.com/Zednicek-Adam/cz-electricity-price-forecast/actions/workflows/main.yml)

A public dashboard that forecasts day-ahead electricity prices for the Czech
bidding zone (`BZN|CZ`) and scores its own forecasts against the market outcome.

**The dashboard** is deployed from `main` to Cloudflare. It has not been
deployed yet: its address goes here after the first deploy.

**This is a backtest, presented as one.** Every forecast on the dashboard was
produced after the fact, over the 1,827 delivery days from 2020-01-01 to
2024-12-31, whose prices were already known, by models that could see only the
prices published before each day they forecast. Nothing on the dashboard
forecasts tomorrow, and the dashboard says so the only way it can without a
banner: every date on it is in 2020–2024.

**rMAE here is not comparable to published electricity-price-forecasting work,
to the thesis this project builds on, or to figures from any other test
window.** It is measured against a day-lag naïve (the same hour on the previous
day) rather than the literature's seasonal naïve, and over this record only.

Prices are in EUR/MWh throughout, because that is how the market publishes
them. What every figure means, and how it is computed, is in
[Reading the figures](docs/reading-the-figures.md).

## What the record shows

Three models over the whole backtest window, every delivery period counted:

| Model | MAE | RMSE | SMAPE | rMAE |
|---|---|---|---|---|
| Chronos-2 | 16.6 | 29.0 | 20.5 | 0.638 |
| AR-168 | 20.1 | 34.2 | 23.8 | 0.771 |
| Naïve | 26.1 | 44.8 | 32.0 | 1.000 |

The headline model is **Chronos-2, a pretrained foundation model put into
production here, not a model invented here**. It is Amazon's `amazon/chronos-2`,
called zero-shot on the price history alone, pinned to one exact revision so
the record cannot move under it. What this project built is the system around
it: a way of producing and scoring forecasts that cannot see the future, and a
scoreboard a reader can check.

Most of the error is 2022. The naïve's MAE runs 7.8, 21.8, 52.6, 23.2 and 25.1
EUR/MWh across 2020 to 2024, and Chronos-2's runs 4.6, 14.1, 33.4, 14.6 and 16.5,
because error follows the price level, and in the energy crisis the level
more than doubled. The
ratio does not follow it: Chronos-2's rMAE stays between 0.59 and 0.66 in every
year. The dashboard's Over time view shows the same thing as a shape: each
model's running MAE climbs through 2022 and then settles.

A single day is much noisier than the record. Chronos-2's rMAE for one delivery
day ranges from 0.07 to 3.73 across the 1,827 days: on a calm day the naïve's
error is close to zero, and the ratio means little. The whole-record figure is
the one to read.

These figures are from the full replay of 2026-09-26, run from this repository
and checked with `forecast.verify`. They match the thesis's own Chronos-2
result, MAE 16.64 and rMAE 0.638, which is a check on the whole pipeline rather
than a target it was tuned to.

## Why the figures can be checked rather than trusted

Honest forecast evaluation is easy to claim, so here is how this one is built
to be checkable.

- **A model cannot see the future, by construction.** Each forecast is one call,
  `model.forecast(history, target_day)`. The model receives the price history
  as a value, cut at the start of the day it is forecasting, and holds no
  database connection, no data source and no clock (ADR-0002). A test checks
  that for every model, including that rewriting every stored price from the
  target day onward changes no forecast. It runs on every pull request, except
  for Chronos-2, whose weights the gate does not download; its checks run by
  hand before a replay.
- **The benchmark sits in the table.** The day-lag naïve is a model like the
  others and has its own row, at exactly rMAE 1.000. That row is what tells a
  reader what the ratio means.
- **No year is excluded.** 2022 is in every figure, and no headline number is
  computed over a shortened window (ADR-0002, ADR-0006).
- **Every day is reachable.** All 1,827 days can be opened on the dashboard,
  the worst included: a "worst day" button finds it.
- **The headline model was fixed before any result was read.** Chronos-2 leads
  because it was chosen to lead, not because it won (ADR-0003).
- **The scoreboard cannot describe forecasts that no longer exist.** Every
  accuracy figure is rebuilt from the stored forecasts, all at once, whenever
  forecasts are written (ADR-0010). Each forecast records the model version and
  the git commit that produced it.
- **The data is the market's own.** The observed prices are ENTSO-E's
  publication, committed unaltered, and every figure is EUR/MWh as cleared.

## Data, attribution and take-down

Electricity price data sourced from the
[ENTSO-E Transparency Platform](https://transparency.entsoe.eu/). ENTSO-E does
not endorse this project and is not responsible for its content or for any
forecasts derived from the data.

ENTSO-E performs no control on the accuracy, currency or consistency of the
data published on the Transparency Platform, and this project uses it under its
own responsibility (Transparency Platform General Terms and Conditions,
clause 6). The series is the day-ahead price for `BZN|CZ` (Transparency
Regulation article 12.1.d), delivery days 2018-01-01 to 2024-12-31, committed
in `data/` with its provenance in `data/NOTICE` and `data/README.md`. No price
value was altered.

**Take-down.** On a request from ENTSO-E or from the Primary Owner of Data, the
observed price series will be withdrawn from public display promptly and
without argument. The dashboard would then keep its forecasts and accuracy
figures, which are this project's own output, and stop showing the prices they
were scored against.

**Maintainer contact:** [Adam Zedníček on GitHub](https://github.com/Zednicek-Adam),
or an issue on this repository.

## Models

Three models, all univariate, on the roster in `CONTEXT.md` (ADR-0003):

- **Chronos-2** (`chronos2`), Amazon's pretrained forecasting model, used
  zero-shot on the price history alone, CPU and float32, with an 8,192-hour
  context. It is the headline model, chosen before any result was read. Its
  weights are `amazon/chronos-2` at the pinned revision
  `29ec3766d36d6f73f0696f85560a422f50e8498c`, downloaded at run time.
  Building it needs `uv sync --extra chronos`, and it never runs in the pull
  request gate.
- **AR-168** (`ar168`), an autoregression on a week of hourly lags of the
  differenced price. A hand-written port of `ar_lm_predict` from the author's
  diploma thesis repository,
  [`epf-diploma`](https://github.com/Zednicek-Adam/epf-diploma)
  (`models/_utils.R`, run by `models/R/AR168.R`; private). No history was
  transplanted from it, and the bar for the port is its specification, not the
  thesis's output.
- **The day-lag naïve** (`daylag`): yesterday's price for the same hour. It is
  what rMAE divides by, which is why its own rMAE is exactly 1.

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

A merge to `main` runs `.github/workflows/main.yml`: `migrate`, which runs
`dbmate up` against Neon as the owner role, then `deploy`, which builds the
client and runs `wrangler deploy`. Both run on every merge, with no path
filtering. Migrations are expand-only, and `dbmate down` is never run against
Neon. The badge at the top of this file is that workflow's status: if it is
red, `main` is not what is running.

Every pull request also gets a **preview**: the gate's `preview` job uploads a
version of the Worker, not deployed, at a public
`pr-<number>-cz-epf.<subdomain>.workers.dev` URL, and writes it to the job
summary. It reads production Neon as the reader role, which cannot write. The
preview is not a required check. Until Cloudflare is provisioned (#38) the job
skips with a warning.

Chronos-2's tests download its weights, so the gate leaves them out (they
carry the `chronos` marker, deselected by default). Run them by hand before a
replay that includes it:

```sh
cd forecast && uv run --extra chronos pytest -m chronos
```

Ruff's scope is the `forecast/` unit. `data/` and `analysis/` hold one-off
scripts that ran once and are kept for their provenance, and they are outside
the gate deliberately.

Each language has a linter and a formatter: `ruff check` and `ruff format` for
Python, `eslint` and `prettier` for TypeScript. `pnpm format` writes the fixes;
`pnpm format:check` is what the gate runs. Prettier's scope is code — prose is
hand-wrapped, so `.prettierignore` excludes `*.md` along with the generated
files the gate compares byte for byte.

### The API

`api/` is a Hono app on a Cloudflare Worker (ADR-0004). The same Worker serves
the client, `web/`, built by Vite as static assets. The API is read-only and
screen-shaped: an endpoint exists because a view needs it. It connects as
whatever `NEON_READER` names, which in production is Neon's reader role. Locally
that comes from `api/.dev.vars`, or on the command line:

```sh
pnpm --filter @cz-epf/web build   # the Worker serves web/dist
cd api
pnpm exec wrangler dev --var NEON_READER:postgres://app_reader:app_reader@localhost:5432/czepf
```

That serves the dashboard and the API together on `localhost:8787`. For work on
the client, `pnpm --filter @cz-epf/web dev` runs Vite's dev server, which passes
`/api` requests through to that Worker.

| Endpoint | View |
|---|---|
| `GET /api/days/:deliveryDate` | Day view: the repaired observed price and every model over 24 period ordinals |
| `GET /api/running/:metric` | Over time view: every model's running metric across the record, derived in the Worker (ADR-0015) |
| `GET /api/daily/:metric` | The ribbon, and worst / best / random: the headline model's per-day metric |
| `GET /api/accuracy` | Accuracy table: every model × four metrics over the whole record |
| `GET /api/comparisons/:model` | Diebold–Mariano card: a model against both opponents, by period ordinal |

`:metric` is one of `mae`, `rmse`, `smape` and `rmae`.

Its tests invoke the app's fetch handler directly, as `app_reader`, against a
seeded Postgres: a database of their own, `czepf_api_test`. It is cloned from the
migrated local one and dropped afterwards, so running them leaves your data alone. The row types in `api/src/db.generated.ts` are generated from the
migrated database by `pnpm --filter @cz-epf/api db:types`. Regenerate them
alongside any migration; the pull request gate fails if they drift.

### The replay

The replay fills the store. It loads the frozen dataset, forecasts a set of
models over a range of delivery days, and rebuilds every published metric and
model comparison (ADR-0010):

```sh
cd forecast
DATABASE_URL=postgresql://app_writer:app_writer@localhost:5432/czepf \
  uv run python -m forecast.replay --models daylag,ar168 --start 2020-01-01 --end 2024-12-31
```

After a full replay, `forecast.verify` checks what the store holds: 24
backtest forecasts per model on each of the 1,827 delivery days, with no year
excluded; 24 period ordinals on every daylight-saving day; the naïve's overall
rMAE at exactly 1.000; and derived rows describing exactly the models
replayed. It only reads, so the reader role is enough:

```sh
DATABASE_URL=postgresql://app_reader:app_reader@localhost:5432/czepf \
  uv run python -m forecast.verify --models daylag,ar168
```

The first full replay into Neon is driven from the author's machine as the
writer role (ADR-0013), using the two commands above with `DATABASE_URL` set
to the `NEON_WRITER` URL.

Before a full replay, the `smoke replay` workflow runs every model over about
five days (by default 2024-10-25 to 2024-10-29, across the fall-back day) on a
GitHub runner, as the writer. It is a wiring rehearsal, run by hand and rarely.
If a stage fails, the log and an error annotation name the stage, the model and
the delivery day.

Against Neon it runs from the `replay` workflow, which is `workflow_dispatch`
only, as the writer role. Nothing runs it on a merge or on a schedule. The
tests expect an empty local database, so replay into a separate one, or
truncate afterwards.

### Stopping

```sh
docker compose down     # keep the data
docker compose down -v  # and drop it
```
