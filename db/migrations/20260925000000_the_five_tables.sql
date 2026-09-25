-- ADR-0005's five tables. `observed_price` is the historical record, permanent
-- and append-only; the other four are derived from it and are deleted and
-- rewritten by the job that computes them.
--
-- Natural keys throughout: no surrogate ids and no foreign keys, because the
-- forecast-to-observed relationship is a coordinate join rather than a
-- reference. Every column is NOT NULL and every price and metric is `numeric`.
-- No price column is constrained non-negative: negative prices are real
-- (ADR-0001), and a model may legitimately forecast one.
--
-- `resolution_minutes` is in all three time-series keys, so the 2025-10-01
-- quarter-hourly series lands as an insert rather than a key rewrite.

-- migrate:up

-- True market periods keyed by the UTC instant they start at (ADR-0001), so a
-- delivery day has 23, 24 or 25 rows here.
CREATE TABLE observed_price (
    delivery_start timestamptz NOT NULL,
    resolution_minutes integer NOT NULL,
    price numeric NOT NULL,
    source text NOT NULL,
    retrieved_at timestamptz NOT NULL,
    PRIMARY KEY (delivery_start, resolution_minutes)
);

-- The same prices after grid repair, on the regular 24-period grid in market
-- coordinates. Written by the loader in the same transaction as
-- `observed_price`, so grid repair has exactly one implementation (ADR-0005).
CREATE TABLE repaired_observed_price (
    delivery_date date NOT NULL,
    period_ordinal integer NOT NULL,
    resolution_minutes integer NOT NULL,
    price numeric NOT NULL,
    PRIMARY KEY (delivery_date, period_ordinal, resolution_minutes)
);

-- `model` is free text: the roster lives in CONTEXT.md, not in a constraint.
-- `run_type` is closed, and pooling backtest with live is the specific mistake
-- the column exists to prevent (ADR-0002). There is no run table: `model`,
-- `run_type` and `executed_at` carry a run's whole identity.
CREATE TABLE forecast (
    delivery_date date NOT NULL,
    period_ordinal integer NOT NULL,
    resolution_minutes integer NOT NULL,
    model text NOT NULL,
    run_type text NOT NULL CHECK (run_type IN ('backtest', 'live')),
    price numeric NOT NULL,
    model_version text NOT NULL,
    code_version text NOT NULL,
    executed_at timestamptz NOT NULL,
    PRIMARY KEY (
        delivery_date, period_ordinal, resolution_minutes, model, run_type
    )
);

CREATE INDEX forecast_delivery_date_idx ON forecast (delivery_date);

-- Long, not wide: a new metric or a new slice is an insert, not a migration,
-- which is why neither `scope_type` nor `metric` carries a CHECK. v1 writes
-- the scopes `overall`, `year`, `month` and `delivery_day`, and the metrics
-- `mae`, `rmse`, `smape` and `rmae`, whose definitions of record are in
-- CONTEXT.md. `scope_start` is the first delivery day the scope covers.
CREATE TABLE published_metric (
    model text NOT NULL,
    run_type text NOT NULL CHECK (run_type IN ('backtest', 'live')),
    scope_type text NOT NULL,
    scope_start date NOT NULL,
    metric text NOT NULL,
    value numeric NOT NULL,
    n_forecasts integer NOT NULL,
    computed_at timestamptz NOT NULL,
    PRIMARY KEY (model, run_type, scope_type, scope_start, metric)
);

CREATE INDEX published_metric_model_scope_type_idx
    ON published_metric (model, scope_type);

-- Diebold-Mariano tests bucketed by period ordinal, both ordered directions.
-- H1 is that `model_a` is more accurate than `model_b`. A test that fails to
-- compute writes no row rather than a null.
CREATE TABLE model_comparison (
    model_a text NOT NULL,
    model_b text NOT NULL,
    run_type text NOT NULL CHECK (run_type IN ('backtest', 'live')),
    period_ordinal integer NOT NULL,
    resolution_minutes integer NOT NULL,
    dm_statistic numeric NOT NULL,
    p_value numeric NOT NULL,
    computed_at timestamptz NOT NULL,
    PRIMARY KEY (
        model_a, model_b, run_type, period_ordinal, resolution_minutes
    )
);

-- migrate:down

DROP TABLE model_comparison;
DROP TABLE published_metric;
DROP TABLE forecast;
DROP TABLE repaired_observed_price;
DROP TABLE observed_price;
