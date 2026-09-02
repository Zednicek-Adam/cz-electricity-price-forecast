---
status: accepted
---

# `main` deploys itself, the replay never fires on its own, and derived rows rebuild whole

ADR-0004 fixed the units and the vendors and left the pipeline as fog. This is the
pipeline: what a pull request runs, what a merge to `main` does, and what is
allowed to trigger the replay.

| Trigger | What runs |
|---|---|
| **Pull request** | Three parallel check jobs (Python, TypeScript, DB) behind one required aggregator, plus a Cloudflare preview deploy |
| **Merge to `main`** | `migrate` (dbmate → Neon), then `deploy` (Vite build → `wrangler deploy`), sequential |
| **Manual only** | The replay, and the multi-day smoke replay |
| **Nothing** | There is no schedule. v1 has no unattended job |

## The pull request gate

**One workflow, three parallel jobs, no path filtering, one required "all green"
aggregator.** Python: `ruff check`, `ruff format --check`, `pytest`. TypeScript:
`tsc --noEmit`, `eslint`, `vitest`, once for the pnpm workspace. DB: `dbmate up`
against an ephemeral Postgres, then assert the regenerated `db/schema.sql` matches
the committed one — which is what makes ADR-0005's committed schema file true
rather than aspirational.

Path-filtered jobs were rejected. A filtered job that is also a *required* check
stays permanently pending and blocks the merge, and the usual workaround — dummy
always-succeeds jobs — is more machinery than the filtering saves. Each job is
seconds; filtering optimises a cost this repo does not have and buys a class of
merge-blocking bug in exchange.

**CI's database is a Postgres service container, never Neon.** ADR-0004 rejected a
Neon branch for local development on CU-hour grounds and left CI open as a separate
budget; the answer is the same for a different reason. The service container is
free, ephemeral, and is the *same* Postgres that `docker compose up db` gives
locally, so migrations and repository tests have one code path rather than two. It
also makes the only interesting persistence test possible: ADR-0005's rule that the
loader writes `observed_price` and `repaired_observed_price` **in one transaction**
is not assertable without a real database.

The gate proves migrations apply cleanly to an *empty* database, which does not
prove they apply to one holding five years of forecasts. The gap is accepted rather
than closed: the tables are ~10 MB and expand-only migrations do not rewrite rows,
so a seeded-database CI step would cost more than it protects.

## Testing the model layer

ADR-0003 removed numerical parity as the bar, leaving "satisfies its specification,
plus code review, plus landing somewhere sane on the scoreboard". That is a bar for
the correctness of a port; it does not say what a pull request runs. It runs this,
and this is a ceiling rather than a floor — the tests are deliberately thin:

- **The naïve model is asserted exactly.** It is a lookup, so it is testable to the
  value.
- **AR-168 gets structural tests, not oracle tests.** A synthetic pure-AR series
  recovers its coefficients; `diffinv` round-trips the `d=1` differencing; the
  recursion produces 24 steps.
- **Interface conformance for all three** — 24 floats on the repaired grid, no
  NaN, including a spring-forward and a fall-back day.
- **The purity seam.** A test that the `forecast` call holds no store handle, no
  provider and no clock. This is the highest-value test in the repo: ADR-0002 made
  look-ahead *unreachable* by construction, and nothing else in the system defends
  that as the code grows.

**Chronos-2 never runs in the pull request gate** — downloading pinned weights per
PR is minutes of network for no signal. A separate manually-triggered **smoke
replay** runs all three models over ~5 real days end to end into the service
container, which is what catches wiring bugs the unit tests cannot see.

## Merge to `main`

`migrate` then `deploy`, sequential. Migrations first, because the reverse order
deploys an API that queries columns which do not yet exist.

**Migrations are expand-only.** Add tables and columns; never drop or rename in the
same pull request as the code that stops using them. This is what makes the
awkward case — migration succeeds, deploy fails — a **no-op**: the database is
merely ahead of the Worker, the old Worker keeps working, and recovery is re-running
the deploy rather than rolling back the database. `dbmate` down files exist because
dbmate wants them and CI exercises them against the service container, but
**`dbmate down` is never run against Neon**. That is the operational form of
ADR-0005's "nothing is ever deleted from the historical record".

**Every merge deploys, with no path filtering**, for the same reason the gate has
none. A `wrangler deploy` of an unchanged bundle is idempotent and takes seconds,
and "`main` is exactly what is deployed" is worth more than the seconds saved.

## Pull requests get a preview, pointed at production

A Cloudflare preview version per pull request, reading **production Neon through
the read-only role**.

This is where ADR-0004's two-role split pays off in a way nothing had yet used: a
preview against the system of record is safe *by construction*, because the
credential it holds physically cannot write. There is one Neon database and CI runs
on a service container, so the alternative was a preview pointed at nothing — and an
unreachable preview is no preview. It is also the only thing that makes the deferred
front-end quality work reviewable at all; that work is unjudgeable without a link to
open.

Two costs, accepted knowingly. Neon CU-hours are noise for a preview someone clicks,
but not for a client that polls — so **the client has no auto-refresh**. And a
Cloudflare preview URL is publicly reachable regardless of repository visibility,
so **the dashboard becomes public before the repository does**: issue #20's
attribution, no-endorsement line and maintainer contact are due at the **first
preview deploy**, which is earlier than #20 assumed.

## The replay is manual, and derived rows are always rebuilt whole

**`workflow_dispatch` only. No schedule, and never on merge to `main`.** The replay
writes to production Neon; firing it on every merge is expensive and dangerous, and
v1's data never changes, so it is a thing that runs deliberately when model code
changes. Inputs are the model set and the date range.

**Forecasts are incremental; derived rows are always a full rebuild.** ADR-0004
requires published metrics be recomputed whenever forecasts are written and named
the partial re-run as the failure mode; ADR-0005 makes a re-run delete and re-insert
per `(model, run_type, delivery_date)`. Neither settles `model_comparison`, whose
Diebold–Mariano rows are **pairwise** — so no per-model incremental metric update is
even well-defined. The rule instead: the workflow writes forecasts per model, then
recomputes *all* `published_metric` and *all* `model_comparison` rows from scratch as
its final step, in one transaction. It is then structurally impossible for the
scoreboard to describe forecasts that no longer exist.

## Secrets, and a third database role

ADR-0004 said two database roles. **There are three.** `GRANT` requires ownership,
and ADR-0005 puts every `GRANT` in a migration, so the `migrate` job cannot connect
as the writer.

| Secret | Held by |
|---|---|
| Neon **owner** URL | `migrate` job |
| Neon **writer** URL | replay workflow |
| Neon **reader** URL | the Cloudflare Worker |
| `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit) + account id | `deploy` and preview jobs |

The three GitHub-side secrets live in a `production` GitHub Environment. **The
reader URL is set once by hand with `wrangler secret put` and never enters GitHub
at all.** No ENTSO-E token and no Hugging Face token exist in v1: v1 reads the
frozen dataset, and `amazon/chronos-2` is a public Apache-2.0 artifact. The ENTSO-E
token stays in the gitignored `.env` until the live branch needs it.

## The repository goes public when the runner needs Actions for real

Not now, and not at launch — at the point the replay has to run on GitHub Actions.
Issue #20 already cleared the licence for both the dashboard and the committed
dataset, and the history is clean: `.env` was never committed on any branch and
`analysis/raw/` is untracked.

Until then the gate runs on the private Free tier's 2,000 minutes a month. Three
fast jobs are nothing; the smoke replay is not, so **while private, the smoke replay
stays manual and infrequent**. Going public is the trip-wire that removes that
constraint. The known cost of public — GitHub auto-disabling scheduled workflows
after 60 days of inactivity — does not touch v1, which has nothing scheduled, and
belongs to issue #15.

## What "deployed" means when `main` is broken

**A GitHub Actions status badge in the README, and nothing else.** No `/health`
endpoint, no uptime monitor, no status page.

Making the replay manual bought something worth naming: **v1 has no unattended job
and therefore no silent failure mode.** Every failure is a red workflow run on a page
that already exists. The badge is one line of markdown, zero infrastructure, and on
a public repository it does double duty as a credibility signal to a reader. If the
deploy job is red, `main` is not deployed, and the badge says so.

## Consequences

**ADR-0004's "two database roles" is amended to three.** The owner role is a
one-time hand-created credential in Neon, like the other two.

**Issue #20's obligations come due earlier than it assumed** — at the first preview
deploy, not at the repository flip or at launch.

**Observability leaves the map's fog for v1.** There is no unattended job to fail
silently; the badge is the whole answer. The question survives intact on the live
branch, where issue #15 introduces the first thing that can fail while nobody is
looking.

**The client must not auto-refresh**, or preview and production traffic starts
drawing on Neon's CU-hour budget continuously.

**No `CONTEXT.md` change.** A pipeline is implementation, not domain language.
