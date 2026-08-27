---
status: accepted
---

# The record discloses itself: no prose on the dashboard, no exclusions in the figures

> **Amended by [ADR-0007](0007-the-dashboards-ten-second-story.md).** Building the
> dashboard removed three of this ADR's rules: the hero triple, the
> per-year-breakdown-adjacent rule, and the rMAE qualifier. The rest stands.

The scoreboard leads with a **triple** — the headline model's MAE, the day-lag
naïve's MAE, and the rMAE ratio between them — scoped to the whole replay,
2020-01-01 → 2024-12-31. rMAE is the visually dominant element; the two MAEs are
what make the ratio checkable arithmetic rather than a claim.

Against that, the dashboard carries **no explanatory prose at all**: no
disclaimer, no backtest banner, no methodology page, no per-metric caveats. The
honesty this ADR is named for is carried by what the figures *are*, not by text
sitting next to them.

## Overall MAE never appears alone

The day-lag naïve's own MAE across the replay years:

| Year | 2020 | 2021 | 2022 | 2023 | 2024 |
|---|---|---|---|---|---|
| Naïve MAE (EUR/MWh) | 7.79 | 21.80 | 52.55 | 23.19 | 25.14 |

An overall MAE is therefore a statement about 2022's price level, not about a
model: one year in five carries roughly 40% of the total absolute error. rMAE
survives aggregation honestly — ADR-0002 measured Chronos-2 inside a 0.588–0.721
band across all five years — and MAE does not.

So the rule is **structural, not editorial**: wherever an overall MAE renders,
the per-year breakdown renders adjacent to it. This is the presentation half of
ADR-0002's ruling that no headline figure is ever computed over a silently
restricted period. Rolling windows (7/30/365 days) were rejected outright: on a
frozen backtest they mean "the tail of 2024" wearing a live system's costume.

## Which metrics render

| Metric | Where |
|---|---|
| `mae` | always |
| `rmae` | always |
| `rmse` | drill-down |
| `smape` | drill-down |

All four remain stored (ADR-0005); rendering is a separate question from
computing. SMAPE renders plain, with no inline caveat, despite degrading wherever
the price approaches zero — in-window that is 95 delivery periods priced at
exactly 0.00 and 903 under |5| EUR/MWh. The caveat lives in the public
documentation instead, because the dashboard carries no prose.

**Precision is part of the definition.** MAE and RMSE render to **1 decimal
place**, rMAE to **3**. The second decimal of a MAE is noise against model
separations of 1–3 EUR/MWh, and rendering `16.64` claims precision the estimate
does not have; rMAE needs three digits because the interesting spread lives in
the second and third.

**rMAE is qualified once per view**, not once per figure — the column header or
card group carries "vs day-lag naïve", which discharges ADR-0003's
never-render-bare obligation for every figure beneath it. ADR-0005 stores the
metric unqualified as `rmae` precisely so that this obligation lands here.

## The three surfaces

**The scoreboard.** All three models ranked together, with the day-lag naïve as a
row rather than a hidden denominator — its rMAE is 1.000 by construction, which
is what teaches the reader what the ratio means. Columns are model, MAE, rMAE.
`n_forecasts` is not shown. `run_type` is not surfaced: v1 has exactly one, and a
filter with a single value is UI debt.

**The significance view.** Its own view, built on `model_comparison`. Select a
model; two lines, one per opponent, plot `dm_statistic` on the y-axis against the
24 period ordinals on the x-axis, with horizontal reference lines at **±1.96**.

The statistic, not the p-value, is plotted: it is signed and antisymmetric, so
direction reads off the sign, and it shows *how* separated two models are rather
than whether a threshold was cleared. The ±1.96 lines are the **two-sided 5%**
band, while ADR-0005 stores **one-sided** tests (`power = 1`, H₁ = `model_a` is
more accurate), whose 5% critical value is 1.645. The mismatch is deliberate and
must be labelled as such: a symmetric band suits a chart showing both directions,
and it is the stricter bar, so nothing is called significant that is not.

**The day view.** Any of the 1,827 replayed days is reachable by date. It draws
the observed price plus all three models — four lines over 24 periods. The naïve
earns its place here visually: seeing yesterday's curve shifted one day against
the real thing is what makes rMAE's denominator intuitive without a word of
explanation.

## Nothing is excluded, and the DST repair is silent

No period is dropped from any figure. Negative prices are in — 609 in-window
hours, 315 of them in 2024 alone, and accelerating — and no percentage metric
headlines, so nothing breaks on them. The 2022 crisis is in, per ADR-0002. The
fourteen daylight-saving days are in.

DST days render the **repaired 24-period grid**, with no note on the day view.
That is what the model saw and what it was scored against (ADR-0002); drawing the
true 23- or 25-period record would show a comparison that never happened.

## The app says nothing, and the record says everything

The dashboard makes **no liveness claim** and carries **no disclaimer**. Every
date on every surface falls in 2020–2024, so the record discloses its own nature
to anyone who reads an axis, and nothing on the page asserts that it forecasts
tomorrow.

This is the deliberate rejection of a "this is a backtest" banner. The reasoning
is that the admission is only needed where a claim would otherwise mislead, and
no such claim is made; issue #12 had already flagged that leading with the
admission is what kills a reader's interest in the first ten seconds.

The cost is accepted knowingly: a reviewer can see that bad days were not
excluded, but not that showing them was *chosen*. A curated worst-days element
and a "the naïve won on N days" counter were both considered and rejected — the
honesty floor is instead carried by the naïve sitting in the ranked table, every
year being visible, no exclusions anywhere, and all 1,827 days being individually
inspectable.

## Documentation lives outside the deployed app

There is **no methodology page**. A footer link to the repository is the only
path from a figure to its definition, and it is required — without it the
definitions would exist but be unreachable from the dashboard.

The README carries the basics and links to **reader-facing `.md` documents**
written for a human, distinct in register from `CONTEXT.md` and the ADRs. Between
them they carry: the backtest framing and its window, the benchmark, the four
metric formulas, grid repair, the SMAPE-near-zero caveat, and provenance —
`model_version`, `code_version`, and the pinned `amazon/chronos-2` revision.

One disclosure is **inlined in the README rather than linked**: that rMAE
measured against a day-lag naïve is **not comparable** to published EPF work or
to the thesis's own figures (ADR-0003). It is the claim most likely to be misread
by a reader who knows the literature, and it is one sentence.

**Direction of authority is fixed**, because a reader-friendly rewrite is a
second prose copy of the formulas and copies drift: `CONTEXT.md` is the
definition of record, the public documents are a derived reading of it and link
back. Where they disagree, the public document is wrong.

## Considered options

**A bare rMAE as the headline.** Rejected. It is the only figure a reader without
domain knowledge can judge, but a lone `0.64` is unverifiable and reads as a
claim. Showing the denominator's own MAE beside it also discharges ADR-0003's
disclosure obligation at the same time.

**SMAPE dropped from the dashboard entirely.** Considered on the strength of the
zero-crossing evidence, and rejected: it is a drill-down metric that a hostile
reader will not encounter accidentally, and dropping a stored metric buys less
than keeping thesis comparability.

**Per-hour-of-day MAE.** Not in v1. ADR-0005 rejected per-hour rows in
`published_metric` because `scope_start` is a `date` and "hour 14, all days" is
not a date range. The significance view already carries the hour structure, since
its buckets are period ordinals. This is **deferred rather than dropped** — it
arrives as a `period_ordinal` column with a sentinel, per ADR-0005's sketch, and
remains an insert rather than a key rewrite.

**Computing accuracy at read time**, to avoid a schema change. Rejected on
ADR-0004's standing rule that the request path never computes.

**A minimum-sample rule** — scopes below N delivery days marked provisional.
Rejected for v1, which lands 1,827 days in a single write and has no thin record
to protect against. It returns as a live-branch question, where the first weeks
genuinely are thin.

**A methodology page.** Rejected under the no-prose rule, having been the natural
home for the three caveats that the no-prose rule displaced. The README and the
public documents absorb them instead, at the cost of one extra click.

## Consequences

- Issue #12 inherits layout for every surface named here, plus one routed
  question: whether the stored `month` scope renders as the accuracy-history
  visual. Monthly rMAE is the candidate — it is scale-free, so unlike MAE it does
  not simply redraw the 2022 price spike.
- The **live cutover** inherits two known gaps rather than surprises: `run_type`
  is not surfaced anywhere, and there is no minimum-sample rule. Both become real
  the day live rows join the backtest ones.
- The **public documentation surface is new work** — README plus reader-facing
  documents — and is the only place any caveat from this decision is stated.
- The **demo narrative** is now constrained: the app makes no claim about being
  live, so the README is where the gap between what the system does today and
  what it is built to do gets told.
