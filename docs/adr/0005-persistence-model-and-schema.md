---
status: accepted
---

# Five tables on plain Postgres: one immutable record, everything else regenerable

The store is **plain Postgres on Neon**. It holds five tables, split by a single
rule: `observed_price` is the historical record and is permanent and immutable;
everything else is **derived from it and regenerable**, deleted and rewritten by
the job that computes it.

```sql
observed_price          (delivery_start timestamptz, resolution_minutes) PK
                         price, source, retrieved_at

repaired_observed_price (delivery_date, period_ordinal, resolution_minutes) PK
                         price

forecast                (delivery_date, period_ordinal, resolution_minutes,
                         model, run_type) PK
                         price, model_version, code_version, executed_at

published_metric        (model, run_type, scope_type, scope_start, metric) PK
                         value, n_forecasts, computed_at

model_comparison        (model_a, model_b, run_type,
                         period_ordinal, resolution_minutes) PK
                         dm_statistic, p_value, computed_at
```

Natural keys are primary keys throughout. There are no surrogate ids and no
foreign keys: nothing references a row in another table, because the
forecast-to-observed relationship is a coordinate join rather than a reference.
Every column is `NOT NULL`, every price and metric is `numeric`, and **no price
column carries a non-negative constraint** — negative prices are real (ADR-0001),
and a model may legitimately forecast one.

`resolution_minutes` sits in all three time-series keys, not only in
`observed_price`'s. A `period_ordinal` is meaningless without one — ordinal 20 is
19:00 hourly and 05:45 quarter-hourly — and ADR-0001 already accepted the same
argument for the observed side, so that the 2025-10-01 quarter-hourly series
lands as an insert rather than a key rewrite.

## The repaired series is stored, not recomputed

ADR-0002 left the two coordinate systems deliberately unreconciled: observed
prices at true market periods keyed by instant, forecasts on the repaired
24-period grid, and scoring "a join across a grid repair". This ADR resolves who
performs that repair, and the answer is **nobody, at read time** — it is stored.

`repaired_observed_price` is written by the loader **in the same transaction** as
the observed prices it derives from, and both the runner and the read API consume
it. So grid repair has exactly one implementation, in Python, in the model layer
where ADR-0001 put it, executed once.

This closes two gaps at once. The read API is TypeScript and computes nothing
(ADR-0004), so without a stored repaired series the dashboard's core chart —
forecast against observed for a delivery day — would need the lossy DST rule
reimplemented in a second language, wrong on exactly the fourteen days a year
nobody writes a test for. And the runner would otherwise repair in memory while
scoring repaired something else, structurally identical today and a real bug the
first time the repair changes. One stored series is what ADR-0002 means when it
says the repaired series is also the evaluation ground truth.

The cost is that the runner depends on a derived table being current, which the
same-transaction rule guarantees.

## Write semantics

**Observed prices are append-only.** A conflicting value for an existing period
raises and never overwrites, per ADR-0001. This is the one table where history
accumulates.

**A re-run replaces, in one transaction.** Regenerating a forecast run deletes the
`(model, run_type, delivery_date)` rows and inserts 24 new ones, all or nothing.
An upsert was rejected for the reason ADR-0001 rejected it on the observed side —
it lets a bug silently rewrite scored history — and because adopting it here would
turn ADR-0002's promised live-immutability rule from "insert, do not upsert" into
a behaviour change. `run_type = 'live'` can become insert-only later without
touching the backtest path.

**Metrics are fully recomputed, never patched.** A replay recomputes every
`published_metric` and `model_comparison` row for the `(model, run_type)` it
touched — delete all, insert all — rather than incrementally patching the scopes
it believes it affected. ADR-0004 warned that a partial re-run can leave metrics
describing forecasts that no longer exist; full recomputation is a few thousand
rows and removes that failure mode, where incremental patching reintroduces it as
a class of bug.

## How a forecast is explained a year later

Three columns on every forecast row: `model` (the slug), `model_version` (the
pinned Hugging Face revision for Chronos-2; a specification string such as
`ar168-d1-lags168` for the others) and `code_version` (the runner's git sha).
`model_version` explains a number moving when the weights change; `code_version`
is the only thing that explains a number moving when they do not — a fix to
AR-168's differencing otherwise restates history silently.

`model` is **free text**, with the slugs `chronos2`, `ar168` and `daylag` fixed in
`CONTEXT.md` rather than in a constraint. The roster is ADR-0003's business and
the model set lives in one Python config, not scattered across call sites; a
`CHECK` would mean adding a model on the live branch requires a migration to land
before the runner can write, which is the coupling ADR-0004 avoided by giving
migrations their own job. `run_type` goes the other way — `CHECK (run_type IN
('backtest','live'))` — because that set is closed by ADR-0002 and pooling the two
is the specific mistake the column exists to prevent.

There is no `model` table. A lookup table buys referential integrity over a set of
three values that changes by deploy.

## Accuracy is stored in two shapes

**`published_metric` is long, not wide**: one row per
`(model, run_type, scope_type, scope_start, metric)`. `scope_type` is one of
`overall`, `year`, `month`, `delivery_day`; `scope_start` is a `date` holding the
first delivery day the scope covers, with `overall` carrying 2020-01-01, the first
replayed day. The long shape makes issue #10 additive — a new metric or a new
slice is an insert, not a migration — and it means every stored number is labelled
with the period it covers, so ADR-0002's rule that no headline figure is computed
over a silently restricted period has nowhere to be violated in data.

All four scopes are written. The per-day scope is ~5,481 rows against 131,544
forecasts and it is what turns the scoreboard from five numbers into something
with a time axis.

The v1 metric vocabulary is `mae`, `rmse`, `smape` and `rmae`, transcribed into
`CONTEXT.md` from the thesis's `models/_utils.R`. The names are **unqualified** —
in particular `rmae`, not `rmae_vs_daylag`. This is a deliberate divergence from
the shape ADR-0003's disclosure obligation invites: that obligation governs
*rendering*, and it stands unchanged, but the schema does not enforce it, so
issue #10 carries it alone. `CONTEXT.md` is the one written place that records
what each name meant.

**`model_comparison` holds the Diebold–Mariano tests**, in their own table because
DM is pairwise and cannot fit a `(model, scope, metric)` row without smuggling a
second model's identity into a string that no query can join on. It follows the
thesis: errors bucketed by `period_ordinal`, one test per ordered model pair per
bucket, one-sided with `power = 1` so the test ranks what MAE ranks. It has no
time scope — the buckets are the grain.

Both ordered directions are stored, roughly 144 rows for three models. The
statistic is antisymmetric and the one-sided p-value satisfies
`p(B,A) = 1 − p(A,B)`, so one direction is formally sufficient; storing both
removes a derivation rule that a reader will get wrong once. `dm_statistic` is
kept alongside `p_value` — the thesis drops it at CSV time, and it is the only
thing that says *how* separated two models are rather than whether a threshold was
cleared. A test that fails to compute writes no row, rather than a null.

`h` is passed the bucket's `period_ordinal`, replicating the thesis and following
the conventional mechanical reading that an h-step-ahead error series is MA(h−1).
A consequence worth knowing when reading the numbers: within a bucket, successive
errors are 24 hours apart while each forecast reaches at most ~24 hours past its
origin, so the forecast windows do not overlap and the correction has no
mechanical autocorrelation to remove. Later buckets are therefore tested more
conservatively than earlier ones — significance is under-reported, never
over-reported, which is the safe direction for a public scoreboard.

## Considered options

**TimescaleDB.** Rejected for v1. The whole store is ~61k observed prices, ~132k
forecasts and a few thousand derived rows — under 10 MB, several times over in
memory. A hypertable is chunking and compression for a problem this data does not
have, and plain Postgres keeps the option of moving off Neon to any provider.
Converting later costs nothing structural: `create_hypertable(..., migrate_data =>
true)` operates on an existing table, so no choice here forecloses it. **Named
trigger to revisit**: the store passing ~10 GB, or a dashboard query needing
continuous aggregates that precomputed `published_metric` rows cannot serve. At
live-branch volumes — roughly 35k rows a year at 15-minute resolution — neither is
plausibly reachable this decade.

**A generic series column, so exogenous inputs are an insert rather than a
migration.** Rejected. A day-ahead load forecast is a different object from a
settled price: it has a publication time, it is revisable, and several vintages
can exist for one period. Folding it into `observed_price` means nullable columns
that apply to one kind of row and breaks "there is exactly one observed price per
delivery period". v1 is univariate, so there is nothing to store; the live branch
adds a table, additively. The genuinely unretrofittable things — `source`,
`retrieved_at`, `run_type` — are already carried.

**A `repair` column on the repaired series**, marking each row `none`,
`interpolated` or `averaged`. Rejected, though it would have turned ADR-0002's
disclosure footnote — five interpolated hours and five averaged pairs across
2020–2024 — into a query. The affected days are derivable from the delivery date
and the `Europe/Prague` calendar, which is cheap and does not reimplement the
lossy rule; the repair itself stays in Python. Issue #10 identifies them that way.

**A view or SQL function performing grid repair.** Rejected: it puts a domain
transformation where it cannot be unit-tested against the thesis parity oracle,
and ADR-0001 placed the repair in the model layer deliberately.

**Surrogate `bigint` primary keys.** Rejected. No table references another, so an
id buys nothing, and it would let a duplicate exist while the constraint
forbidding it sits one level down as a secondary index.

**A bidding-zone column.** Rejected. `CONTEXT.md` fixes the project at exactly one
zone, `BZN|CZ`; a constant column is speculative generality every query must
filter on. A second zone is a product change far larger than the migration.

**Per-hour rows in `published_metric`.** Rejected for v1. `scope_start` is a date
and "hour 14, all days" is not a date range, so it would need a `period_ordinal`
column with a sentinel for "all periods". `model_comparison` already carries the
per-hour comparison, and issue #10 has not asked for per-hour accuracy. Additive
if it does.

**A `run` table, and ingest-run history.** Rejected, extending ADR-0002's ruling.
v1 has exactly one ingest — loading the frozen dataset, issue #21 — and a
manually-triggered replay whose failure is visible in the GitHub Actions run that
produced it. A table would record what the workflow log already shows.
`retrieved_at`/`source` on observed prices and `executed_at`/`code_version` on
forecasts carry the provenance that matters.

## Migrations

**`dbmate`**: plain SQL up/down files in `db/migrations/`, its own
`schema_migrations` table, a single static binary in CI. It is the smallest thing
that is still a real migration tool — no ORM, no DSL, the `.sql` files are the
artifact — which matters because ADR-0004 made the schema the contract between
Python and TypeScript. Alembic would drag SQLAlchemy into a repo that reads via
`psycopg` and hand-written row types, and would let one language own a schema both
must obey. A hand-rolled `psql` loop is a weekend of ordering, advisory-lock and
partial-failure edge cases for no gain.

**A generated `db/schema.sql` is committed.** A pull request that changes the
cross-language contract should show that change in its diff, not only as a delta
file someone has to apply mentally.

**Roles are created once by hand in Neon and documented; every `GRANT` lives in a
migration.** Role creation is a one-time credential act that does not belong in
version control, but grants are schema and change with every table — so a new
table cannot ship ungranted or, worse, over-granted to the reader role that
ADR-0004 restricted to `SELECT`.

Migrations run in their own Actions job on merge to `main`, per ADR-0004.

## Retention

**Nothing is ever deleted from the historical record.** `observed_price` is
permanent. The derived tables are deleted and rewritten by the jobs that
regenerate them, which is regeneration rather than deletion — the distinction the
rule turns on.

Retention only becomes a real question when unattended live rows accumulate, which
belongs to issue #19. On a store this size the answer will very likely still be
never.

## Consequences

**Issue #21 gains a second write.** Landing the frozen dataset now means writing
`observed_price` and `repaired_observed_price` in one transaction, with grid
repair applied on the way in. The parity check ADR-0001 asked for — repaired
prices reproducing `sources/CZ.csv` exactly — becomes a test over a stored table
rather than over a function's return value, which is a better test.

**Issue #10 inherits three things.** The disclosure obligation on rMAE, now
unenforced by storage. The definitions of `mae`, `rmse`, `smape` and `rmae`, which
live in `CONTEXT.md` because the metric names are unqualified. And a flag:
**SMAPE degrades badly on this series specifically** — its denominator `|a| + |f|`
approaches zero wherever the price crosses zero, which CZ prices genuinely do, so
a handful of near-zero hours can dominate the average. It is cheap to store and it
is in the thesis, so it belongs in the table; whether it belongs on the dashboard
is #10's call.

**Issue #12 inherits index design.** Two indexes ship — `forecast
(delivery_date)` and `published_metric (model, scope_type)` — because those
queries are certain. Everything else waits for the API surface, since on a store
this size a missing index is a slow query and not an outage.

**The live cutover's storage half is now answered.** Live forecasts join the same
tables, distinguished by `run_type`, exactly as ADR-0002 intended. What remains of
that question is product framing and immutability, which still hang on issues #19
and #15.

**Model artifact storage is closed, not deferred.** ADR-0003 established that
nothing this project produces is a stored artifact; `model_version` on the
forecast row is the whole of what remained.
