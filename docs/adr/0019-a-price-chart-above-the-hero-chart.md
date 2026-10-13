---
status: accepted
---

# A price chart above the hero chart, on the hero chart's cut

> **Amends [ADR-0007](0007-the-dashboards-ten-second-story.md)**, which made
> the hero chart the only chart above the scoreboard, and
> [ADR-0018](0018-the-hero-chart-gains-a-weekday-and-an-hour-profile.md),
> whose tabs and history switch it shares.

The hero chart's Over time, By weekday and By hour views show how well the
models did over a cut of the record, but not what the price did over that cut.
A reader looking at rMAE by hour over the last 7 days has to guess whether the
hours where every model missed were the volatile ones. The Day view is the
only place the observed price is drawn, and it shows one day.

## The decision

**A price chart sits above the hero chart.** It draws the observed price's
**distribution** over the cut the hero chart's metric takes:

- **Over time**: on every scored delivery day, the mean as a line with the
  25–75% and 10–90% ranges as bands. Over the whole record each point is that
  day's own 24 prices. With the history switch on the last 30 or 7 days, each
  point covers the trailing span ending on that day, as the trailing metric
  does. It is not a running distribution: one pooled from 2020 to each day
  would barely move, so it would show nothing.
- **By weekday** and **By hour**: one box per bucket over the history's days.
  The box runs from the 25th to the 75th percentile, with a line at the
  median, whiskers to the 10th and 90th and a dot at the mean.

The minimum and maximum appear in the tooltip, and on the box plots only
with the **min–max switch** on. It then draws a dashed whisker from each box
out to the bucket's extremes, and the scale grows to hold them. It is off by
default because one 2022 spike or one negative midday hour would set the
scale and flatten everything else.

**It follows the hero chart, it does not compete with it.** Its tabs and its
history switch are the hero chart's own state, drawn a second time, so the
two charts always show the same cut and either chart's controls move both. It
has no metric switch and no model series. It has the hero chart's width and
margins, so its x axis lines up with the one below it.

**The two Over time views share a zoom.** Over the whole record a season
is a few pixels wide. Dragging across either Over time chart zooms both to
the days the drag covered, and a double-click returns to the whole record.
The y axis fits the days drawn and the x axis ticks get finer as the span
shrinks: years, then months, then days. The drag is mouse-only, like the
ribbon (ADR-0009). Its accessible form is the zoom bar under each chart: two
native date inputs and a reset button. The zoom is page state, like the view
and the history, so it holds across the history switch and across tabs.

**It folds.** A button in its bar hides it, and choosing one of its tabs
shows it again. On the Day view it is folded and the button is gone, because
the Day chart already draws that day's prices.

**The export computes it.** `dashboard.json` gains a `prices` key: `daily`
on each scored day, `trailing` per span, and `profiles` per history and
profile. Each holds the mean, minimum, 10th, 25th, 50th, 75th and 90th
percentiles and maximum, rounded to the cent. The prices are the repaired
observed prices of the scored delivery periods, the series the forecasts are
scored against. So each cut holds exactly the delivery periods its metrics
pool. Quantiles are linear, numpy's default. The browser draws the figures
and computes none of them, as with every other figure on the page.

## Considered options

**Computing the distributions in the browser** from the observed prices
already in `days`. Rejected: the page computes no figure (ADR-0016), and a
trailing 30-day quantile on every day of the record is the heaviest thing it
would ever do.

**Independent tabs and history on the price chart.** Rejected: its purpose is
to show the cut the hero chart shows, so separate state would only let the
two drift apart.

**Zooming each chart on its own.** Rejected for the same reason: two charts
over different days do not compare.

**Wheel or pinch zoom.** Not built: the page scrolls, and a chart that takes
the wheel traps the reader scrolling past it. A drag starts nothing by
accident.

**A price line in the hero chart's metric views.** Rejected for the reason
the Over time view has no observed line: on a metric axis the price is not a
series (ADR-0007).

## Consequences

- `dashboard.json` grows by about 0.4 MB raw, 130 kB gzipped. Most of it is
  the three series across every scored day: `daily` and the two trailing
  spans.
- Over the last 7 days an hour's box stands on 7 prices and a weekday's on
  24, so its whiskers sit close to its extremes.
- The headline numbers in Over time stay the whole record's or the window's.
  The zoom changes what is drawn, not what is published.
- There are two tab lists with the same four tabs. Each is labelled for its
  chart, and each controls its own panel.
