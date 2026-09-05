---
status: accepted
---

# Ingest reconciles gaps, and the daily run forecasts two days out

One scheduled job per day, at **~14:30 `Europe/Prague`**, does three things in
order:

1. **Ingest** — reconcile every missing delivery day against ENTSO-E, which at
   that hour lands the prices for **D+1** (published 13:10 on D, per issue #14).
2. **Score** — the observed prices for D+1 have now arrived, so the forecast for
   D+1, written by the *previous* run, becomes scorable.
3. **Forecast** — write a new forecast for **D+2**, the next delivery day whose
   price is not yet published.

Each run therefore scores exactly the forecast the run before it made, and the
store always holds exactly one unscored forecast. If step 1 cannot close every
gap, steps 2 and 3 do not run.

## The horizon is D+2, and it costs nothing

The map's opening constraint said D+1. It is D+2, and that is a consequence of
running once rather than a change of ambition.

ADR-0002's cutoff for target day T is *every delivery period starting strictly
before T begins in `Europe/Prague`*. For T = D+2, that is everything through
D+1 23:00 — **exactly what the store contains** the moment step 1 finishes. The
wall clock and the data boundary coincide: the runner never holds a period it is
not allowed to use, so there is nothing for the cutoff to exclude. Targeting D+1
instead would leave the runner sitting on D+1's prices and depending on the
filter to discard them — honest by enforcement rather than by absence — and
would force a second job into the narrow window before 13:10.

The information set is defined relative to T, not to the clock, so in both
schemes the model forecasts 1–24 periods beyond its last observation. D+2 buys
**~23 hours of lead over the answer instead of ~2, at no accuracy cost**, and
needs no interface change: `forecast(history, target_day)` already takes the day
as a parameter. That seam is what makes the horizon a configuration choice.

For most of its unresolved life the standing forecast is for *tomorrow*: it is
written at 14:30 on D and its prices publish at 13:10 on D+1, so roughly 13 of
those 23 hours fall after midnight on D+1. The defining property is
**unpublished**, not *two days out*.

## Ingest reconciles; it does not re-fetch

A run computes which delivery days have no stored periods and fetches only
those. It never re-reads a day that is already complete.

This is one rule doing four jobs. Dropped and delayed firings self-heal with no
catch-up logic. Backfill stops being a capability and becomes a parameter — the
whole 2025-01-01 → present gap is **two HTTP requests** (measured: A44 for CZ
over a full year returns 366 TimeSeries and 2.4 MB in one call; a two-year range
returns HTTP 400, so one year is the cap). A stored day is never re-read, so
ADR-0005's raise-on-conflict cannot fire twice and wedge every subsequent run.
And the frozen 2018–2024 rows are simply never touched.

The accepted cost, stated plainly: **we do not detect revisions.** Issue #14
measured 23 restatements in a month with zero changed values, scored history is
immutable under ADR-0002, and no version history, revision table or
"this value changed" surface exists anywhere in the system.

Duplicate `TimeSeries` are deduplicated **before** the insert. They are not rare:
2026-01-01 → 2026-09-06 returns 279 TimeSeries for 248 delivery days. They agree
value-for-value, so ADR-0005's conflict rule would never catch them.

## Repair is a second, human-only entry point

ADR-0005 says a conflicting value raises and never overwrites. That rule is
narrowed here to: **no automated path ever overwrites an observed price.**

A separate operator-invoked workflow takes an explicit delivery-day range,
re-fetches it, and may overwrite. It never runs the forecast. A human, a named
range and an Actions run record is not a silent rewrite, and this is the escape
hatch that lets the automated rule stay absolute.

**Forecasts have no such hatch.** A `live` forecast is never re-forecast as
live: a missing or bad live day is regenerated as a `backtest` row for that
delivery day. Live rows stay immutable and append-only — ADR-0005's
delete-and-reinsert per `(model, run_type, delivery_date)` is permitted for
`backtest` and forbidden for `live`, which is the one-liner ADR-0002 predicted.
A hole in the live record stays a visible hole while the backtest series covers
the day.

There is no wall-clock gate on the forecast. Look-ahead is already unreachable
through the cutoff, so a gate would only have bought optics; retries and late
firings are fine.

## What is fetched, and from where

**ENTSO-E Transparency Platform, single source of record, no fallback.** ČEPS is
explicitly *not* held as a hot standby: a fallback that is never exercised is an
untested parser and a second unresolved licence question. If ENTSO-E is
unavailable at 14:30, the answer is to retry, not to write another publisher's
numbers into the same column.

**The price only.** The live branch is univariate for the same reason v1 is.
Issue #14 proved the load forecast publishes at 10:05 on T-1 with ~3 h of
headroom, so unlike the generation forecast it *is* available in time — but no
model in ADR-0003's roster consumes it, ADR-0005 has no table to put it in, and
issue #13 measured the whole exogenous block at ≤0.1 EUR/MWh for the AR family.
Adding it is a modelling decision that must first show it pays; it stays cheap
because it is a new table and an insert, not a reshaping.

**Parsed rows only. No payload store.** Provenance is `source` + `retrieved_at`
per ADR-0001. The debugging case a payload table would serve is served better by
re-fetching, since the API reaches back to 2015 and the price provably does not
change. The real hazard is `curveType A03` carry-forward — a missing position
means the previous value continues, not a hole — and that is defended by
committed XML fixtures in the test suite: a 23-point 24-hour day, a 100-point
fall-back day, and a duplicated-TimeSeries day.

## The Average Rule price is derived on the way in, and stored

After delivery day 2025-10-01 the CZ day-ahead price is `PT15M` only; issue #14
confirmed no `PT60M` series hides behind a market agreement. So the hourly price
that every model and the entire frozen record speak has to be derived by us.

Ingest stores **both**: the quarter-hourly rows as published, and the derived
hourly rows carrying `derivation = 'average-rule'` — the column ADR-0005
deferred, now due. Storing only the quarter-hours and averaging at read time is
the shape ADR-0005 already rejected once when it chose to *store*
`repaired_observed_price` rather than recompute it, so that runner and API cannot
drift; this is the same problem with the same answer. Storing only the derived
hourly price would discard the published fact and break ADR-0001's
true-market-periods rule.

The derived series is treated as a continuation of the traded hourly series, and
the models train across the 2025-10-01 break as one object.

## The frozen rows are never re-fetched

The 2018–2024 dataset came from GUI exports (`source = entsoe-tp-gui-export`)
and the API can serve the same period, but those rows are proven byte-exact
against the thesis parity oracle (issue #21) and every published backtest number
is scored against them. Making provenance uniform is not worth silently churning
the record the scoreboard rests on. Instead a one-time check fetches the overlap
and asserts equality, kept as a test rather than a write. `source` stays
heterogeneous on purpose — that is what the column is for.

## What one run promises

A run succeeds only if it wrote **complete** delivery days. The period count is
read from the document, never assumed: 14 days in 2,557 are not 24 hourly
periods, and post-break daylight-saving days are 92 or 100 quarter-hours. A
missing document, a short day, an unparseable point sequence or a value conflict
rolls the whole transaction back and fails the run, inheriting ADR-0002's
"24 rows land in one transaction; missing history raises and writes nothing".
No partial delivery day ever reaches the store.

Because ingest reconciles, **a failed run leaves no trace in the database** — the
day is simply still missing and the next run picks it up. That is deliberate; it
is why ADR-0002 has no `run` table and ADR-0005 dropped `ingest_runs`. It also
hands issue #15 a precise obligation: ingest failure cannot become visible
through the store, so it must become visible through the runner's own surface.

Forecast failure is different. It leaves a **gap in the live series**, on the
dashboard, because the next day's run targets D+3 and nothing backfills it as
live. The live record shows its own misses.

## Consequences

`produced_at` joins the forecast row — operational provenance mirroring
`retrieved_at` on observed prices, additive, and unretrofittable for the same
reason ADR-0001 carried `retrieved_at` from day one.

Issue #15's "one workflow or two, and what the second does if the first failed"
dissolves: one job, three steps, later steps gated on the earlier ones. What
remains there is the trigger, DST, repo visibility and failure visibility.

ADR-0006 named "no minimum-sample rule" as a gap the live branch inherits. It is
now concrete: on its first day the live scoreboard carries an MAE over one
delivery day, and `run_type` is still surfaced nowhere. That is a display
decision for the live branch, not this ADR.

Live scoring appends a forecast day and then rebuilds derived rows whole, per
ADR-0010 — `model_comparison`'s Diebold–Mariano rows are pairwise, so no
incremental per-model metric update is well-defined.
