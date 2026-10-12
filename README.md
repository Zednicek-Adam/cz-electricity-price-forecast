# CZ Day-Ahead Price Forecast

[![main](https://github.com/Zednicek-Adam/cz-electricity-price-forecast/actions/workflows/main.yml/badge.svg?branch=main)](https://github.com/Zednicek-Adam/cz-electricity-price-forecast/actions/workflows/main.yml)

A public dashboard that forecasts day-ahead electricity prices for the Czech
bidding zone (`BZN|CZ`) and scores its own forecasts against the market outcome.

**The dashboard:** <https://cz-epf.adam-zednicek123.workers.dev>, deployed
from `main` to Cloudflare on every merge and after every daily run.

**Most of the record is a backtest, and its newest day is a forecast.** Every
forecast for a delivery day up to 2026-10-13 was produced after the fact, by
models that could see only the prices published before the day they forecast.
From 2026-10-14 on, the daily run forecasts each delivery day before its price
is published, at 14:35 Prague time, two days ahead. Both kinds are scored the
same way and pooled into one record (ADR-0016), and each row of
`data/forecasts.csv` says which kind it is. The one forecast whose price is not
published yet is the pending day, and the dashboard opens on it.

**rMAE here is not comparable to published electricity-price-forecasting work,
to the thesis this project builds on, or to figures from any other test
window.** It is measured against a day-lag naïve (the same hour on the previous
day) rather than the literature's seasonal naïve, and over this record only.

Prices are in EUR/MWh throughout, because that is how the market publishes
them. What every figure means, and how it is computed, is in
[Reading the figures](docs/reading-the-figures.md).

## What the record shows

Three models over the record from 2020-01-01 to 2026-10-13, 2,478 delivery
days, every delivery period counted:

| Model | MAE | RMSE | SMAPE | rMAE |
|---|---|---|---|---|
| Chronos-2 | 17.1 | 29.4 | 22.8 | 0.654 |
| AR-168 | 20.6 | 34.0 | 26.2 | 0.786 |
| Naïve | 26.2 | 44.0 | 33.7 | 1.000 |

The dashboard's figures move with every daily run; these are as of 2026-10-13.

The headline model is **Chronos-2, a pretrained foundation model put into
production here, not a model invented here**. It is Amazon's `amazon/chronos-2`,
called zero-shot on the price history alone, pinned to one exact revision so
the record cannot move under it. What this project built is the system around
it: a way of producing and scoring forecasts that cannot see the future, and a
scoreboard a reader can check.

Most of the error is 2022. The naïve's MAE runs 7.8, 21.8, 52.6, 23.2, 25.1,
24.1 and 29.5 EUR/MWh across 2020 to 2026 (2026 so far), and Chronos-2's runs
4.6, 14.1, 33.4, 14.6, 16.5, 17.0 and 20.4, because error follows the price
level, and in the energy crisis the level more than doubled. The ratio does not
follow it: Chronos-2's rMAE stays between 0.59 and 0.71 in every year. The
dashboard's Over time view shows the same thing as a shape: each model's running
MAE climbs through 2022 and then settles.

A single day is much noisier than the record. Chronos-2's rMAE for one delivery
day ranges from 0.07 to 3.73 across the 2,478 days: on a calm day the naïve's
error is close to zero, and the ratio means little. The whole-record figure is
the one to read.

Over the 2020–2024 backtest alone, Chronos-2 reads MAE 16.64 and rMAE 0.638,
the thesis's own Chronos-2 result, which is a check on the whole pipeline rather
than a target it was tuned to. Those 1,827 days are the production backtest of
2026-09-28, copied unchanged out of the database the dashboard used to read;
2025-01-01 to 2026-10-13 was replayed on 2026-10-12 by the same code.

## Why the figures can be checked rather than trusted

Honest forecast evaluation is easy to claim, so here is how this one is built
to be checkable.

- **A model cannot see the future, by construction.** Each forecast is one call,
  `model.forecast(history, target_day)`. The model receives the price history
  as a value, cut at the start of the day it is forecasting, and holds no
  file, no data source and no clock (ADR-0002). A test checks that for every
  model, including that rewriting every price from the target day onward
  changes no forecast. It runs on every pull request, except
  for Chronos-2, whose weights the gate does not download; its checks run by
  hand before a replay.
- **The benchmark sits in the table.** The day-lag naïve is a model like the
  others and has its own row, at exactly rMAE 1.000. That row is what tells a
  reader what the ratio means.
- **No year is excluded.** 2022 is in every figure, and no headline number is
  computed over a shortened window (ADR-0002, ADR-0006).
- **Every day is reachable.** Every day of the record can be opened on the
  dashboard, the worst included: a "worst day" button finds it.
- **The headline model was fixed before any result was read.** Chronos-2 leads
  because it was chosen to lead, not because it won (ADR-0003).
- **The scoreboard cannot describe forecasts that no longer exist.** Every
  accuracy figure is recomputed from `data/forecasts.csv`, all at once, on
  every deploy (ADR-0010). Each forecast records the model version and the git
  commit that produced it.
- **The record is in git.** Prices and forecasts are CSV files in `data/`, so
  any change to either is a diff in a commit. A forecast written before its
  price was published is never replaced (ADR-0011).
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
Regulation article 12.1.d), from delivery day 2018-01-01, committed in `data/`
with its provenance in `data/NOTICE` and `data/README.md`: 2018–2024 from the
platform's export files, and from 2025 fetched from its API by the daily run.
No price value was altered. From 2025-10-01 the market clears in quarter-hours;
those are committed as published, and the hourly price the models see is the
mean of an hour's four (the Average Rule).

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

### The file the dashboard reads

`/dashboard.json` holds the whole record, and the page fetches it once before
its first render. Its shape is `Dashboard` in `web/src/types.ts`:

| Key | What it holds | View |
|---|---|---|
| `record` | The first and last delivery day, and the pending day | Caption, navigator, staleness warning |
| `days` | Per delivery day: the repaired observed price, each model's 24 forecasts and its four metrics for the day | Day view, headline numbers, ribbon, worst / best / random |
| `running` | Each model's running metric on every scored day | Over time view |
| `accuracy` | Each model's four metrics over the whole record | Accuracy table |
| `comparisons` | Each model's Diebold–Mariano statistic against each opponent, by period ordinal | Diebold–Mariano card |

Forecasts are rounded to the cent and figures to six significant digits, finer
than anything on screen; every figure is computed before rounding. The file is
about 2.5 MB, 750 kB gzipped, and grows by about 100 kB gzipped a year.

Before it writes anything, the export checks the records and stops on the first
failure: every model has a forecast on each of the 1,827 days from 2020-01-01
to 2024-12-31, at most one day is pending, and the naïve's overall rMAE reads
exactly 1.000.

### Checks

The two sets the pull request gate runs:

```sh
cd forecast && uv run ruff check . && uv run ruff format --check . && uv run pytest && uv run python -m forecast.export
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
```

In CI these are the `python` and `typescript` jobs of
`.github/workflows/gate.yml`. They run in parallel on every pull request, with
no path filtering, and `all-green` is the one required check behind them.

A push to `main` runs `.github/workflows/main.yml`: the export, the Vite build
and `wrangler deploy`, with no path filtering. The badge at the top of this
file is that workflow's status: if it is red, `main` is not what is running.

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
`pnpm format:check` is what the gate runs. Prettier's scope is code — prose is
hand-wrapped, so `.prettierignore` excludes `*.md` and the export's output.

### The replay

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

### The daily run

`.github/workflows/daily.yml` runs every day at 13:35 UTC (ADR-0012):

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
