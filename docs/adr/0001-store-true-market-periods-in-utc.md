---
status: accepted
---

# Store observed prices at true market periods, keyed by UTC instant

A delivery period is identified by the UTC instant it starts at
(`delivery_start`, a `timestamptz`), with its delivery day and period ordinal
derived from that instant in `Europe/Prague` as the market-facing query surface.
Consequently the store holds the **true** number of periods per delivery day —
23 across the spring-forward transition, 25 across the fall-back — and observed
prices are ingested from the **raw ENTSO-E exports**, not from the thesis's
DST-repaired `sources/CZ.csv`. The lossy repair that flattens those days into a
regular 24-period grid still has to happen, because the models require a regular
grid; it happens in the model layer, as an explicit, testable transformation
("grid repair"), on the way *into* the model.

## Considered options

**Adopt the thesis convention** — naive local wall-clock labels, treated as UTC
in code, on a gapless 24-period grid. Self-consistent inside a single R pipeline
and rejected here: as soon as a `timestamptz`, an HTTP boundary and a browser
timezone touch the same value, it becomes a silent one-hour error across the
entire system, and it would render seven years of prices at the wrong instant.

**Market coordinates only** — delivery day plus period ordinal, no instant. Speaks
the domain exactly, but cannot order rows across a daylight-saving boundary or
join to anything real without reconstructing an instant anyway.

**Keep the repaired 24-grid in storage.** Not actually available under the chosen
key: on a spring-forward day the local label 02:00 has no corresponding instant
in `Europe/Prague`, so there is nowhere to put that row. It survives only by
reintroducing the labels-as-UTC error above. It would also bake a modelling
convenience into the system's vocabulary and force the UI to misreport
daylight-saving days permanently.

## Consequences

The repair is fully reversible, which is what makes this affordable. Verified
against `epf-diploma` for delivery day 2024-03-31: the raw export carries 23
periods and the repaired file's 02:00 value is a pure insertion,
`(56.09 + 44.68) / 2 = 50.385`. For 2024-10-27: the raw export carries 25
periods with explicit `(CEST)`/`(CET)` markers, and the repaired file's single
02:00 value is their average, `(82.23 + 80.43) / 2 = 81.33`. Both real fall-back
prices are recoverable; nothing is lost by ingesting the raw form.

Ingest is more work than first scoped — seven raw ENTSO-E price exports rather
than one prepared CSV, including the `01:00 (CET) - 03:00 (CEST)` interval
format. This is the same parsing the live adapter will need, so it is not
throwaway work. See issue #21.

Parity against the thesis remains reachable: applying grid repair to the stored
observed prices reproduces `sources/CZ.csv` exactly, so the thesis golden files
stay usable as an oracle. That reproduction is worth having as a test.

Any code that assumes 24 periods in a delivery day is wrong 14 days out of 2557.
Period counts must be read from the data, not assumed.
