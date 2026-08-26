---
status: accepted
---

# A forecast run is one model, one delivery day, behind a pure-function seam

A **forecast run** is one execution of one model for one delivery day, producing
24 point forecasts. The model is a pure function of the history it is handed and
the day it is asked about; it holds no connection to the store, no provider and
no clock. Its only access to data is its argument, so a run cannot read anything
outside its cutoff — look-ahead is unreachable rather than forbidden.

The **cutoff** is a data-availability boundary derived from the target delivery
day, not a wall-clock instant. For the price series it is: every delivery period
starting strictly before the target delivery day begins in `Europe/Prague`. Whole
days in, whole days out.

The seam is approximately:

```
run_forecast(model, target_day, provider) -> run

provider : target_day -> history-as-of-cutoff        # the adapter
model    : (history, target_day) -> 24 forecasts     # pure
```

The provider is the only thing that changes when live data arrives: frozen file
today, database read next, live API on the live branch. A backtest run and a live
run are the same call — the model never learns which it is in.

## Considered options

**Cutoff as a wall-clock instant**, with history filtered to rows that had
published by it. Rejected as unavailable rather than merely worse: the frozen
dataset carries no publication timestamps, and ADR-0001's `retrieved_at` records
when *we* fetched a row, which for a 2018 price is 2026. Running this over the
backtest would mean synthesising a `published_at` for all 61,368 rows from a rule
like "prices for day X publish 12:45 on X−1" — which is this decision's rule,
wrapped in a timestamp comparison that can only ever return the same answer, plus
a new failure mode where the synthesised times are subtly wrong.

**Handing the model a history provider** (the shape first sketched for this
ticket, alongside an explicit `cutoff` argument). Rejected on both counts. A
provider is a live handle, and anything holding one can ask it a second question
— including for the target day itself; passing history by value is what makes the
cutoff structural instead of a discipline applied at every call site. And an
explicit `cutoff` is derivable from `target_day`, so supplying it only creates the
possibility of the two disagreeing — silently, and always in the direction of more
data.

**A run spanning all models for a delivery day.** Rejected on three counts. Issue
 #8 has not decided which models survive, and under this grain every historical
run becomes incomplete the moment the model set changes. The cost spread is
extreme — 0.39 s/day for Chronos-2 against 57 s/day for the DNN, which over 1,827
days is 12 minutes against 29 hours — and this grain welds them into one unit of
work that fails as one. And one model failing on one day would put an asterisk on
every other model's forecast for that day.

The cost accepted: "all models on delivery day D saw the same history" stops being
structurally guaranteed. It survives because the cutoff is a function of the
target day rather than of the execution, so it is reproducible regardless of when,
or in what order, runs happen.

**Prediction intervals in v1.** Deferred. The thesis emits point forecasts and its
golden files are point-valued, so intervals are new work outside the parity story.
Chronos-2 could produce quantiles natively; LEAR and the AR family could not
without real effort, and a scoreboard where some models carry intervals and others
do not is worse than one where none do. A nullable quantile column is a cheap
additive migration, so nothing unretrofittable is given up. See issue #10.

**Excluding or specially flagging 2022.** Rejected — see Consequences.

## Consequences

### The forecast table diverges from ADR-0001, deliberately

A run always emits **24 forecasts**, on the regular grid produced by grid repair.
Nothing is dropped on the spring-forward day and nothing is duplicated on the
fall-back day. Consequently the forecast table **cannot** use ADR-0001's
`delivery_start timestamptz` key: on a spring-forward day the local label 02:00
corresponds to no instant in `Europe/Prague`, so that row has nowhere to go.

Forecasts are therefore keyed in market coordinates on the repaired grid:

```
(delivery_date, period_ordinal, model, run_type)   -- unique
```

Unique, so there is exactly one number per model per delivery period per kind. The
two tables sit in different coordinate systems by design — observed prices in true
market periods keyed by instant, forecasts on the repaired grid the model works in
— and **scoring is a join across a grid repair, not a direct key join**. The
repair function is reused at read time on the observed side. ADR-0001 assumed the
simpler join; issue #11 inherits this. Grid repair remains entirely in the model
layer, in both directions.

### Evaluation ground truth is the repaired 24-grid

Forecasts are scored against the same repaired series the model was fed, not
against the raw store. The model is judged in the world it works in, and every
number stays directly comparable to the thesis. Across 2020–2024 this means five
hours are scored against interpolated values and five pairs against averaged ones
— a disclosure footnote for issue #10, not a metrics special case.

### What v1 replays

**2020-01-01 → 2024-12-31, every model, no exclusions.** 1,827 delivery days. The
start is forced rather than chosen: the calibration window is 730 days and the
dataset opens 2018-01-01, so 2020-01-01 is the first forecastable day. Matching the
thesis window exactly means any ported model should land near its published
number, which is a free correctness oracle over the whole pipeline.

Chronos-2 is zero-shot and needs no calibration window, so it *could* forecast from
early 2018. It does not. A model measured over a longer, differently-composed
period is not part of a comparison.

### 2022 needs no special handling

The crisis dominates MAE and does not survive into rMAE. Prices averaged 247.45
EUR/MWh in 2022 against 33.62 in 2020, and MAE follows the level — Chronos-2 scores
4.62 in 2020 and 33.44 in 2022, so one year in five carries roughly 40% of total
absolute error. But the seasonal naive blows up too (MAE 56.86 in 2022 against 6.58
in 2020), so the ratio normalises: Chronos-2's rMAE sits in a **0.588–0.721** band
across the five years, and **2022 is its best year** — a volatile regime is where a
real model beats a naive by the most.

So rMAE headlines, per-year MAE stays visible, and the crisis is part of the story
rather than a caveat being managed. Offering an "excluding 2022" headline would
invite the reader to think otherwise, and would buy a 25% improvement by deleting a
year. The standing rule: **no headline accuracy figure is computed over a silently
restricted period.** Any restriction is labelled on the number. See issue #10.

### Backtested and live are distinguished from day one

`run_type` (`backtest` | `live`) is recorded on every forecast row and the two are
never pooled into a single headline figure. Every forecast v1 shows is replayed,
and the dashboard says so. Getting this into the schema now is free; retrofitting it
once live rows exist is a migration plus a credibility problem.

Backtests are regenerable — they must be, since they are re-run throughout
development, and their honesty comes from the cutoff being structural and the code
deterministic, not from write-once storage. Whether a **live** forecast is immutable
is deliberately **not decided here**: v1 has no live rows to protect, and the rule's
real motivation is that retries and catch-up backfill produce look-ahead by default
on an unattended schedule. That is answerable once retry semantics exist. See
issues #19 and #15. The unique key means adding the rule later is "insert, do not
upsert" on a constraint that already exists.

### One headline model, chosen before the results are seen

The dashboard leads with exactly one model so the ten-second story (issue #12) has
a single line to draw, with the full comparison a scroll away. Which model is
**configuration** — not a schema concept, not a property of a run, and no
`is_headline` flag on any row, which would make historical rows lie every time it
changed.

The choice is frozen before the scoreboard is read. Picking the headline after
seeing which model won is a soft form of cherry-picking, and it is the difference
between a baseline and a survivorship-biased highlight reel. Provisionally
**univariate Chronos-2** (MAE 16.64, rMAE 0.643) — the honest ceiling on current
evidence, since no v1 model consumes `gen`. Issue #8 decides finally.

### Failure is loud

A run whose required history has a gap **raises and writes nothing**. No
forward-fill, no interpolation, no nearest-neighbour substitution. The frozen
dataset is gapless so this should never fire in v1, which is exactly why the rule
is set now: a silently stale input produces a forecast that looks normal, is
quietly wrong, and leaves no trace to detect afterwards. A missing day on the
scoreboard is honest; a fabricated one is not. This governs forecast-time inputs
and does not touch grid repair, which is a declared transformation of known-good
data.

A run's 24 forecasts are written in **one transaction**, all or nothing, so a crash
mid-write cannot leave a partial delivery day that the metrics then average over as
though complete.

There is **no `run` table**. A run is exactly one model × one delivery day × 24
rows, so `model`, `run_type` and `executed_at` on the forecast row carry its whole
identity; a separate entity would hold nothing the rows do not, and would need a
lifecycle for something that either succeeds or writes nothing. Issue #11 may add
one if the live branch needs run-level status — an additive migration.

### Deferred to the live branch

Late publication, degraded runs, retry semantics and catch-up backfill are not
decided here. They need real publication timing (issue #14) and the trigger design
(issue #15) to be answerable, and guessing now would bake in assumptions that would
have to be unpicked. The seam above is what keeps that deferral cheap: the live
cutover swaps one adapter.
