# CZ Day-Ahead Price Forecast

A public dashboard that forecasts the day-ahead electricity prices for the Czech
bidding zone and scores its own forecasts against the market outcome once it is
known. This glossary fixes the vocabulary that the records, the code and the UI
all inherit.

## Language

### Time and the market

**Bidding zone**:
The market area a price applies to. This project covers exactly one, `BZN|CZ`.
_Avoid_: region, market, country

**Delivery period**:
The atomic span of time a price attaches to — an instant it begins at, plus a
resolution. The unit everything else is keyed by.
_Avoid_: hour, timeslot, interval, MTU

**Delivery day**:
The local calendar day in `Europe/Prague` that a delivery period belongs to. A
delivery day has 24 hourly delivery periods, except across a daylight-saving
transition, where it has 23 or 25.
_Avoid_: date, trading day

**Period ordinal**:
A delivery period's position within its delivery day, counting from 1, for a given
resolution. Its upper bound is a property of the day, not a constant.
_Avoid_: hour number, index, slot

**Resolution**:
The length of a delivery period. Currently 60 minutes for the Czech day-ahead
market; 15 minutes from delivery day 2025-10-01 onward.
_Avoid_: granularity, frequency

**Average Rule price**:
An hourly price derived by averaging the four quarter-hourly prices of the same
hour, rather than cleared as an hourly product. Every Czech hourly price from
delivery day 2025-10-01 onward is one. It is derived on the way out of the
price record, which holds the quarter-hours as published, and carried as a
continuation of the traded hourly series. See ADR-0011 and ADR-0016.

### Prices and forecasts

**Observed price**:
The settled day-ahead price for a delivery period, as published by the market.
There is exactly one per delivery period. It serves both as ground truth for
scoring and as input to the models — those are two roles of one thing, not two
things.
_Avoid_: actual, actual price, real price, spot price, historical price

> "Actual" is avoided deliberately: it reads as Czech *aktuální* ("current") to a
> large part of this project's audience. It stays confined to metric formulas,
> where it is a term of art.

**Forecast**:
A predicted price for a delivery period, attributed to the forecast run that
produced it. There may be many per delivery period — one per model, per run.
_Avoid_: prediction, estimate

**Pending forecast**:
The one standing forecast whose delivery day's price has not been published yet,
so it carries no accuracy figure. There is exactly one at a time: each daily run
scores the forecast the previous *successful* run made and leaves a new one
pending. After a failed daily run that is the run from two days before, not
yesterday — the invariant is one pending forecast, not one per calendar day. It
is the only thing on the dashboard that is a claim rather than a record, and its
delivery day going stale is how a stopped daily run becomes visible. See
ADR-0012.
_Avoid_: live forecast (that is a `run_type`), current forecast, upcoming

**Forecast run**:
One execution of **one model** for **one delivery day**, producing 24 forecasts.
Its model is a pure function of the history it is handed and the day it is asked
about — it holds no file, no connection and no clock, so it cannot read past
its cutoff. Every run is marked `backtest` or `live`; the mark is provenance,
and accuracy figures pool the two into one record. See ADR-0002 and ADR-0016.
_Avoid_: batch, job, execution

**Daily run**:
The scheduled execution, once per calendar day, of ingest then scoring then
forecasting. It contains one forecast run per model, so it is the container and
not itself a run of anything. It is the system's only automated path: everything
corrective — repair, replay, restarting the schedule after it is disabled — is
human-invoked. See ADR-0011 for what it does, ADR-0012 for what fires it.
_Avoid_: job, cron, pipeline, daily forecast

**Cutoff**:
The boundary on what a forecast run may know, derived from its target delivery
day rather than from a wall clock: for the price series, every delivery period
starting strictly before the target delivery day begins in `Europe/Prague`. Whole
days in, whole days out. Each input series has its own rule; v1 has one series.
See ADR-0002.
_Avoid_: as-of time, knowledge date, information set

**Model**:
An object that turns history into forecasts. Construction does its setup once;
`forecast(history, target_day) -> 24 floats` is then called per delivery day and
holds no file, no provider and no clock. v1 has exactly three — the
day-lag naïve, AR-168 and Chronos-2. See ADR-0003.
_Avoid_: predictor, algorithm, estimator

A model is named on a forecast row by its **slug**, and these are the only
three: `chronos2`, `ar168`, `daylag`. The slug is free text in
`data/forecasts.csv`, so this list is the authority; the export refuses a slug
that is not on it.

**Runner**:
What drives models. It owns the day loop and slices history at the cutoff;
the replay and the daily run write what it returns. Everything a model is not
allowed to touch lives here. See ADR-0002.
_Avoid_: pipeline, orchestrator, job

**Headline model**:
The single model the dashboard leads with. A configuration choice, frozen before
the scoreboard is read, and never recorded on a forecast row. It is **univariate
Chronos-2** — a zero-shot pretrained model, called rather than fitted, pinned to
an explicit Hugging Face revision. See ADR-0003.

**Day-lag naïve**:
The benchmark every accuracy claim is measured against: the observed price for
the same period ordinal on the previous delivery day. It is a model like any
other, and it is also the v1 placeholder. It is deliberately *not* the seasonal
naïve standard in the forecasting literature, which makes rMAE here weaker than
the published convention. rMAE nevertheless **renders bare** on the dashboard:
what carries the meaning is this model's own row, sitting at exactly rMAE 1.000
beside the others, and the non-comparability disclosure lives in the README. The
interface labels it **"Naïve"**; the slug is `daylag` and prose outside the app
says day-lag naïve. See ADR-0003, ADR-0006 and ADR-0007.
_Avoid_: benchmark, baseline (unqualified)

**Running metric**:
An accuracy figure computed over every delivery period from the start of the
record up to and including a given delivery day — a cumulative sum divided by the
count of periods, not a rolling window. Plotted across the record it shows a
whole-period figure settling rather than a day being scored, which is how the
dashboard exposes the 2022 distortion without a per-year breakdown. The export
derives it from the per-day published metrics, and the running rMAE is the
ratio of two running MAEs, not a running mean of per-day ratios. See ADR-0007
and ADR-0016.
_Avoid_: rolling, moving average, cumulative metric

**Trailing metric**:
An accuracy figure computed over every delivery period in the 30 (or, for the
**week**, 7) calendar delivery days ending on a given delivery day, pooled exactly as the running
metric pools, its rMAE likewise the ratio of two windowed MAEs. It has no value
until a whole window fits inside the record. Where the running metric settles,
the trailing metric keeps moving, so it shows how the models are doing now. See
ADR-0017.
_Avoid_: rolling average, moving average, 30-day mean

**Profile**:
A model's accuracy over the whole record, the window or the week, grouped by
the weekday of the delivery day or by period ordinal. Each bucket pools its delivery periods as a
published metric does, and its rMAE is the ratio of the model's MAE to the
naïve's in the same bucket. See ADR-0018.
_Avoid_: seasonality, breakdown, hourly metric

**Price distribution**:
The spread of the repaired observed prices over a set of delivery periods,
summarised by its mean and its minimum, 10th, 25th, 50th, 75th and 90th
percentiles and maximum. The export computes one for each scored delivery
day, for each trailing span ending on one, and for each bucket of a profile,
over exactly the delivery periods the matching metric pools. It is not an
accuracy figure: there is no forecast in it. See ADR-0019.
_Avoid_: price stats, price profile

**Window**:
The last 30 calendar delivery days up to and including the last scored one.
With the **whole record**, it is one of the scoreboard's two **scopes**, and the
scope sets which days the accuracy table and the Diebold–Mariano card cover.
See ADR-0017.
_Avoid_: recent period, last month

**Week**:
The last 7 calendar delivery days up to and including the last scored one.
The history switch offers it; the scoreboard's scope switch does not. See
ADR-0018.
_Avoid_: last week (which suggests a calendar week)

**Backtest**:
A forecast run replayed over a delivery day whose observed price is already
known, honest only because the cutoff is enforced structurally rather than
asserted. Every forecast for a delivery day up to 2026-10-13 is one.
_Avoid_: simulation, replay, hindcast

**Scoreboard**:
The standing record of how every model has done, measured against the day-lag
naïve and against the observed prices it was scored on. It is the product: the
dashboard exists to show it, and it is self-verifying because the ground truth
arrives independently of the forecast.
_Avoid_: leaderboard, results, performance

**Published metric**:
An accuracy figure with a fixed definition, computed once per deploy by the
export from the whole forecast record, and thereafter read rather than
recalculated. Every number the scoreboard shows is one, so all readers see the
same figure computed the same way. See ADR-0004 and ADR-0016.
_Avoid_: stat, score, aggregate

**Grid repair**:
The transformation that turns the true, irregular record of a daylight-saving
delivery day into the regular 24-period grid the models require: the fall-back
day's two overlapping periods averaged into one, the spring-forward day's missing
period linearly interpolated. It is lossy, it belongs to the model layer, and it
is never applied to the observed prices in the record. See ADR-0001.

**Repaired observed price**:
The observed price series after the Average Rule and grid repair, on the
regular 24-period grid. It is derived from the price record whenever it is read,
by `forecast.loader` and nothing else, so grid repair has exactly one
implementation. It is what the models are fed and what forecasts are scored
against. See ADR-0001 and ADR-0016.
_Avoid_: repaired series (unqualified), model input, adjusted price

**Ingest**:
Bringing published observed prices into the price record. It **reconciles**: it works
out which delivery days are missing and fetches only those, so it never re-reads
a day it already holds and a missed day heals itself on the next run. Loading
years of history is the same act with a wider range, not a separate capability.
See ADR-0011.
_Avoid_: fetch, scrape, import, sync, backfill

**Repair**:
The deliberate, human-invoked re-fetch of a named range of delivery days, which
may overwrite what is stored. It is the only path that ever overwrites an
observed price, and it never produces a forecast. See ADR-0011.
_Avoid_: correction, fix, reconcile (that is what ingest does)

**Provenance**:
Where an observed price came from and when it was retrieved. Carried by the
record's history rather than its rows: `data/README.md` says which source each
range of delivery days came from, and the commit that added a day says when.
_Avoid_: origin, lineage

### Accuracy

Metric names are stored **unqualified** — `mae`, `rmse`, `smape`, `rmae` — so this
section is the definition of record for what each one meant. Transcribed from
`epf-diploma/models/_utils.R`; `e = observed − forecast` over the delivery periods
in scope.

The project's public documentation restates these formulas for a general reader.
That restatement is **derived**: this section stays the definition of record, and
where the two disagree the public document is the one that is wrong. See
ADR-0006.

**MAE** — mean absolute error, in EUR/MWh.

    MAE = mean(|e|)

**RMSE** — root mean squared error, in EUR/MWh.

    RMSE = sqrt(mean(e²))

**SMAPE** — symmetric mean absolute percentage error, scaled ×200, so its range is
0–200 rather than 0–100. Where `|observed| + |forecast| = 0` the ratio is taken as
0 rather than `NaN`, which is a real case here and not only a missing-data guard.

    SMAPE = 200 × mean( |observed − forecast| / (|observed| + |forecast|) )

**rMAE** — relative MAE, the ratio of a model's MAE to the benchmark's.

    rMAE = MAE(model) / MAE(day-lag naïve)

Both MAEs are taken over the same scope. Where the naïve's MAE over a scope is
zero, or it has none, the ratio is undefined and no figure is published.

The denominator is the **day-lag naïve** (ADR-0003), *not* the seasonal naïve the
electricity-price-forecasting literature uses. The formula is the thesis's; the
input is not, which is why these figures are not comparable to published EPF work
or to the thesis's own numbers. See the day-lag naïve entry for the disclosure
this obliges.

**Diebold–Mariano test**:
A pairwise test of whether one model's forecast errors are significantly more
accurate than another's. Run per **hour-of-day bucket** rather than over a date
range — the buckets are the grain — one-sided, on absolute loss, so it tests what
MAE ranks. Stored for both ordered directions, and the fixed reading is: **H₁ is
that `model_a` is more accurate than `model_b`**, so a small `p_value` means
`model_a` wins. The statistic is antisymmetric between the two directions; the
p-values are complementary, not negated. It is run twice, once over the whole
record and once over the window, with 30 observations per bucket. See ADR-0005
and ADR-0017.
_Avoid_: significance test, DM p-value (unqualified)

### The interface

**Hero chart** — the single chart the dashboard leads with, carrying four
views behind tabs: Day, Over time, By weekday and By hour (ADR-0007, ADR-0017,
ADR-0018). There is exactly one; a second chart competing with it is a design
error, not a feature. The **price chart** above it does not compete: it
follows the hero chart's cut and carries no model (ADR-0019).
_Avoid_: main chart, primary graph

**Price chart** — the chart above the hero chart that draws the observed
price's **price distribution** over the cut the hero chart's metric takes. Its
tabs and history switch are the hero chart's, drawn a second time on the same
state, so either chart's controls move both. It folds, and it is folded on the
Day view, whose chart is that day's price. See ADR-0019.
_Avoid_: price graph, second chart

**Day view** — the hero chart showing the **observed price** against all three
models over the 24 period ordinals of one delivery day, priced in EUR/MWh.

**Over time view** — the hero chart showing the three models' metric across
every scored delivery day: the **running metric** over the whole record, or the
**trailing metric** with the history switch on the window or the week. It carries no
observed line: on a metric axis the observed price is the zero the metric is
measured from, not a series.
_Avoid_: history view, trend view, 30-day view

**By weekday view** and **By hour view** — the hero chart showing each model's
**profile**: one line per model of the selected metric, across the seven
weekdays or the 24 period ordinals, over the history the switch selects.

**History switch** — the control choosing between the **whole record**, the
**window** and the **week** for the Over time, By weekday and By hour views
together. It sits in
the chart's bar and is separate from the scoreboard's **scope switch**
(ADR-0018).
_Avoid_: time filter, range picker

**Ribbon** — the selected metric for the headline model on every replayed
delivery day, drawn as one continuous filled area beneath the Day view. It is
**a control, not a picture**: clicking it jumps to that day, which is why the
dashboard has no separate accuracy-history visual. It is deliberately
mouse-only — see **day navigator**.
_Avoid_: sparkline, timeline, history strip

**Day navigator** — the set of controls that select which delivery day the Day
view shows: the ribbon, a date stepper, and **worst day / best day / random**,
all scoped to the selected metric. The stepper and the three buttons are the
navigator's **accessible** form and are load-bearing for that reason: the ribbon
is `aria-hidden` and keyboard-inert precisely because they duplicate its picker
function (ADR-0009). Removing them obliges making the ribbon a real slider.

**Metric selector** — the control choosing between MAE, RMSE, SMAPE and rMAE.
There are two, each placed beside what it changes (ADR-0017). The **Day view's**
sits in the day's accuracy panel and governs the day's headline numbers, the
ribbon and the day navigator, never the price chart. The other, shared by Over
time, By weekday and By hour, sits in the chart's bar beside the history switch
and governs the chart, and in Over time its headline numbers. The two are
separate choices.

**Scope switch** — the one control choosing between the **whole record** and the
**window** for the accuracy table and the Diebold–Mariano card together, so the
two always cover the same days.
