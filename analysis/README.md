# Does the `gen` regressor earn its place?

Throwaway analysis for [ticket #13](https://github.com/Zednicek-Adam/cz-electricity-price-forecast/issues/13).
**Not production code. This branch is not meant to be merged.**

## The question

The ENTSO-E day-ahead *generation* forecast (14.1.c) for delivery day D has a regulatory
publication deadline of 18:00 on D-1 — hours after the day-ahead price for D publishes at
~13:00 on D-1. The thesis's `ar_lm_predict` ("AR-X") uses it as a regressor. So:

1. What does dropping it cost in accuracy?
2. Were the thesis's own numbers inflated by an input unavailable at forecast time?
3. Is there a substitute that *is* available before the auction?

## Answer

No cost. Dropping `gen` leaves the AR family the same or slightly better, and the whole
exogenous block is worth at most ~0.1 EUR/MWh of MAE. Full numbers in
[`RESULTS.md`](RESULTS.md) and in the resolution comment on ticket #13.

## What's here

| file | what it does |
|---|---|
| `arx.py` | Python port of `ar_lm_predict` from the thesis's `predict.R`, plus its MAE/RMSE/sMAPE/rMAE |
| `fastarx.py` | same model, restructured around one global design matrix + Cholesky; ~40x faster |
| `czdata.py` | loads the thesis's `sources/CZ.csv`, builds feature blocks |
| `01_explore.py` | data sanity, `gen`↔`load` collinearity, metrics for every golden-file forecast |
| `02_parity.py` | spot-checks `arx` against `pred-ar-192_ext` |
| `02b_probe.py` | identifies which `(features, d, D)` configuration generated each golden file |
| `03_backtest.py` | full 2020–2024 daily backtest, one CSV per configuration |
| `04_evaluate.py` | scores all configurations, runs Diebold-Mariano tests |
| `06_validate_fast.py` | checks `fastarx` against `arx` and against the golden files |
| `RESULTS.md` | captured output of all of the above |

## Running it

Needs the private thesis repo checked out; point at it if it isn't at `/tmp/epf-diploma`:

```sh
export CZ_CSV=/path/to/epf-diploma/sources/CZ.csv
export PREDICTIONS_DIR=/path/to/epf-diploma/predictions
python 01_explore.py
python 02b_probe.py
python 06_validate_fast.py
python 03_backtest.py all      # ~3 minutes, writes out/*.csv
python 04_evaluate.py
```

Only `numpy` and `pandas` are required.

## Setup notes

- Test period, calibration window and lag set match the thesis exactly: 2020-01-01 →
  2024-12-31, 730-day rolling window, `p = 1:192`, daily refit, 24-step recursive forecast.
  That's 1 827 refits of a ~199-column OLS per configuration.
- Configurations differ **only** in the exogenous block, so any difference in score is
  attributable to the regressors and nothing else.
- `rMAE` is relative to the same naïve benchmark the thesis uses (`lag-24`, yesterday's
  price at the same hour).
- The port reproduces four of the thesis's golden files to ~1e-10 EUR/MWh
  (`02b_probe.py`, `06_validate_fast.py`), which is what makes this a measurement of the
  thesis's model rather than of a lookalike. `02b_probe.py` also recovers the
  configuration behind each golden file — notably that the thesis's "AR-X"
  (`pred-ar-192_ext`) uses `gen + load` and **no** weekday dummies, while "Diff-AR-X"
  (`pred-ar-192_ext_diff`) uses `gen + load + weekday` with `d = 1`.
- The Diebold-Mariano test is the multivariate form used in the EPF literature: one loss
  observation per day (mean absolute error across the day's 24 hours), one-sided.
