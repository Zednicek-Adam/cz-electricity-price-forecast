---
status: accepted
---

# The records are two CSV files, the dashboard is static, and the record is one pooled series

Issue #86. v1 put a Neon database and a read API between the replay and the
browser: five tables, three roles, migrations run by a pinned `dbmate`
container, a byte-for-byte schema check, generated row types and a Hono Worker
(ADR-0004, ADR-0005, ADR-0014). That machinery was sized for a record that
changes every day and is read by more than one writer. The record v1 actually
had was a finished backtest written once, and when the daily run arrived it
turned out to append one delivery day a day. Both fit in a file.

## The decision

**Two CSV files in `data/` are the store.** `cz-day-ahead-prices.csv` holds the
observed prices as published, at true market periods (ADR-0001), hourly to
2025-09-30 and quarter-hourly from 2025-10-01. `forecasts.csv` holds one row
per forecast run: delivery day, model, `run_type`, `model_version`,
`code_version`, `executed_at`, and the 24 forecasts. Git history is the audit
trail and the protection: a changed price is a diff in a commit, where it used
to be a refused `UPDATE`.

**The dashboard is static files, generated at deploy time.** `forecast.export`
reads both records, repairs the grid, computes every published metric, the
running metric and the Diebold–Mariano tests, and writes one JSON file per view
into `web/public/data/`, which Vite copies into the build. The Worker serves
static assets only. Nothing derived is committed: every deploy rebuilds every
file, so ADR-0010's "derived rows rebuild whole" holds with no code to keep it
true.

**The daily run commits, and the commit deploys.** ADR-0011's run is
`forecast.daily`: ingest appends the newly published delivery days, then every
model forecasts the first day without a price, as `live`. `daily.yml` commits
both files to `main` with a deploy key; the push starts `main.yml`, which
exports, builds and deploys. There is no per-day preview: one appended day is
not worth reviewing, while a replay, which rewrites history, still goes through
a pull request.

**Backtest and live forecasts are pooled into one record.** Every metric is
computed over all forecast runs together. `run_type` stays on every row as
provenance, so the split can be recovered, but no figure on the dashboard is
per run type. The record therefore runs continuously from 2020-01-01 to the
pending day: 2020–2024 is the production backtest of 2026-09-28, copied out of
Neon unchanged, and 2025-01-01 to 2026-10-13 was replayed as backtests on
2026-10-12 so the daily run starts without a gap.

## What this supersedes

- **ADR-0005** (five tables on plain Postgres) and **ADR-0014** (`dbmate` in a
  container): superseded. There is no database.
- **ADR-0015** (the running metric in the Worker): superseded, and reversed.
  The running metric is computed in Python with every other figure, so all the
  metric math is in one language.
- **ADR-0004**: amended. Two units, `forecast/` and `web/`, across two vendors,
  GitHub and Cloudflare. "The request path never computes" holds more strictly
  than before: there is no request path, only files.
- **ADR-0002**: amended. "Backtest and live are never pooled" is dropped for
  the dashboard; the cutoff, the purity of a model and "missing history raises
  and writes nothing" are unchanged.
- **ADR-0011**: amended in two places. The Average Rule price is derived on the
  way *out* of the record, in `forecast.loader`, rather than stored beside the
  quarter-hours: with one reader and one implementation there is nothing for a
  stored copy to keep in step. And the forecast step targets the first
  delivery day without a published price rather than "D+2"; at 14:35 those are
  the same day, and after a missed run the rule still finds the right one.
- **ADR-0010**: amended. Previews build from the records as the pull request
  leaves them and read nothing in production; the smoke replay is gone, since a
  short replay is the same command with `--start` and `--end` and needs no
  credential.
- **ADR-0012**: unchanged, except that the staleness warning it owed is built:
  the dashboard says the daily run has stopped once the pending day is no
  longer ahead of today in `Europe/Prague`.

## Consequences

- **No Docker, no Postgres, no database credentials** anywhere in development
  or CI. The gate is two jobs, `python` and `typescript`, behind `all-green`.
- **One commit a day lands on `main`**, authored by the daily run. That is the
  cost ADR-0012 refused to pay for a keepalive, accepted here because each of
  these commits carries data the dashboard shows.
- **`main` is protected by a ruleset**, not a classic rule, because only a
  ruleset can let the deploy key past the required check.
- **Write contention is the limit.** One scheduled writer appending one day
  works; a second scheduled job, or writes more often than daily, is the point
  to bring a database back.
- **The Neon design is kept, not deleted.** The tag `v1-neon` holds it; the
  Neon project, its roles and the three secrets stay provisioned. Switching
  back means loading every row appended since into Neon first (issue #86,
  section 6).
