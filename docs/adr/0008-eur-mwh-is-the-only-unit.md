---
status: accepted
---

# EUR/MWh is the only unit: the dashboard never converts to CZK

Czech day-ahead prices are cleared and published in EUR/MWh, and
[ADR-0001](0001-store-true-market-periods-in-utc.md) already stores them that
way. The dashboard **renders them that way too, everywhere, with no currency
toggle and no conversion at any layer**. A Czech-facing dashboard priced in euros
is deliberate, not an oversight.

The alternative was costed and rejected. Showing CZK needs a dated `fx_rate`
table — ČNB daily rates, published alongside the price by OTE and downloadable in
bulk for the replay window — joined at read time, plus a rule for *which* day's
rate applies to a delivery period, which is a correctness question rather than a
display one. It would also have to convert MAE and RMSE, since both are priced;
rMAE and SMAPE are unitless and would sit unconverted beside them.

Three things settle it against that:

- **EUR/MWh is what the market actually trades in.** A converted number is this
  project's arithmetic, not the market's price, and every figure on the dashboard
  is otherwise a published fact or a computation over published facts.
- **A toggle is a control**, and [ADR-0007](0007-the-dashboards-ten-second-story.md)
  keeps the control set deliberately thin — this one has to clear the same bar
  that killed the range picker and the model multi-select. It does not.
- **The audience is a reviewer of the engineering**, not a household comparing
  tariffs. The consumer-legible unit (CZK/kWh) would serve a product this is not.

## Consequences

- **No `fx_rate` table, in any schema, ever** — this is the read-side half of
  ADR-0001's storage ruling, and together they close currency as a question.
  ADR-0005's five tables stand unchanged.
- **The live branch inherits nothing here.** Live rows are EUR/MWh like the
  frozen ones, so nothing about this decision is provisional on the cutover.
- **The README carries one sentence** saying prices are EUR/MWh because that is
  how the market publishes them. The app says nothing, per ADR-0007's no-prose
  rule, so this joins the other caveats that live outside the deployed app.
