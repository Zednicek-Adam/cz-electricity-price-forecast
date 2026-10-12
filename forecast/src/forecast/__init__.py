"""The Python unit: everything that reads or writes the records in `data/`.

`forecast.loader` reads and appends the price record and derives the repaired
observed prices from it, through `forecast.grid`; `forecast.forecasts` reads
and writes the forecast record. `forecast.model` is ADR-0002's pure-function
seam, `forecast.runner` everything a model may not touch, and `forecast.models`
the roster. `forecast.replay` writes backtests, `forecast.daily` ingests from
ENTSO-E (`forecast.entsoe`) and forecasts the pending day, and
`forecast.export` computes every figure (`forecast.metrics`) into the files the
dashboard reads (ADR-0016).
"""
