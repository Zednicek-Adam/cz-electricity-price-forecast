# Reading the figures

What every number on the dashboard means and how it was produced, for a reader
who wants to check it rather than trust it.

This page is a plain-language reading of [`CONTEXT.md`](../CONTEXT.md), which
is the definition of record for every term and formula here. If the two ever
disagree, `CONTEXT.md` is right and this page is wrong.

## What the record is

A **backtest** over 1,827 delivery days, 2020-01-01 to 2024-12-31, for every
model, with nothing excluded. The 2022 energy crisis is in, and so are negative
prices and the daylight-saving days. The window starts in 2020 because AR-168
needs two years of history, and the price record opens on 2018-01-01. Chronos-2
could have started earlier but doesn't: a model scored over a different stretch
of days would not be part of the same comparison.

Each forecast was made for one **delivery day** (a calendar day in
`Europe/Prague`) using only the prices of delivery periods that start before
that day begins. That limit is part of how the code works, not a rule anyone
has to remember to follow. A model is handed its history as a value and can see
nothing else: no database, no clock, and nothing from the day it is
forecasting. So the forecasts are honest even though the prices they are scored
against were already known when they were made.

Every price is in **EUR/MWh**, the unit the market clears and publishes in.
Nothing is converted.

## The 24-hour grid, and the two days a year that don't fit it

A delivery day normally has 24 hourly delivery periods, but when the clocks
change it has 23 (spring) or 25 (autumn). The models work on a regular 24-period
grid, so those days are **grid-repaired** before any model sees them:

- **spring forward:** the missing 02:00 is interpolated linearly, as the mean of
  01:00 and 03:00;
- **fall back:** the two periods labelled 02:00 are averaged into one.

The repair is lossy and done in exactly one place. The stored record keeps the
true 23 or 25 periods; the repaired prices are stored beside them and are what
the models are fed and what their forecasts are scored against. Across the
backtest window that means five hours scored against interpolated prices and
five against averaged pairs. The Day view draws daylight-saving days on the
repaired grid without comment, because that is the comparison that actually
happened.

## The models

| Model | What it is | Where it comes from |
|---|---|---|
| **Chronos-2** | Amazon's pretrained time-series model, used zero-shot on the price history alone. The headline model | `amazon/chronos-2`, pinned to an explicit revision, run on CPU. Joins in phase 4 |
| **AR-168** | Least squares on the last 168 hourly changes in price, fitted afresh each day on the previous 730 days, forecast 24 hours ahead step by step | A port of the author's diploma thesis code |
| **Naïve** (day-lag naïve) | Yesterday's price for the same hour | — |

The **headline model**, the one the dashboard leads with, was fixed as
Chronos-2 before any result was read, so it is not the one that happened to
win.

Every stored forecast carries its **`model_version`** (a specification string,
or the pinned Chronos-2 revision) and its **`code_version`** (the git commit
that produced it). Between them they explain why a number would ever change.

## The metrics

With `e = observed − forecast` over the delivery periods in scope:

| Metric | Formula | Unit | Shown to |
|---|---|---|---|
| **MAE** | `mean(|e|)` | EUR/MWh | 1 decimal |
| **RMSE** | `sqrt(mean(e²))` | EUR/MWh | 1 decimal |
| **SMAPE** | `200 × mean(|e| / (|observed| + |forecast|))` | 0 to 200 | 1 decimal |
| **rMAE** | `MAE(model) / MAE(naïve)` | ratio | 3 decimals |

The precision is deliberate. The second decimal of an MAE is noise next to the
gaps of one to three EUR/MWh between models. rMAE needs three decimals because
the interesting differences sit in the second and third.

**rMAE and the naïve.** rMAE is a model's MAE divided by the naïve's over the
same span. Below 1, the model beat yesterday's prices; above 1, it did worse.
The naïve's own rMAE is exactly 1, which is why it sits in the accuracy table as
a row of its own. Where the naïve's MAE over a span is zero, the ratio is
undefined and no figure is published.

The naïve here is the **day-lag** naïve, not the **seasonal** naïve (a week
back on Mondays and weekends) that the electricity-price-forecasting literature
uses. It is easier to explain, and on weekends it is a weaker benchmark, so rMAE
on this dashboard reads better than it would against the literature's standard.
**These figures are not comparable to published EPF results, or to the thesis's
own.**

**SMAPE near zero.** SMAPE divides by `|observed| + |forecast|`, which gets small
wherever the price is near zero, and Czech prices do go to zero and below. In
the backtest window 88 of the scored delivery periods are at exactly 0.00
EUR/MWh and 903 within 5 EUR/MWh of it, so a handful of hours can dominate the average. Where
both the price and the forecast are exactly zero, the ratio counts as 0 rather
than being undefined. SMAPE is shown because it is standard, not because it
suits this series; MAE and rMAE are the steadier guides.

**Per day, per span, running.** A figure over several days pools the delivery
periods, so it is not an average of the daily figures: a volatile day with big
errors weighs more than a calm one. The **Over time** view plots the **running**
figure, meaning the metric over every delivery period from 2020-01-01 up to and
including each day. It shows the whole-record figure settling as days
accumulate. The climb through 2022 is the crisis, which is priced into every
headline figure rather than managed out of it. The running rMAE is the running
MAE of a model divided by the running MAE of the naïve, not an average of daily
rMAEs.

Per-day rMAE is noisy. On a calm day the naïve's error can be close to zero, so
the ratio for that day can be very large or very small without meaning much.
The running and whole-record figures are the stable versions.

## Is one model really better? The Diebold–Mariano card

The **Diebold–Mariano test** asks whether one model's errors are significantly
smaller than another's, rather than smaller by luck. It runs separately for each
hour of the day, on absolute errors (so it tests what MAE ranks), comparing the
two models over every day of the backtest.

The card plots the test **statistic** for each hour. Negative means the selected
model's errors were smaller; the further from zero, the clearer the separation.
The reference lines at **±1.96** mark the two-sided 5% level: a point beyond
them is a difference unlikely to be chance. The stored tests are one-sided,
whose 5% threshold is 1.645, so the ±1.96 lines are the stricter bar. Nothing is
drawn as significant that isn't. An hour where the test could not be computed
is left blank.

## Where the numbers come from

Every figure on the dashboard is computed once, when the forecasts are made,
and stored. The site reads it back and does not recompute it per visit, so
everyone sees the same number. The one exception is the Over time view's
running figure, which the API builds from the stored daily figures when asked.
The code for all of it is in this repository: the metrics in
`forecast/src/forecast/metrics.py`, the running figure in `api/src/running.ts`.
