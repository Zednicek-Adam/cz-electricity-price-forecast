# CZ Day-Ahead Price Forecast

[![main](https://github.com/Zednicek-Adam/cz-electricity-price-forecast/actions/workflows/main.yml/badge.svg?branch=main)](https://github.com/Zednicek-Adam/cz-electricity-price-forecast/actions/workflows/main.yml)

A public dashboard that forecasts Czech wholesale electricity prices two days
ahead, then scores each forecast against the price the market actually set.

**The dashboard:** <https://cz-epf.adam-zednicek123.workers.dev>

![The dashboard's Day view: one delivery day's real price as a black line, with each model's forecast for the same 24 hours drawn over it, and below it each model's average miss for the day](docs/images/dashboard-day.png)

## The problem in a minute

Much of Europe's electricity, Czechia's included, is traded the day before it
is used. Every day around noon an auction, the day-ahead market, sets a price
for each hour of the next day (each quarter-hour since October 2025).
Prices are in euros per megawatt-hour, EUR/MWh, because that is how the market
publishes them.

Those prices move a lot. They follow demand, the weather, the price of gas, and
how much sun and wind there is. On a sunny, windy Sunday they can go below
zero, and in the 2022 energy crisis they more than doubled. Anyone who buys,
sells or stores electricity wants a good guess at them before the auction.
Making that guess is electricity price forecasting.

This project makes the guess every afternoon, for the first day whose prices
are not out yet, and scores it once they are:

![A timeline over three days. Monday noon, the auction sets Tuesday's prices. Monday afternoon, the models forecast Wednesday. Tuesday noon, the auction sets Wednesday's prices. Tuesday afternoon, Wednesday's forecast is scored against them. Wednesday, the electricity is delivered.](docs/images/timeline.svg)

## What the dashboard shows

The dashboard opens on the newest forecast, the one whose price is not
published yet. It has four views:

- **Day**, pictured above: one day's real price (black) against each model's
  24 hourly forecasts.
- **Over time**: how each model's accuracy has developed since 2020, or over
  the last 30 or 7 days.
- **By weekday** and **By hour**: which days of the week and hours of the day
  the models miss most.

Accuracy is mostly read as **MAE**, the average miss per hour in EUR/MWh, and
**rMAE**, a model's MAE divided by the naïve's. The naïve is a deliberately
simple forecast, "each hour costs what it did yesterday", so an rMAE below 1
means a model beat it.

Below the chart are the price over the same days, the accuracy table, and a
statistical test (Diebold–Mariano) of whether one model really beats another
or just got lucky. [Reading the figures](docs/reading-the-figures.md) explains
every number and chart.

**The rMAE on this dashboard is not comparable to published
electricity-price-forecasting research, to the thesis this project builds on,
or to any other test window.** The literature measures against a seasonal naïve
(a week back on Mondays and weekends); this project uses the simpler day-lag
naïve, and only over its own record.

## The models

All three see only the history of Czech day-ahead prices. No weather, no
demand, no gas price.

- **Chronos-2**, the headline model. Amazon's pretrained time-series model,
  used as it comes ("zero-shot"), with no training on this data. This project
  did not build the model. It put it into production and built the system that
  scores it.
- **AR-168**, a classic statistical model: a linear regression on the last 168
  hourly price changes, refitted every day. It is ported from the author's
  diploma thesis.
- **Naïve**, yesterday's price for the same hour. It is the yardstick the
  others are measured against.

The record goes back to 2020. Up to 2026-10-13 it is a backtest, forecasts
made after the fact by code that could only see the prices published before
each day it forecast. From 2026-10-14 every forecast is made before its price
exists. Both are scored the same way.

## Why the numbers can be checked

- **A model cannot peek at the answer.** It gets the price history cut off at
  the start of the day it forecasts, and nothing else: no files, no clock. A
  test checks that changing the future prices changes no forecast.
- **Nothing is left out.** 2022, negative prices and the clock-change days are
  in every figure, and any day can be opened on the dashboard. A button finds
  the worst one.
- **The headline model was chosen before any result was seen**, not because
  it won.
- **The record is in git.** Prices and forecasts are CSV files in
  [`data/`](data/), every figure is recomputed from them on each deploy, and a
  forecast made before its price was published is never replaced.

The full list and the model details are in
[The record in detail](docs/the-record.md).

## How it works

```
ENTSO-E ──► daily run ──► data/*.csv ──► export ──► dashboard.json ──► dashboard
           (GitHub Actions)  (in git)                                (Cloudflare)
```

Every afternoon a GitHub Actions workflow fetches the newest prices from the
ENTSO-E Transparency Platform, where Europe's grid operators publish market
data. Each model then forecasts the next unpublished day, and the workflow
commits prices and forecasts to `data/`. That commit triggers a deploy, where a script recomputes
every figure into one JSON file and the static dashboard reads it. There is no
database and no server.

| Directory | What it is |
|---|---|
| `forecast/` | Python: fetching prices, the models, backtests, the daily run, the export |
| `web/` | TypeScript: the dashboard, a static site on Cloudflare |
| `data/` | The two records, observed prices and forecasts, as CSV |
| `docs/` | Reader docs, developer docs and the decision records |

## Run it locally

You need [Node 22+](https://nodejs.org) with
[pnpm](https://pnpm.io/installation), and
[uv](https://docs.astral.sh/uv/getting-started/installation/).

```sh
pnpm install
uv sync --project forecast
uv run --project forecast python -m forecast.export # writes web/public/dashboard.json
pnpm --filter @cz-epf/web dev                       # the dashboard, on Vite
```

The checks, CI, backtests and the daily run are in
[Development](docs/development.md).

## Further reading

- [Reading the figures](docs/reading-the-figures.md): every metric and chart,
  in plain language.
- [The record in detail](docs/the-record.md): a dated snapshot of the results,
  the models, and how the record is kept honest.
- [Development](docs/development.md): building, testing, CI and the daily run.
- [`data/README.md`](data/README.md): where the prices come from and how they
  are stored.
- [`CONTEXT.md`](CONTEXT.md): the glossary, and the definition of record for
  every term and formula.
- [`docs/adr/`](docs/adr/): why each design decision was made.
- [Provisioning](docs/provisioning.md): the accounts and secrets the project
  needs.

## Data, attribution and take-down

Electricity price data sourced from the
[ENTSO-E Transparency Platform](https://transparency.entsoe.eu/). ENTSO-E does
not endorse this project and is not responsible for its content or for any
forecasts derived from the data.

ENTSO-E performs no control on the accuracy, currency or consistency of the
data published on the Transparency Platform, and this project uses it under its
own responsibility (Transparency Platform General Terms and Conditions,
clause 6). The series is the day-ahead price for `BZN|CZ` (Transparency
Regulation article 12.1.d), from delivery day 2018-01-01, committed unaltered
in `data/` with its provenance in `data/NOTICE` and `data/README.md`.

**Take-down.** On a request from ENTSO-E or from the Primary Owner of Data, the
observed price series will be withdrawn from public display promptly and
without argument. The dashboard would then keep its forecasts and accuracy
figures, which are this project's own output, and stop showing the prices they
were scored against.

**Maintainer contact:** [Adam Zedníček on GitHub](https://github.com/Zednicek-Adam),
or an issue on this repository.
