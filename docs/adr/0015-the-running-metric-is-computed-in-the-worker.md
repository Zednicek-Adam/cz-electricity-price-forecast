---
status: accepted
---

# The running metric is computed in the Worker, from the per-day rows

The Over time view plots the **running metric** (`CONTEXT.md`): for each
replayed delivery day, the accuracy over every delivery period from 2020-01-01
up to and including that day. ADR-0007 made it the hero chart's second view
and left open where it comes from. ADR-0005's `published_metric` stores four
scopes (`overall`, `year`, `month`, `delivery_day`), and the running metric is
none of them.

**The Worker derives it on each request, by scanning the `delivery_day` rows of
`published_metric` in date order.** `published_metric` stays exactly as ADR-0005
wrote it. There are still four scope types, there is no `scope_end` column, the
primary key is unchanged, and the running series is not written at all, which
saves about 22,000 rows.

## This is an exception to ADR-0004, taken on purpose

ADR-0004's standing rule is that **the request path never computes**: the
replay writes published metrics and the API selects them. This decision breaks
that rule, and it is recorded as a break rather than argued away.

It is taken on two judgements.

- **The volume is trivial.** One request scans at most 1,827 days × 3 models =
  5,481 rows of one metric, and does one pass of additions over them. That is far
  inside a Worker's 10 ms CPU ceiling. It adds no aggregate over the 131,544
  forecasts to Neon's CU-hour budget, which was the rule's real concern. It
  reads rows that are already published and computes nothing a published metric
  does not already contain.
- **Storing it widens the schema for one read model.** See the first rejected
  option below.

The exception is narrow. **The running series is the only figure on the
dashboard derived at read time.** Every other number, including every headline
number and every accuracy-table cell, is still a stored published metric read as
is. A second read-time derivation needs its own ADR, not a precedent from this
one.

## The derivation, written for whoever implements the endpoint

A running figure is a cumulative sum divided by a cumulative count of delivery
periods. It is **not** a running mean of per-day figures. For each model, walk the
`delivery_day` rows in `scope_start` order and keep running totals, using each
row's `n_forecasts` as its weight `n`:

| Metric | Carry per day `d` | Running value up to day `D` |
|---|---|---|
| `mae` | `n_d × mae_d` | `Σ n_d × mae_d / Σ n_d` |
| `rmse` | `n_d × rmse_d²` | `sqrt(Σ n_d × rmse_d² / Σ n_d)` |
| `smape` | `n_d × smape_d` | `Σ n_d × smape_d / Σ n_d` |
| `rmae` | the running MAE of the model and of `daylag` | `running_mae(model) / running_mae(daylag)` |

These are exact, not approximations. MAE and SMAPE are means of a per-period
quantity, so a day's mean times its count gives back the day's sum. RMSE's
per-day value squared, times its count, gives back the day's sum of squared
errors.

**The trap is rMAE.** Running rMAE is **the ratio of two running MAEs**. It is
**not** a running mean of the per-day rMAEs. The two differ badly on this series.
Per-day rMAE ranges from 0.07 to 3.73 (ADR-0007), because on a flat day the
naïve's denominator nearly vanishes, and one such day would drag a mean of
ratios. A ratio of cumulative sums weights each day by its actual error, which is
what the whole-record rMAE does. Consequently the `daylag` row's running rMAE is
exactly 1 on every day, not approximately 1.

Two invariants follow and are cheap to assert in the endpoint's tests:

- On the last replayed day, the running value equals the stored `overall` row for
  the same model and metric, up to `numeric` rounding.
- The running rMAE of `daylag` is 1 on every day.

Every `delivery_day` row on the repaired grid has `n_forecasts = 24`, so a
reader may notice the weighting changes nothing today. It is kept because it is
what "a cumulative sum divided by the count of periods" means, and it stays
correct if a day ever has a different count, for example at 15-minute
resolution on the live branch.

## Considered options

**Store it: `scope_type = 'running'` rows, written by the replay.** This was the
spec's recommendation and was rejected. `scope_start` is defined as *the first
delivery day the scope covers*, and for a running figure that is always
2020-01-01. The varying end is the whole point, so storing it needs a new
`scope_end date` column and a primary key widened to include it. That amends
ADR-0005 for one read model and writes about 22,000 rows that are a pure function
of 5,481 rows already stored. It would keep the request path free of
computation, but that is not worth a key change to the one table whose long
shape was chosen so that new slices are inserts rather than migrations.

**Compute it in the client.** Rejected outright. It moves an accuracy
computation into the browser straight after ADR-0004 deliberately moved accuracy
out of it. It would also ship the per-day series of all three models for all four
metrics to every visitor, for a chart that shows one metric at a time.

**A SQL window function in the query** (`sum(...) over (order by scope_start)`).
Not a separate option. It is this decision with the arithmetic moved into
Postgres, and it spends the Neon budget ADR-0004 was protecting instead of Worker
CPU, which is free at this volume. Either is defensible. The Worker is chosen
because the derivation then sits in TypeScript next to its tests, where the rMAE
trap above is visible, rather than inside a query string.

## Consequences

- **`published_metric` needs no change from ADR-0005.** Issue #42's migration
  writes the table exactly as ADR-0005 wrote it.
- **The Over time view's endpoint (issue #50) carries the derivation above,**
  with the two invariants as its tests. It is the only endpoint that computes.
- **The ribbon's endpoint does not compute.** It returns the headline model's
  `delivery_day` rows for the selected metric as they are stored. That is why it
  is a separate endpoint and a separate series (ADR-0007, as corrected).
- **`CONTEXT.md`'s "every number the scoreboard shows is a published metric" is
  narrowed:** the running metric is derived from published metrics rather than
  being one. The glossary records that.
