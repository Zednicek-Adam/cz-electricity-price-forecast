# `cz-day-ahead-prices.csv` — the frozen observed-price dataset

The whole of v1's historical record: seven years of Czech day-ahead clearing
prices, frozen. v1 is a backtest over this file and reads no live feed.

```
delivery_start,resolution_minutes,price
2017-12-31T23:00:00Z,60,-10.00
```

| | |
|---|---|
| Rows | 61,368 (plus header) |
| Bytes | 1,858,092 |
| Delivery periods | 2017-12-31T23:00:00Z → 2024-12-31T22:00:00Z |
| Delivery days | 2,557 — 2018-01-01 → 2024-12-31, `Europe/Prague` |
| Series | ENTSO-E day-ahead prices (Transparency Regulation art. 12.1.d), `BZN\|CZ` (`10YCZ-CEPS-----N`) |
| Unit | EUR/MWh, two decimals as published (ADR-0008) |
| Range | −138.75 (2024-05-12T11:00Z) to 871.00 (2022-08-29T17:00Z); 709 negative periods |
| Retrieved | 2026-09-02 |

`delivery_start` is the UTC instant the delivery period starts, per **ADR-0001** —
so the file holds **true market periods**: 23 rows on each of the seven
spring-forward delivery days, 25 on each of the seven fall-back ones, 24 on the
other 2,543. Any code that assumes 24 is wrong 14 days out of 2,557.

`resolution_minutes` is `60` throughout. It is in the file because it is in the
key (ADR-0001, ADR-0005): the 2025-10-01 quarter-hourly series lands as an
insert rather than a key rewrite. This extract ends entirely before that break.

There is no `source` or `retrieved_at` column. Both are constant across the file
— `entsoe-tp-gui-export` and 2026-09-02 — so they are the loader's business
(ADR-0005) rather than 61,368 repeated strings.

**`gen` and `load` were dropped at the boundary.** The thesis file carries them;
v1 is univariate by decision (issue #18 — `gen` publishes five hours *after* the
price, so it was never available at forecast time) and ADR-0005 rejected folding
exogenous series into `observed_price` at all. The live branch adds a table when
it needs one; the raw exports still exist in `epf-diploma` if it does.

## Where it came from, and what was done to it

Seven annual `GUI_ENERGY_PRICES_*.csv` Transparency Platform exports, downloaded
for the diploma thesis this project builds on and living in the private
`Zednicek-Adam/epf-diploma` repo under `sources/`. `build_observed_price.py` is
the record of the conversion:

- take the start of the `MTU (CET/CEST)` interval string, resolve its
  `(CET)`/`(CEST)` marker, and store the UTC instant;
- keep `BZN|CZ` rows only; ignore the intraday columns;
- sort, and assert an unbroken one-hour grid with no duplicate periods.

**No price value was altered, rounded or interpolated**, and no row was added or
removed. The transformation is on the timestamp column alone.

The source is private, so the artifact is **committed**, not fetched: a build- or
deploy-time pull would need a credential and would not survive unattended for
years. Re-use terms and the attribution this project owes are in `NOTICE`, per
issue #20.

## Checking it

```
python data/build_observed_price.py --verify-only
```

needs nothing private and re-checks the committed file: row count, range, an
unbroken hourly grid, no duplicate periods, and the 23- and 25-period days.

```
python data/build_observed_price.py <epf-diploma>/sources --czcsv <epf-diploma>/sources/CZ.csv
```

rebuilds from the raw exports and additionally runs the **parity check ADR-0001
asked for**: applying the thesis's lossy grid repair (average the fall-back pair,
interpolate the spring gap) to these prices reproduces `sources/CZ.csv` exactly,
all 61,368 rows. That is what keeps the thesis golden files usable as an oracle.
Verified 2026-09-05: the rebuild is byte-identical to the committed file and
parity is exact.
