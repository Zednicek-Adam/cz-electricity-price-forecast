---
status: accepted
---

# Four views and a history switch: the hero chart gains a weekday and an hour profile

> **Amended by [ADR-0019](0019-a-price-chart-below-the-hero-chart.md).** A
> price chart below the hero chart draws its tabs and history switch a second
> time, on the same state.

> **Amends [ADR-0017](0017-three-views-two-metric-switches-and-a-30-day-window.md)**,
> whose 30 days tab becomes a switch, and carries out the per-hour accuracy
> [ADR-0006](0006-how-accuracy-is-presented.md) deferred.

The views so far showed accuracy across time: per day, running, or over a
trailing window. None showed where in the week or in the day the models miss.
That structure is large. Over the whole record the naïve's MAE on Mondays is
more than twice its MAE on Wednesdays, because "the same hour yesterday" is a
Sunday hour. Every model misses far less at night than by day.

## The decision

**The hero chart has four views: Day, Over time, By weekday and By hour.**
Each tab is a different way of looking at the record. Day shows the prices.
Over time follows the metric through the record. By weekday and By hour group
it.

- **By weekday** has seven points, Monday to Sunday, the weekday of the
  delivery day.
- **By hour** has 24 points, one per period ordinal on the repaired grid. The
  tab is called "By hour" because that is what a reader looks for. The axis
  and tooltip say "Period", as the Day view's do.

**How much history they cover is a switch, not a tab.** ADR-0017's 30 days
tab drew the same thing as Over time over a shorter span, so it was a filter,
not a view. Over time, By weekday and By hour share one **history switch**,
**Whole record**, **Last 30 days** or **Last 7 days**, in the chart's bar
beside the metric switch, because both redraw the chart. In Over time, Last 30
days draws what the 30 days tab drew: the trailing metric across the record,
each point covering the 30 days ending on it. Last 7 days does the same over
the **week**, the last 7 calendar delivery days, so it reacts to a single
bad week. In the profiles each pools only its own days.

The history switch is separate from the scoreboard's scope switch, because
each governs what it sits beside. The scope switch does not offer the week: a
Diebold–Mariano test on 7 observations per hour separates nothing.

**A profile pools like a published metric.** Each point is the metric over
every delivery period in its bucket. Its rMAE is the model's MAE over the
naïve's MAE in the same bucket, so the naïve reads 1.000 at every point. The
export computes them into a new `profiles` key in `dashboard.json`: per
history, `whole`, `window` and `week`, then `weekday` and `period`, per metric
and per model (ADR-0016). The week adds a `week` span beside `window`, a
`week` key to `accuracy`, and a 7-day trailing series: `trailing` is now keyed
by span, `window` and `week`. Pooling is now one function that both the
published metrics and the profiles call.

## Considered options

**Two more tabs beside 30 days**, five in all. That was the first build, and
it was rejected on use: the tab bar mixed views with a time filter, and a
30-day weekday profile had no way to exist.

**Last 30 days in Over time as only the last 30 days of the x axis**, with the
metric accumulating from the window's first day. Rejected: the trailing line
across the whole record shows which model led in which season, which a 30-day
axis cannot.

**A per-hour row in a metrics table**, as ADR-0005 and ADR-0006 sketched with a
`period_ordinal` sentinel column. That table went with the database
(ADR-0016). A key in the file is the whole change.

## Consequences

- Over the last 30 days a weekday point stands on four or five days, and over
  the last 7 on one, so both are noisy. The 7-day weekday profile is just the
  last week's days, in weekday order. They are shown as they are, like the
  30-day Diebold–Mariano test.
- The tab list can scroll sideways on narrow screens. Its bottom rule is an
  inset shadow and the selected underline sits inside the box, so it never
  shows a vertical scrollbar.
- `dashboard.json` grows by about 300 kB raw, almost all of it the 7-day
  trailing series.
