---
status: accepted
---

# Three views, two metric switches, and a 30-day window

> **Amended by [ADR-0018](0018-the-hero-chart-gains-a-weekday-and-an-hour-profile.md).**
> The 30 days tab becomes a history switch shared by Over time and two new
> views, By weekday and By hour, so the hero chart has four tabs.

> **Amends [ADR-0006](0006-how-accuracy-is-presented.md) and
> [ADR-0007](0007-the-dashboards-ten-second-story.md).** It reverses ADR-0006's
> rejection of rolling windows and ADR-0007's single metric selector, and
> carries out the front-end quality pass ADR-0007 deferred.

Using the dashboard showed that the one metric selector was confusing. In the
Day view it changed the numbers and the ribbon but not the chart, which is in
EUR/MWh whatever the metric. In the Over time view the same buttons redrew the
chart. The selector sat in the hero chart's bar in both views, so it looked
like a chart control in a view where it was not one.

## The decision

**The hero chart has three views, behind tabs: Day, Over time, and 30 days.**
The view is the first choice a reader makes, so it is the outermost control.
The tabs are an ARIA tab list, walked with the arrow keys.

- **Day** is unchanged in content: the observed price and the three models
  over one delivery day.
- **Over time** is unchanged: the running metric.
- **30 days** is new: the **trailing metric**, each model's figure over the 30
  calendar delivery days ending on each scored day, plotted across the whole
  record. It moves with how the models are doing now, where the running metric
  settles.

**There are two metric switches, each beside what it changes.** In the Day
view the switch sits in the day's accuracy panel under the chart, with the
day's figures, the ribbon and worst / best / random, which are everything it
governs. The price chart does not change with it. In the Over time and 30-day
views one shared switch sits in the chart's bar, because there it redraws the
chart. The two are separate state: choosing rMAE for the trend charts does not
change how the day is scored.

**The scoreboard has a scope: the whole record or the last 30 days.** The
accuracy table and the Diebold–Mariano card sit under a single switch, so
their figures always cover the same days. The last 30 days are the 30 calendar
days up to the last scored day.

**Every figure is still computed by the export (ADR-0016).** The trailing
series and both 30-day scopes are new keys in `dashboard.json`: `trailing`,
`window`, and a `whole` / `window` split of `accuracy` and `comparisons`. The
trailing metric pools periods exactly as the running metric does, and its rMAE
is the ratio of two windowed MAEs. It has no value until a whole window fits
inside the record.

## Why ADR-0006's objection no longer holds

ADR-0006 rejected 7/30/365-day windows because on a frozen backtest "they mean
the tail of 2024 wearing a live system's costume". The record is no longer
frozen. Since ADR-0016 it is one pooled series that the daily run extends every
day, so the last 30 days are the most recent month of real forecasts. On a
live record a recent window is the figure a reader most needs, and the running
metric cannot give it, because after six years one more month barely moves it.

The 2022 distortion that motivated the running metric is not hidden by the
trailing one. It is more visible: the 30-day MAE spikes through the crisis,
while the 30-day rMAE stays inside a band.

## The front-end quality pass

ADR-0007 left the prototype plain on purpose and deferred making it good. This
is that pass. The look changed. The structure ADR-0007 fixed did not:

- One recessive chrome for every chart: hairline gridlines, no axis boxes,
  tick labels in muted ink, a ringed dot and an ink label at each line's end.
  Series colours are kept and still validated as a set. The naïve is dashed
  everywhere it is drawn, so identity never rests on hue alone.
- A legend above every multi-series chart, and a tooltip that lists every
  series at the crosshair.
- The headline numbers are tiles, and the lowest figure is marked **Best**.
  For every metric on the page lower is better, so this is a reading aid and
  not a claim. The accuracy table sets the lowest figure in each column in
  bold.
- The Day view is titled with the weekday ("Tue 13 Oct 2026"), because price
  shapes differ between weekdays and weekends.
- The ribbon reads out the day and figure under the pointer, so a click is
  never blind. It stays `aria-hidden`, and the date stepper and worst / best /
  random remain its accessible form (ADR-0009).
- The masthead carries a **Latest forecast** chip that opens the pending day
  from any view.
- On narrow screens charts keep a legible size and scroll sideways, rather
  than shrinking their text below reading size.

**Some prose arrives, on purpose.** The Diebold–Mariano chart names the two
sides of its band ("↑ Opponent more accurate", "↓ Chronos-2 more accurate"),
and the ribbon is captioned with what it shows and that it can be clicked.
These are labels, not caveats, and they replace a convention the reader would
otherwise have to remember. ADR-0006's rule against disclaimers, banners and
methodology pages stands.

## Considered options

**One metric switch, placed outside the hero chart.** It would have stopped it
looking like a chart control in the Day view, but it would still have redrawn
the chart in one view and not in another. Two switches, each beside what it
changes, make the effect visible from where the control is.

**A 30-day zoom of the running metric** instead of a trailing metric. Rejected:
the running line is flat at the end of the record, so zooming in shows almost
nothing.

**30 scored days rather than 30 calendar days.** Calendar days were chosen so
a stretch in which the daily run failed is not silently stretched to fill the
window.

## Consequences

- The Diebold–Mariano test over 30 days has 30 observations per hour, so it
  separates two models only when the gap is large. This is disclosed in
  `docs/reading-the-figures.md`, not on the dashboard.
- `dashboard.json` grows by about 300 kB raw, 90 kB gzipped.
