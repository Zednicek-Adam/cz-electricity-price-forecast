---
status: accepted
---

# visx primitives render the charts; we own every pointer event

The dashboard's four chart forms are drawn with **visx, restricted to its
low-level primitives** — `@visx/scale`, `@visx/shape`, `@visx/axis`,
`@visx/group` — and **every pointer event stays ours**. No charting library
owns the crosshair, the tooltip, or the ribbon's click-to-jump.

[ADR-0007](0007-the-dashboards-ten-second-story.md) made this decidable by
fixing the surface at exactly four forms, all of them lines or an area: a
24-point multi-line with a crosshair (Day view), an 1,827-point multi-line with
year gridlines (Over time view), an 1,827-point filled area used as a control
(the ribbon), and a 24-point multi-line with ±1.96 reference lines (the
Diebold–Mariano view). No bar chart, no heatmap, nothing animated, nothing
streaming.

## The byte budget was imaginary

The question was framed as "does a library earn its bytes on a Cloudflare
Worker's static bundle." It doesn't have to, because there is no such budget.

[ADR-0004](0004-v1-topology-stack-and-repo-layout.md) ships the client through
**Cloudflare Static Assets**, which are served from the asset store rather than
compiled into the Worker script — the free tier's 3 MiB Worker limit never
touches the SPA's JavaScript. And the data dwarfs the code: the prototype's
`prototype-data.js` is **1.79 MB**, and even after the real client pages it
(one delivery day at a time, plus the running series at 1,827 days × 3 models ×
4 metrics), the JSON on the wire outweighs any candidate library by an order of
magnitude. React and React-DOM alone already cost more than visx's primitives.

Bytes are therefore a tiebreaker, not the criterion. The decision is made on
**control**. One soft ceiling is kept for honesty — initial JavaScript at or
under 150 KB gzipped — which every candidate except the batteries-included
libraries clears anyway.

## Why the primitives, and why not the tier above them

`@visx/scale` has no React peer dependency at all: it is `d3-scale` re-exported
with types attached. "visx" is not one thing, and the distinction is the whole
decision.

What visx actually earns here is **`@visx/axis`**. Sensible ticks at arbitrary
width is the fiddly, well-solved problem, and it is precisely what the prototype
lacks — it hardcodes its gridlines. Everything else visx would give us, the
prototype already writes in a line. Raw `d3-scale` + `d3-shape` plus a
hand-rolled `<Axis>` was the genuine alternative and lost narrowly, on the
grounds that hand-rolled axes rot.

**`@visx/xychart` is forbidden.** It owns chart state, tooltips and pointer
handling, which contradicts the rule above and would fight the ribbon
specifically. Under ADR-0007 the ribbon is *a control, not a picture* — it is
simultaneously the day picker and the accuracy history, which is why no separate
history visual exists. The one interaction this design leans hardest on is the
one no charting library provides, so a library that insists on owning
interaction is buying us nothing and costing us the thing that matters.

`@visx/responsive` and `@visx/tooltip` are also **out**, though unlike
`xychart` they are merely unnecessary rather than contradictory. This is
primitives-only by choice: if a later session finds one convenient, the honest
move is to add it deliberately, not to discover it already imported.

**Raw d3 remains reachable at no cost.** visx 4 vendors its d3 modules in
`@visx/vendor` behind a `"./d3-*"` exports map, so
`import { scaleLinear } from '@visx/vendor/d3-scale'` is a real, typed subpath
import needing no new dependency. `d3-format` and `d3-time-format` come along
too, which the Over time view's year gridlines will want. The escape hatch from
visx is therefore free, which is part of why taking visx is cheap to be wrong
about.

## SVG throughout, and the perf split we deliberately skipped

All four forms are SVG. All 1,827 points are drawn. **No canvas, no
downsampling.** This is measured, not preferred: the prototype draws the long
series as a single `<polyline>` carrying every point, and it is one element and
one paint.

The React-specific hazard is different from the one the question anticipated.
`<LinePath>` rebuilds its `d` string on every render, so a chart that re-renders
on every `mousemove` rebuilds three 1,827-point path strings per pointer event.
The obvious guard is to split each chart into a memoized static layer (paths,
axes, gridlines) and a cheap interactive layer (crosshair, hover marker,
tooltip).

**We are not adopting that split.** It is speculative until measured, and the
cost of being wrong is small and local. The trip-wire is named rather than
assumed: **if crosshair tracking visibly lags on the Over time view or the
ribbon**, the fix is `useMemo` on the path strings inside the affected chart
component. That is a change to one file, not a re-architecture — which is what
makes deferring it defensible rather than optimistic.

## Accessibility is the accuracy table, and it makes the stepper mandatory

ADR-0007 forbids prose: no disclaimer, no banner, no methodology page, no
per-metric caveat. For a non-visual reader, then, the chart layer is not part of
the product — it *is* the product. No library solves this.

The **accuracy table is the fallback**, and it already exists as a real card
under ADR-0007: three models × four metrics over the whole record, as a semantic
`<table>`. Charts carry `role="img"` and an `aria-label` summarising what they
show. Exposing individual marks as focusable nodes was rejected outright — it is
unusable at 1,827 points.

**The ribbon is `aria-hidden` and keyboard-inert.** It is a mouse-only
accelerator over navigation that already exists in accessible form: its picker
function is fully duplicated by the date stepper and the worst day / best day /
random buttons, all native controls, and its history function is a
1,827-point shape that no announcement conveys.

That has a consequence which must not be lost: **the date stepper and the
worst/best/random buttons are a required accessibility affordance, not
garnish.** They are the accessible day navigator. If the stepper is ever
dropped, the ribbon has to become a real slider — `role="slider"` with
arrow-key handling and an `aria-valuetext` announcing the day and its metric.
The two are coupled, and this ADR is where that coupling is written down.

## Consequences

- **Fluid width comes from CSS, not measurement.** Without `@visx/responsive`
  there is no measured width, so charts scale via `viewBox` + `width:100%` as
  the prototype does, and a CSS breakpoint swaps tick density. The known cost:
  `viewBox` scaling shrinks *text* along with everything else, so axis labels
  get small on a narrow screen. That is the front-end quality pass's problem,
  not this one.
- **The tooltip is a hand-positioned `<div>`**, which the prototype already
  has.
- **Dark mode and true responsive re-layout are out of v1.** ADR-0007 already
  routed the quality pass elsewhere; this ADR does not absorb it.
- **`node_modules` carries more d3 than the bundle does.** `@visx/vendor`
  installs twelve d3 modules including `d3-geo` and `d3-delaunay`, which this
  dashboard never touches. Subpath exports keep them out of the built bundle;
  they are still installed.
- **Reversal is cheap in one direction and not the other.** Dropping visx for
  raw d3 is a mechanical change, since the d3 modules are already present and
  the interaction code is ours either way. Adopting `xychart` later would mean
  rewriting the ribbon, which is why it is named and forbidden rather than left
  to judgement.
