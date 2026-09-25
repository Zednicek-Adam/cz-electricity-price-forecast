"""The Python unit: the dataset loader, the models and the runner.

`forecast.grid` is grid repair and `forecast.loader` takes the frozen dataset
into the store. `forecast.model` is ADR-0002's pure-function seam,
`forecast.history` the providers that feed it, `forecast.runner` everything a
model may not touch, and `forecast.models` the roster. `forecast.metrics`
rebuilds every published metric and Diebold-Mariano test from the stored
forecasts.
"""
