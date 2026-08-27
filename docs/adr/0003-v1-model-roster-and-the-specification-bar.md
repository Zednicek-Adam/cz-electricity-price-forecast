---
status: accepted
---

# v1 ships three models, and a port is judged against its specification

> **Partly amended by [ADR-0007](0007-the-dashboards-ten-second-story.md):** rMAE
> now renders bare in the app; the naïve's own 1.000 row carries the
> qualification, and the non-comparability disclosure stays in the README.

v1 carries exactly three models, all univariate, all behind ADR-0002's
pure-function seam:

| Model | What it is | Thesis MAE / rMAE |
|---|---|---|
| **Chronos-2** | `amazon/chronos-2` zero-shot, univariate. The headline model | 16.64 / 0.638 |
| **AR-168** | OLS on lags 1:168 of the `d=1` differenced series, recursive 24 steps, `diffinv` back to level. Ported from R | ~19.6 / ~0.75 |
| **Day-lag naïve** | The same hour yesterday, every day. The denominator of rMAE | — |

The thesis figures are context for the choice, not targets — see the bar below.

Chronos-2 is both the most accurate model available to v1 and the fastest in the
whole zoo (0.39 s/day, ~12 minutes over the 1,827 replay days). Its 15.66 MAE
`-X` variant is not a candidate in any configuration: it consumes `gen` for
delivery day D, which publishes 18:00 D-1 — five hours *after* the price — so the
figure is a look-ahead number. 16.64 is the honest ceiling.

## Considered options

**A fitted model as the headline.** LEAR (17.91 / 0.687) or the AR family, on the
argument that "I fit LEAR daily on a 730-day window" demonstrates more modelling
engineering than "I call a pretrained transformer". Rejected: the hero of this
project is the system, not the model, and paying 1.3–3 EUR/MWh of accuracy to buy
a better sentence in the README is the wrong trade for a piece whose entire claim
is honest evaluation. AR-168 still ships, so a fitted model is on the scoreboard —
just not in front.

**LEAR in the roster.** The strongest fitted competitor, and the model that would
make Chronos work hardest for its win. Rejected on cost: ADR-0017's ruling (issue
#17) bans `epftoolbox` from this repo and every deployed artifact, so LEAR means
~400 lines of sklearn written from scratch and defended, plus a daily-recalibration
path in the runner and ~2.4 h per full replay. Three models already make a
scoreboard.

**DNN.** Rejected outright — ~29 hours per full replay for rMAE 0.744, worse than
AR-168's cost/benefit in every direction.

**TBATS, and the ARX / SARX / mlog-ARX family.** Not candidates. TBATS is R-only
at 45 s/day; the X models' entire contribution is the exogenous block, and v1 is
univariate.

**Chronos-2-X fed `load` only, or `gen(t-24)`.** Both are legitimately available
at forecast time and might recover ~1 EUR/MWh. Not pursued: v1 has no exogenous
inputs at all, by the map's v1 scope. These return on the live branch or not at
all.

**The EPF-standard seasonal naïve** (Mon/Sat/Sun from 7 days back, Tue–Fri from
yesterday) as the rMAE denominator. Rejected in favour of the plain day-lag, which
is explicable to a dashboard visitor in one sentence. The cost is accepted
knowingly and is disclosed below.

**A strict parity bar** — max absolute difference ≤ 1e-8 against the thesis golden
CSVs, already demonstrated achievable at ~1e-10 for `ar_lm_predict`. Rejected;
see the next section.

## The bar is the specification, not the artifact

A ported model is correct when it **satisfies its specification**. AR-168 is
correct if it is an autoregression on 168 lags of the differenced series. It does
not have to reproduce the R output digit-for-digit, and there is **no numerical
comparison, no sampled-day check and no metric-band assertion** against the
thesis. Code review, plus the model landing somewhere sane on the scoreboard, is
the whole bar.

This is deliberate. The thesis output is one implementation of the spec, not the
definition of it, and a strict-diff test would weld v1 to R's exact numerical
choices for a model whose role is to be an interpretable baseline. The scoreboard
is public and self-verifying: an AR-168 that is wrong will not sit quietly at
rMAE 0.75.

### Consequences

**The golden files stop being oracles.** `epf-diploma/predictions/` is a sanity
reference at most. Issue #21 has to land the price series only — not the
predictions.

**The `weekdays()` locale hazard is dissolved, not answered.** Issue #4 flagged
that the thesis's hardcoded Czech weekday factor levels put the golden files' own
provenance in question, and this ticket carried a check to confirm the Czech
locale before trusting them. Weekday dummies exist only in the X models. Nothing
in the v1 roster has them, and nothing is trusted as an oracle anyway, so the
check has nothing left to check.

## The model interface

A model is an object. Construction does setup **once**; the per-day call is pure:

```
model.forecast(history: pd.Series, target_day: date) -> 24 floats
```

The call holds no store handle, no provider and no clock, per ADR-0002 — purity is
about what the call can reach, not about being a bare function. Chronos-2 builds
its pipeline in construction and slices its own context inside `forecast`; naïve
and AR-168 construct to nothing.

The **runner** owns the day loop, the cutoff slicing and the writing. This is the
thesis scripts' own shape with the loop lifted out: their
`history = prices.loc[:day - 1h]` is already exactly ADR-0002's cutoff rule (whole
days in, whole days out). The ENV-var configuration becomes the runner's arguments
and the output CSV becomes the store; the modelling code inside the loop is
unchanged in spirit.

**The v1 placeholder is the naïve model.** It ships regardless, it satisfies the
interface, and it needs no model work — so the system can be built and deployed
end to end with nothing outstanding. No throwaway stub is invented.

## Chronos-2 is a pinned artifact, not a trained one

`amazon/chronos-2` is pinned to an **explicit Hugging Face commit revision** —
never the moving `main` — downloaded and cached at run time, run on **CPU /
float32**. Weights are not baked into the image.

Pinning is what makes a replay reproducible: an unpinned revision silently changes
the model underneath a scoreboard that claims to be a fixed historical record, and
leaves no way to explain why the numbers moved. Package and weights are both
Apache-2.0 (issue #17), so this is unencumbered.

**Nothing this project produces is a stored model artifact.** With LEAR dropped,
"what is a model" has two answers, not three: Chronos is a fixed downloaded
artifact we never train, and AR-168 refits in under a second per day. Issue #11's
model-versioning question collapses to one thing — how a forecast row names the
Chronos revision that produced it.

**Chronos-2's context is 8192 hours (~341 days)**, the model's own cap, not the
730-day calibration window. The 2020-01-01 replay start in ADR-0002 is forced by
AR-168's 730-day window alone.

## Disclosure obligations this creates

**rMAE is never rendered bare.** The day-lag naïve is a weaker benchmark on
weekends than the seasonal naïve standard in the electricity-price-forecasting
literature, so every rMAE here reads *better* than the thesis's figure for the
same model and is **not comparable to published EPF work**. Every rMAE on the
dashboard and in the README is labelled "vs day-lag naïve". Issue #10 inherits
this as a requirement, not a suggestion.

**Prediction intervals stay deferred, on one leg instead of two.** Chronos-2 emits
quantiles for free via `predict_df(..., quantile_levels=[...])`, so ADR-0002's
"it would be new work" argument is weaker than it looked. The surviving argument
holds: AR-168 cannot produce intervals without real effort, and a scoreboard where
one model carries them and the others do not is worse than one where none do.
ADR-0002's nullable-quantile-column escape hatch is unchanged.
