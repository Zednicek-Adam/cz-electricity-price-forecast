---
status: accepted
---

# One chart is the dashboard: the day, the record, and one metric selector

The dashboard leads with **a single hero chart carrying two views**, switched in
place and sharing one metric selector:

- **Day** — the observed price against all three models, prices in EUR/MWh over
  the 24 period ordinals of one delivery day.
- **Over time** — the **running metric** for the three models across all 1,827
  replayed days. No observed line: on a metric axis the observed price is the
  zero it is measured from, not a series.

The metric selector carries **MAE, RMSE, SMAPE and rMAE** and governs both views,
the headline numbers beneath the title, and the day navigator. The headline
numbers show the selected day in Day view and the whole record in Over time
view, so switching views turns `90.2 / 93.6 / 87.7` into `16.6 / 20.1 / 26.1`
in place.

Beneath the hero sit exactly two cards: the **accuracy table** (three models ×
four metrics, whole record) and the **Diebold–Mariano view**, which ADR-0006
already specified and which gets its own card rather than sharing one.

This was decided by building it. Three whole-dashboard layouts were prototyped
on the real replay output and compared in a browser: a scoreboard-led scrolled
narrative, a day-led one, and a dense single-screen instrument panel. The day-led
layout won, and the rest of this ADR is what four rounds of revision did to it.
The prototype is a primary source and is kept on the throwaway branch
[`prototype/dashboard-ten-second-story`](https://github.com/Zednicek-Adam/cz-electricity-price-forecast/tree/prototype/dashboard-ten-second-story).

## The record is the navigator

Under the Day view runs a **ribbon**: the selected metric for the headline model
on every one of the 1,827 days, as one continuous area, click-to-jump. It is
simultaneously the day picker and the accuracy history, which is why no separate
history visual exists.

That answers the question ADR-0006 routed here. The stored `month` scope does
**not** render: monthly rMAE was prototyped as a 60-point line and as a
year × month heatmap, and both lost to the ribbon, which shows 1,827 points
instead of 60 and is a control rather than a picture. `month` remains stored and
unrendered — a read-model row without a reader, which is cheaper than a
migration when the live branch wants it.

Alongside the ribbon: a date stepper, and **worst day / best day / random**,
scoped to the selected metric. Nothing else. No range picker, no model
multi-select, no `run_type` filter.

## What this amends in ADR-0006 and ADR-0003

Three of ADR-0006's rules do not survive contact with the built thing. They are
listed together because they are one decision, not three: **the dashboard now
leans on its charts and on the naïve's own row to be honest, and not on labels,
qualifiers or layout rules.**

**The hero triple is gone.** ADR-0006 required a headline triple — model MAE,
naïve MAE, rMAE, rMAE visually dominant — at the top of the page. The header now
carries the title and the date range only. What replaces it is the day's own
three numbers, one per model, in whichever metric is selected: a reader meets
the models being compared immediately, on a concrete day, rather than meeting an
aggregate. The whole-record triple still exists — it is the same three numbers in
Over time view, and the same three rows in the accuracy table.

**The per-year breakdown is gone.** ADR-0006 made "an overall MAE never renders
without the per-year breakdown adjacent" *structural*, on the evidence that the
naïve's own MAE runs 7.79 / 21.80 / 52.55 / 23.19 / 25.14 across the five years,
so an aggregate MAE is partly a statement about 2022. Neither the per-year bar
chart nor per-year table rows survive. **The Over time view carries that
obligation now**: the running MAE line visibly climbs through 2022 and then
settles onto 16.6, which shows the same distortion as a *shape* rather than as a
column of numbers, and shows it for every metric rather than only for MAE.

This is weaker in one specific, accepted way: the per-year rows were unavoidable,
and a view toggle is not. A reader who never leaves the Day view never sees the
2022 effect. That is the price of the layout the dev chose, and it is recorded
rather than hidden.

**rMAE renders bare.** ADR-0003 held that rMAE against a day-lag naïve is not
comparable to published EPF work, and therefore must never render unqualified;
ADR-0006 discharged that with a "vs day-lag naïve" qualifier once per view. The
qualifier is dropped from the column header and from the headline unit. What
carries the meaning instead is **the naïve sitting in the accuracy table at
exactly 1.000** — which ADR-0006 had already argued is what teaches a reader what
the ratio means. The non-comparability disclosure is unaffected: it was always
the README's job, inlined rather than linked, and it stays there.

The benchmark is also **labelled "Naïve" rather than "Day-lag naïve"** in the
interface. The glossary term is unchanged — `daylag` is still the slug, and prose
outside the app still says day-lag naïve.

## What is deliberately absent

- **No prose.** Unchanged from ADR-0006, and now stronger: there is no
  disclaimer, no banner, no methodology page, and no per-metric caveat anywhere
  in the app. Every date on screen is 2020–2024. The footer link to the
  repository is still the one required non-visual element.
- **No second chart competing with the hero.** The heatmap and the monthly line
  were built and rejected on sight, not in the abstract.
- **No `n_forecasts`, no `run_type`, no rolling windows.** As ADR-0006 had it.

## Consequences

- **The charting approach is now decidable.** The prototype hand-rolls SVG
  precisely so this ADR commits to nothing: what it fixes is that v1 needs
  exactly four chart forms — a 24-point multi-line, a 1,827-point multi-line, a
  1,827-point filled area used as a control, and a 24-point multi-line with
  reference lines. That is a small enough surface that a library must earn its
  bytes.
- **Per-day rMAE is noisier than the whole-period figure** and is now reachable
  from the metric selector. Across the record it ranges 0.07 to 3.73, because on
  a flat day the naïve denominator nearly vanishes — two days have a naïve
  day-MAE under 1 EUR/MWh. No guard is added: the figure is correct, the
  Over time view shows the stable version, and adding a caveat would be prose.
- **`month` scope is stored and unrendered.** Not a defect; the read model may
  legitimately hold more than one reader consumes.
- **The API surface is now implied**: one day of prices for all models, the
  running series per model per metric, the whole-record metric table, and the
  DM statistics by period ordinal. All four are reads of `published_metric` and
  the forecast tables, so ADR-0004's "the request path never computes" holds —
  though the running series is the one that will want precomputing rather than
  aggregating on read.
- **A front-end quality pass is real work and is not this ticket.** The
  prototype is deliberately plain so that structure was what got judged; making
  it genuinely good-looking is separate, and lands after the stack stands up.
