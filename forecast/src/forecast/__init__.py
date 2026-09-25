"""The Python unit: the dataset loader, the models and the runner.

`forecast.grid` is grid repair, `forecast.loader` takes the frozen dataset into
the store. ADR-0013 phase 1 adds, in order: ADR-0002's pure-function model seam
and the runner, the day-lag naïve model, AR-168, then the published metrics and
the Diebold-Mariano tests.
"""
