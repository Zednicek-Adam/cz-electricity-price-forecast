"""The Python unit: the dataset loader, the models and the runner.

`forecast.grid` is grid repair and `forecast.loader` takes the frozen dataset
into the store. `forecast.model` is ADR-0002's pure-function seam,
`forecast.history` the providers that feed it, `forecast.runner` everything a
model may not touch, and `forecast.models` the roster. ADR-0013 phase 1 adds
AR-168, then the published metrics and the Diebold-Mariano tests.
"""
