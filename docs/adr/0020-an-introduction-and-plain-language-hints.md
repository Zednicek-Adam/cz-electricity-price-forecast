---
status: accepted
---

# An introduction and plain-language hints

> **Amends [ADR-0006](0006-how-accuracy-is-presented.md) and
> [ADR-0007](0007-the-dashboards-ten-second-story.md)**, whose rule was no
> explanatory prose on the dashboard, and
> [ADR-0017](0017-three-views-two-metric-switches-and-a-30-day-window.md),
> which let in labels but not explanations.
>
> **Amended by [ADR-0021](0021-the-broadsheet-look.md).** The hints open from
> a "How to read" beside each title instead of a "?", and the introduction
> sits on the page's paper rather than on a white card.

The dashboard was built for a reader who already knows what a day-ahead
price is, what a forecast is scored by and what MAE means. Most people who
open it know none of that. To them the page is three coloured lines and a
row of acronyms, and nothing on it says what is being predicted, by whom, or
whether a lower number is good news. The no-prose rule kept the page honest,
but it also kept it closed to anyone outside the field.

## The decision

**An introduction opens the page**, above the hero chart. It explains the
idea of forecasting a day-ahead price, not how this project is built. The
idea is drawn rather than written: a **schema** of four drawings joined by
arrows, each with a short numbered title above it and no other words. The
drawings sit on the card's own white, with no box of their own.

1. **Prices so far**: the price over the last two days, up to a dashed
   line for "now", and after it an empty, lightly shaded band for the next
   day.
2. **Models predict**: the three models, in their series colours.
3. **Forecast for the next day**: the first drawing again, the same frame
   and scale, with the empty band filled by a blue forecast carried on from
   the last known price. The known prices are greyed, so the eye lands on
   what is new.
4. **Compared with the real price**: the next day up close, on the blue of
   step 3's band and from the same dashed "now", once its real prices are
   in. Each of the 24 hours has a forecast, a ring on the blue line, and a
   real price, a black dot, with the error a red segment between them. The real prices are the known
   series carried on with a few bumps no pattern foretold, so the forecast
   misses them as forecasts do.

The one idea is the gap after "now": known prices stop there, and the models
fill the next day. Drawing steps 1 and 3 as one frame, before and after,
puts that gap in the same place twice, empty and then filled. Step 4 then
says what the dashboard is for: every forecast is checked against the price
that actually came.

The prices are an illustration, not the record: three waves added up, a
daily cycle, a twice-daily bump and a slow drift, so the days are alike but
not the same. The forecast follows the cycle, a little too calm and a little
late, as a forecast would. The drawings are hidden from assistive
technology, and one visually hidden sentence says the same thing in words.

Below the schema the introduction has two columns:

- the three models in a sentence or two each, the naïve as the yardstick;
- how the forecasts are scored: a one-line key to the symbols, then each
  of the four metrics as its formula and one short line on what it means,
  laid out two by two, with no boxes, and in one column on a narrow phone.
  It carries no figure from the record; the charts below it do.

**It folds**, and the page remembers the fold in `localStorage`, so a
returning reader meets the chart first. Folded, it is one bar that opens it
again. If storage is unavailable the introduction opens on every visit.

**Each chart has a hint behind a "?"** beside its title: a sentence or three
that says in plain words what the chart shows and which way is good. It
opens on a click, not a hover, so it works on a phone, and Escape or a click
outside closes it. The Day view's hint differs for a scored day and the
pending one. The hints of the charts with a metric switch, the day's
accuracy panel and the accuracy table say what each of the four metrics
measures, in the README's words and with no formula: a note opened
mid-chart is for a reminder, and the formulas are the introduction's. The Diebold–Mariano card's says what the test asks and how to read
the band. The note is placed against the viewport, not its card, because
the hero cards clip what overflows them.

## What still holds from ADR-0006

- **No disclaimer and no banner.** The introduction explains; it does not
  warn. It does not mention the backtest: the record's provenance is the
  README's and `docs/reading-the-figures.md`'s to explain, not a first-time
  reader's to learn.
- **`CONTEXT.md` and `docs/reading-the-figures.md` stay the definitions.**
  The introduction shows each metric's formula, because the formulas side by side
  show the differences at a glance: the bars of MAE, the square and root of
  RMSE, the fraction of SMAPE, the ratio of rMAE. They are a restatement
  for a general reader, as ADR-0006 allows: written with words for the
  variables, "error" for `CONTEXT.md`'s e, real price minus forecast, and
  "real" and "forecast" where SMAPE needs them apart, each in step 4's
  colour (error red, real black, forecast blue) here and in the key line
  above them, and each
  average as one sum over the number of hours rather than 1/n, drawn in
  MathML so the page needs no maths library, and kept once, in
  `MetricFormula.tsx`. Where they and `CONTEXT.md` disagree, the page is
  wrong. SMAPE's rule for a zero price and rMAE's undefined case stay in
  `docs/reading-the-figures.md`.
- **rMAE still renders bare.** Its hint says what the ratio means; the
  non-comparability with published work stays in the README.

## Considered options

**Two paragraphs of prose** on the market, why the price moves and who
needs it forecast, followed by three cards: Forecast, Wait, Score. Built
first and replaced: the paragraphs were what a newcomer would skip, and the
cards said the same thing a third time.

**A schema with captions and a scored forecast day.** Built next: each
drawing titled and captioned, and the third one adding the next day's real
prices as dots with the error as red segments between them and the forecast,
first on a realistic example day, then on a sketch, in the same drawing as
the forecast. Replaced by the titled schema: the captions, and the scoring
drawn into the same picture as the forecast, made the one idea, that a
forecast carries known prices on into the future, harder to see. A version with no words at
all followed, and lost the titles that tell a newcomer which step is which.
Scoring came back later as a step of its own, step 4, apart from the
forecast it scores.

**The formulas in words**, such as "average of |real − forecast|".
Built and replaced on review: written out, the four read alike, and the
point of a formula here is to show how they differ.

**The headline model's whole-record MAE beside the naïve's** under the
metrics, read from the accuracy table. Built and taken out on review: the
introduction explains how scoring works, and the record's numbers are the
charts' to show.

**A "Good to know" column** in place of the metrics: the two MAEs, what
EUR/MWh means in cents per kilowatt-hour, and where on the page to start.
Built and replaced on review: a newcomer meets the four metrics on every
chart, and the column did not say what they were.

**The models as a row of cards**, each with a shorter description, its
whole-record MAE as its average miss, and the lowest marked Best, with a
footnote for the unit. Built and replaced on review by the two columns: as
cards inside a card the models read as a second set of boxes after the
schema's, and the shorter descriptions said less.

**A schema with a "?" in the empty next day, a "now" tag on the divider,
and soft fills under the lines.** Built and taken out on review: the "?"
read as a question to the reader rather than as the unknown next day, and
the tag and the fills added detail the sketch did not need.

**A separate "About" page or modal.** Rejected: the reader who needs it most
does not know to look for it, and a modal stands between them and the chart.

**Hints always on screen**, a line or two under each title and a line
beside each metric switch. Built first and moved behind the "?": on every
chart they pushed the chart down, and a reader who has read them once does
not need them again.

**Tooltips on the metric names.** Rejected: hover does not exist on a phone.
The "?" opens on a click instead.

**Renaming the axis label "Period" to "Hour".** Not done: the glossary keeps
period ordinal distinct from clock hour because of the daylight-saving days.
The hints say instead that period 1 is midnight to 1 a.m.

## Consequences

- The page is longer by the introduction's height on a first visit, and by
  nothing after it is folded: the hints sit behind their "?".
- The sketched prices are constants in `IntroSchema.tsx`, not taken from
  the record.
- Every new view or metric now owes a hint.
