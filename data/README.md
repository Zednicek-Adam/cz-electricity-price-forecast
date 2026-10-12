# `data/` — the two records

Everything the dashboard shows is computed from two CSV files, committed here
(ADR-0016). Git history is their audit trail: any change to a price or a
forecast is a diff in a commit.

## `cz-day-ahead-prices.csv` — the observed prices

Czech day-ahead clearing prices, as the market published them.

```
delivery_start,resolution_minutes,price
2017-12-31T23:00:00Z,60,-10.00
```

| | |
|---|---|
| Series | ENTSO-E day-ahead prices (Transparency Regulation art. 12.1.d), `BZN\|CZ` (`10YCZ-CEPS-----N`) |
| Unit | EUR/MWh, two decimals as published (ADR-0008) |
| Delivery days | 2018-01-01 onward, `Europe/Prague`, one more with each daily run |
| 2018-01-01 → 2024-12-31 | 61,368 hourly rows from the platform's GUI export files, retrieved 2026-09-02 |
| 2025-01-01 → 2025-09-30 | hourly rows from the platform's API |
| 2025-10-01 onward | quarter-hourly rows from the platform's API |

`delivery_start` is the UTC instant the delivery period starts, per **ADR-0001**,
so the file holds **true market periods**: an hourly day has 23, 24 or 25 of
them and a quarter-hourly day 92, 96 or 100. Any code that assumes 24 or 96 is
wrong twice a year.

`resolution_minutes` is the period length. The market cleared hourly up to
delivery day 2025-09-30 and in quarter-hours from 2025-10-01, and each day is
held at the resolution it cleared at. The hourly price the models and the
metrics use is derived on the way out, in `forecast.loader`: from 2025-10-01 it
is the mean of an hour's four quarter-hours (the **Average Rule**), and every
day then goes through grid repair onto 24 period ordinals. Neither derivation
is stored.

The file is **append-only**. The daily run (`forecast.daily`) appends each
newly published delivery day, whole, after the last one held; nothing rewrites
a row. There is no `source` or `retrieved_at` column: the table above is the
provenance, and the commit that added a row is when it was retrieved.

`gen` and `load` are not here. v1 is univariate by decision (issue #18 — `gen`
publishes five hours *after* the price, so it was never available at forecast
time); the raw exports still exist in `epf-diploma` if they are ever needed.

### Where 2018–2024 came from

Seven annual `GUI_ENERGY_PRICES_*.csv` Transparency Platform exports,
downloaded for the diploma thesis this project builds on and living in the
private `Zednicek-Adam/epf-diploma` repo under `sources/`.
`build_observed_price.py` is the record of the conversion:

- take the start of the `MTU (CET/CEST)` interval string, resolve its
  `(CET)`/`(CEST)` marker, and store the UTC instant;
- keep `BZN|CZ` rows only; ignore the intraday columns;
- sort, and assert an unbroken one-hour grid with no duplicate periods.

**No price value was altered, rounded or interpolated**, and no row was added or
removed. Grid repair applied to these prices reproduces the thesis's
`sources/CZ.csv` exactly, all 61,368 rows, which is what keeps the thesis's
golden files usable as an oracle; `forecast/tests/test_loader.py` checks that
on every pull request. The platform's API serves the same 2024 prices
byte-for-byte (checked 2026-10-12), so the change of source at 2025-01-01 is a
change of channel, not of series.

`python data/build_observed_price.py --verify-only` re-checks the file as it
stood before the daily run began appending to it (the tag `v1-neon`).

## `forecasts.csv` — the forecasts

One row per forecast run: one model for one delivery day, 24 forecasts on the
repaired grid (ADR-0002).

```
delivery_date,model,run_type,model_version,code_version,executed_at,p1,...,p24
```

| Column | |
|---|---|
| `delivery_date` | the delivery day forecast, `Europe/Prague` |
| `model` | `chronos2`, `ar168` or `daylag` (CONTEXT.md) |
| `run_type` | `backtest`: replayed after the price was known; `live`: written by the daily run before it was published |
| `model_version` | the specification string, or the pinned revision of downloaded weights |
| `code_version` | the git commit that produced it |
| `executed_at` | when the run was made, UTC |
| `p1` … `p24` | the forecasts for period ordinals 1 to 24, EUR/MWh |

| Delivery days | Written by |
|---|---|
| 2020-01-01 → 2024-12-31 | the production replay of 2026-09-28, copied out of the database the dashboard used to read |
| 2025-01-01 → 2026-10-13 | the replay of 2026-10-12, as backtests |
| from 2026-10-14 | the daily run, as `live` forecasts |

Rows are sorted by delivery day, then model. A replay replaces the backtest run
for a model and day; a `live` run is never replaced (ADR-0011).

## Attribution

Re-use terms and the attribution this project owes are in `NOTICE`, per
issue #20.
