# The record in detail

The results as of 2026-10-13, and the long version of the README's models and
"why the numbers can be checked" sections. The live figures are on the
[dashboard](https://cz-epf.adam-zednicek123.workers.dev). What each metric means and how it is computed is in
[Reading the figures](reading-the-figures.md); the definitions of record are in
[`CONTEXT.md`](../CONTEXT.md).

## Backtest and live forecasts

**Most of the record is a backtest, and its newest day is a forecast.** Every
forecast for a delivery day up to 2026-10-13 was produced after the fact, by
models that could see only the prices published before the day they forecast.
From 2026-10-14 on, the daily run forecasts each delivery day before its price
is published, two days ahead. Both kinds are scored the same way and pooled
into one record (ADR-0016), and each row of
[`data/forecasts.csv`](../data/forecasts.csv) says which kind it is. The one
forecast whose price is not published yet is the pending day, and the
dashboard opens on it.

**rMAE here is not comparable to published electricity-price-forecasting work,
to the thesis this project builds on, or to figures from any other test
window.** It is measured against a day-lag naïve (the same hour on the previous
day) rather than the literature's seasonal naïve, and over this record only.

## What the record shows

Three models over the record from 2020-01-01 to 2026-10-13, 2,478 delivery
days, every delivery period counted:

| Model | MAE | RMSE | SMAPE | rMAE |
|---|---|---|---|---|
| Chronos-2 | 17.1 | 29.4 | 22.8 | 0.654 |
| AR-168 | 20.6 | 34.0 | 26.2 | 0.786 |
| Naïve | 26.2 | 44.0 | 33.7 | 1.000 |

The dashboard's figures move with every daily run; these are as of 2026-10-13.

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

## The models

Three models, all univariate, on the roster in `CONTEXT.md` (ADR-0003):

- **Chronos-2** (`chronos2`), Amazon's pretrained forecasting model, used
  zero-shot on the price history alone, CPU and float32, with an 8,192-hour
  context. It is the headline model, chosen before any result was read. It is
  a pretrained foundation model put into production here, not a model invented
  here: what this project built is the system around it. Its weights are
  `amazon/chronos-2` at the pinned revision
  `29ec3766d36d6f73f0696f85560a422f50e8498c`, downloaded at run time, so the
  record cannot move under it. Building it needs `uv sync --extra chronos`, and
  it never runs in the pull request gate.
- **AR-168** (`ar168`), an autoregression on a week of hourly lags of the
  differenced price. A hand-written port of `ar_lm_predict` from the author's
  diploma thesis repository,
  [`epf-diploma`](https://github.com/Zednicek-Adam/epf-diploma)
  (`models/_utils.R`, run by `models/R/AR168.R`; private). No history was
  transplanted from it, and the bar for the port is its specification, not the
  thesis's output.
- **The day-lag naïve** (`daylag`): yesterday's price for the same hour. It is
  what rMAE divides by, which is why its own rMAE is exactly 1.

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
