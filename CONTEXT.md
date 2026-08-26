# CZ Day-Ahead Price Forecast

A public dashboard that forecasts the day-ahead electricity prices for the Czech
bidding zone and scores its own forecasts against the market outcome once it is
known. This glossary fixes the vocabulary that the schema, the API and the UI all
inherit.

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
delivery day 2025-10-01 onward is one. Not a continuation of the traded hourly
series — a different object that shares its shape.

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

**Forecast run**:
One execution of **one model** for **one delivery day**, producing 24 forecasts.
Its model is a pure function of the history it is handed and the day it is asked
about — it holds no store connection and no clock, so it cannot read past its
cutoff. Every run is marked `backtest` or `live`, and the two are never pooled
into one accuracy figure. See ADR-0002.
_Avoid_: batch, job, execution

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
holds no store handle, no provider and no clock. v1 has exactly three — the
day-lag naïve, AR-168 and Chronos-2. See ADR-0003.
_Avoid_: predictor, algorithm, estimator

**Runner**:
What drives models. It owns the day loop, slices history at the cutoff, and
writes the forecasts. Everything a model is not allowed to touch lives here, so
it is also the single thing the live cutover changes. See ADR-0002.
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
the published convention — so rMAE is always rendered "vs day-lag naïve", never
bare. See ADR-0003.
_Avoid_: naïve, benchmark, baseline (unqualified)

**Backtest**:
A forecast run replayed over a delivery day whose observed price is already
known, honest only because the cutoff is enforced structurally rather than
asserted. Every forecast v1 shows is one.
_Avoid_: simulation, replay, hindcast

**Scoreboard**:
The standing record of how every model has done, measured against the day-lag
naïve and against the observed prices it was scored on. It is the product: the
dashboard exists to show it, and it is self-verifying because the ground truth
arrives independently of the forecast.
_Avoid_: leaderboard, results, performance

**Published metric**:
An accuracy figure with a fixed definition, computed once when the forecasts it
describes are written, and thereafter read rather than recalculated. Every number
the scoreboard shows is one, so all readers see the same figure computed the same
way. See ADR-0004.
_Avoid_: stat, score, aggregate

**Grid repair**:
The transformation that turns the true, irregular record of a daylight-saving
delivery day into the regular 24-period grid the models require: the fall-back
day's two overlapping periods averaged into one, the spring-forward day's missing
period linearly interpolated. It is lossy, it belongs to the model layer, and it
is never applied to stored observed prices. See ADR-0001.

**Provenance**:
Where an observed price came from and when it was retrieved. Carried on the row,
because it cannot be reconstructed after the fact.
_Avoid_: origin, lineage
