---
status: accepted
---

# The broadsheet look

> **Amends [ADR-0017](0017-three-views-two-metric-switches-and-a-30-day-window.md)**,
> whose front-end quality pass set the cards, the tiles and the series
> colours, [ADR-0019](0019-a-price-chart-below-the-hero-chart.md), whose
> price chart lined up with the hero chart's x axis, and
> [ADR-0020](0020-an-introduction-and-plain-language-hints.md), whose hints
> opened from a "?".

The quality pass gave the page white cards with soft shadows on a grey
plane, and a system font. The page now follows the Broadsheet design: a
daily paper set on newsprint, with the delivery day as its headline. This
changes the look and where the switches sit on screen. Each view still shows
what it showed before, with the same switches.

## The decision

**Paper, ink and one highlighter.** The page is newsprint (`#f4f3ee`) and
every word, rule and control outline is ink (`#111110`). There are no cards.
Sections are divided by rules: a heavy one above each chart section and the
footer, a hairline elsewhere, and a vertical rule beside a sidebar. One
yellow (`#ffe14d`) is the only UI accent. It marks the selected tab and
option, the section labels, the **Latest forecast** chip, the best figure in
the accuracy table (a stroke under it) and hover. It never appears in a
chart.

**New data colours.** Chronos-2 is cobalt `#1f4e96`, AR-168 violet
`#9a6fd0`, the naïve teal `#1a9a86` and still dashed, the observed price ink.
The error is red `#d7261e`, used for nothing else. The set was checked for
colour-blind readers, and the dash still carries the naïve's identity where
hue fails.

**Two faces, served from the site.** Big Shoulders Display (800, all caps)
sets the headlines only: the masthead at 68px, the delivery day at 76px as
the largest text on the page, section titles at 40 to 48px and the headline
numbers at 44px. IBM Plex Sans Condensed sets everything else at 15px with
tabular figures, including the chart axes and the formulas. Small labels and
tabs are uppercase, semibold and spaced 0.05em. Notes are italic. The fonts
come from Fontsource and are bundled by Vite, so the page makes no request to
a font CDN. The browser loads about 95 KB of fonts for the Latin subset.

**A sidebar beside each hero chart.** Every hero view puts the chart in a
wide column and, behind a rule, a narrow sidebar holding what goes with it.
In Over time and the profiles that is the history and metric switches, and
in Over time the headline numbers too, stacked one above the other. In the
Day view it holds the day's accuracy panel with its metric selector, so
ADR-0017's rule still holds: each selector sits beside what it changes. The
ribbon and its worst / best / random buttons run under both columns. On a
narrow screen the sidebar drops under its chart.

**The price chart at full width.** The price chart has only a history switch
and, in the profiles, the min–max switch. A sidebar would hold those two and
leave a tall blank column, so they sit in the chart's header bar and the
chart spans the whole width. Its x axis no longer lines up with the hero
chart's above it.

**The scoreboard in two columns.** The accuracy table and its scope switch
on the left, the Diebold–Mariano card on the right behind a rule.

**"How to read" in place of "?".** Each hint opens from a dotted-underlined
"How to read" beside its title. A "?" in a circle was easy to miss, and the
words say what the note is. The button keeps the note's name as its
accessible name.

## Consequences

- Each chart scales by viewBox (ADR-0009), so its text shrinks with the
  width it is drawn at. The viewBoxes are sized for the column each chart
  gets, so the axis numbers come out at about 12 to 14px on a laptop: the
  hero charts keep 960 units beside the sidebar, the full-width price chart
  takes 1400, and the Diebold–Mariano chart, at half width beside the table,
  takes 640 and is drawn taller. On a phone each chart keeps a minimum width
  and scrolls sideways, the price chart's frame wider in proportion.
- Chrome draws the RMSE formula's root from a math font's MATH table, which
  Plex lacks. With Plex alone the root disappears without an error, so the
  radical takes the platform's math font and what sits under it stays in
  Plex.
- The charts' halos are drawn in the surface colour, which is now the paper
  itself. A label that crosses a line still reads on the page with no box
  behind it.
