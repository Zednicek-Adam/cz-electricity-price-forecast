# Development

How to build, check and run this project. For what the numbers on the
dashboard mean, see [Reading the figures](reading-the-figures.md); for the
accounts and secrets a person has to set up, see
[Provisioning](provisioning.md).

## The two units

| Directory | What it is | Toolchain |
|---|---|---|
| `forecast/` | The ingest, the models, the runner, the replay, the daily run and the export | Python, `uv` |
| `web/` | The dashboard, static assets on a Cloudflare Worker | TypeScript, `pnpm` |

The records they share are the two CSV files in `data/`. There is no database
and no API: the export turns the records into the one JSON file the dashboard
reads, at deploy time (ADR-0016). There is no monorepo orchestrator: the units
are plain directories.

## Local development

**Prerequisites:** [Node 22+](https://nodejs.org) with
[pnpm](https://pnpm.io/installation), and
[uv](https://docs.astral.sh/uv/getting-started/installation/).

```sh
pnpm install                                        # web/
uv sync --project forecast                          # forecast/
uv run --project forecast python -m forecast.export # writes web/public/dashboard.json
pnpm --filter @cz-epf/web dev                       # the dashboard, on Vite
```

The export reads both records, checks them, and writes everything the
dashboard shows into `web/public/dashboard.json`, which is not committed. Run
it again after changing either record.

Chronos-2 needs its own extra: `uv sync --project forecast --extra chronos`.
Its weights, `amazon/chronos-2` at the pinned revision, are downloaded at run
time.

### The file the dashboard reads

`/dashboard.json` holds the whole record, and the page fetches it once before
its first render. Its shape is `Dashboard` in `web/src/types.ts`:

| Key | What it holds | View |
|---|---|---|
| `record` | The first and last delivery day, and the pending day | Caption, navigator, staleness warning |
| `days` | Per delivery day: the repaired observed price, each model's 24 forecasts and its four metrics for the day | Day view, headline numbers, ribbon, worst / best / random |
| `running` | Each model's running metric on every scored day | Over time view |
| `trailing` | Each model's metric over the 30 days, and over the 7 days, ending on every scored day | Over time view, last 30 or 7 days |
| `window` | The last 30 scored delivery days | Chart and scoreboard captions |
| `week` | The last 7 scored delivery days | Chart captions |
| `profiles` | Each model's four metrics per weekday and per period ordinal, over the whole record, the last 30 days and the last 7 | By weekday and By hour views |
| `accuracy` | Each model's four metrics, over the whole record, the last 30 days and the last 7 | Over time headline numbers, accuracy table |
| `prices` | The observed price's mean and percentiles on each scored day, over the 30 and the 7 days ending on each, and per weekday and per period ordinal over each history | Price chart |
| `comparisons` | Each model's Diebold–Mariano statistic against each opponent, by period ordinal, over the whole record and over the last 30 days | Diebold–Mariano card |

Forecasts and price distributions are rounded to the cent and figures to six
significant digits, finer than anything on screen; every figure is computed
before rounding. The file is about 3.4 MB, 1.1 MB gzipped, and grows by about
135 kB gzipped a year.

Before it writes anything, the export checks the records and stops on the first
failure: every model has a forecast on each of the 1,827 days from 2020-01-01
to 2024-12-31, at most one day is pending, and the naïve's overall rMAE reads
exactly 1.000.

## Checks

The two sets the pull request gate runs:

```sh
cd forecast && uv run ruff check . && uv run ruff format --check . && uv run pytest && uv run python -m forecast.export
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
```

In CI these are the `python` and `typescript` jobs of
`.github/workflows/gate.yml`. They run in parallel on every pull request, with
no path filtering, and `all-green` is the one required check behind them.

A push to `main` runs `.github/workflows/main.yml`: the export, the Vite build
and `wrangler deploy`, with no path filtering. The badge at the top of the
README is that workflow's status: if it is red, `main` is not what is running.

Every pull request also gets a **preview**: the gate's `preview` job exports
the records as the pull request leaves them, builds, and uploads a version of
the Worker, not deployed, at a public
`pr-<number>-cz-epf.<subdomain>.workers.dev` URL, which it writes to the job
summary. The preview is not a required check.

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
`pnpm format:check` is what the gate runs. Prettier's scope is code. Prose is
hand-wrapped, so `.prettierignore` excludes `*.md` and the export's output.

## The replay

The replay forecasts a set of models over a range of delivery days, as
backtests, and merges the runs into `data/forecasts.csv`, replacing the
backtest run held for the same model and day:

```sh
cd forecast
uv run python -m forecast.replay --models daylag,ar168 --start 2020-01-01 --end 2024-12-31
```

`--end` defaults to the last day with a published price. A day that already
has a live forecast keeps it. On GitHub the `replay` workflow, which is
`workflow_dispatch` only, runs the same command and pushes the changed record
to a `replay/<run>` branch; its summary links to the pull request to open, so a
replay is reviewed, gated and previewed before the merge deploys it.

## The daily run

`.github/workflows/daily.yml` runs every day at 13:35 UTC, which is 14:35 in
Prague in winter and 15:35 in summer (ADR-0012):

1. **Ingest** fetches every delivery day after the last one in
   `data/cz-day-ahead-prices.csv`, through tomorrow, from the ENTSO-E API, and
   appends the complete ones. A day not published yet ends it quietly; a day
   published in part fails the run.
2. **Forecast**: every model forecasts the first day without a published price,
   as a `live` run, appended to `data/forecasts.csv`.
3. The workflow commits both records to `main` with a deploy key, and that push
   runs `main.yml`, which deploys.

A run that fails commits nothing and is not retried: the next run fetches the
missing prices, and the forecast it did not write stays a hole. If the schedule
stops, the pending day goes stale and the dashboard says the daily run has
stopped; `gh workflow enable daily.yml` restarts it, and
`gh workflow run daily.yml` runs it at once. Locally:

```sh
cd forecast
ENTSOE_API_TOKEN=... uv run --extra chronos python -m forecast.daily
```
