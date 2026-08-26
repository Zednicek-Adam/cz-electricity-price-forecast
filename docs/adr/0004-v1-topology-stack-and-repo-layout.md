---
status: accepted
---

# v1 is four units across three vendors, and the request path never computes

The opening sketch proposed four services in four containers. This replaces it.
v1 is a **backtest over a frozen dataset**, so there is nothing to scrape and
nothing to schedule — the units that survive are the ones v1 actually uses:

| Unit | What it is | Where it runs |
|---|---|---|
| **Replay workflow** | Python. Loads the frozen dataset, drives the runner over 2020-01-01 → 2024-12-31 for all three models, writes forecasts and published metrics | GitHub Actions |
| **Store** | Postgres. System of record for observed prices, forecasts and published metrics | Neon |
| **Read API** | TypeScript / Hono. Screen-shaped read-only endpoints, no computation | Cloudflare Worker |
| **Client** | TypeScript / React, built with Vite, shipped as static assets | The same Worker |

Three vendors — GitHub, Neon, Cloudflare — which issue #3 proved is the floor: no
free tier can both schedule a job and run a heavy scientific Python stack, so the
trigger lives outside the platform that hosts the app.

## The shape of the decision

**v1 deploys only what v1 uses; the store and the runner are live-shaped anyway.**
The live branch (issues #7, #19, #15) will need a scheduler, an ingest adapter and
mutable daily rows. None of that is deployed now. This is affordable because
ADR-0002 already bought the expensive half of live-readiness: the live cutover
swaps one `HistoryProvider`. So the rule is — *the schema and the runner interface
are shaped for live, the deployment topology is shaped for v1*. Standing up a
scheduler with nothing to schedule reads worse in a portfolio than an honest small
system.

**The store is the system of record, and the request path reads rows.** The runner
writes; the API selects. Nothing is computed per request — including the accuracy
figures, which the replay computes once and writes as **published metrics** rather
than recomputing per page load. This keeps the API a pure reader, keeps Neon's
100 CU-hour monthly budget away from an aggregate over 131,544 forecasts, and
means Cloudflare's 10 ms CPU ceiling never binds.

**The Python/TypeScript seam is the schema, not an API.** The runner writes rows
and the API reads them; they never speak over HTTP. So the contract between the
two languages is SQL: **plain SQL migrations are the source of truth**, TypeScript
types are generated from the live database, and Python reads via `psycopg` into
hand-written row types. Neither language owns a schema both must obey. The
API-to-client seam is TypeScript on both sides in one workspace, so it gets type
safety by import, with no code generation.

**Two database roles.** The replay workflow connects as a writer; the API connects
as a role holding `SELECT` only; the client reaches nothing but the API.
Migrations run from their own GitHub Actions job on merge to `main` — owned by
neither the runner nor the API. This makes "the public surface cannot corrupt the
historical record" a database fact rather than a promise, the same move ADR-0002
made with the model seam.

**Single repo, plain directories.** `forecast/` (Python: models, runner, loader),
`api/` and `web/` (TypeScript, one pnpm workspace), `db/` (SQL migrations),
`.github/workflows/`. `uv` for Python, `pnpm` for TypeScript, no monorepo
orchestrator. Ported model code arrives as a hand-written port with **no history
transplant** from the private `epf-diploma` repo — ADR-0003 already ruled the
thesis output is a specification to satisfy, not an artifact to reproduce, so
importing its history would import provenance for code that is not being kept. A
citation in the README is the honest version of that link.

**Local development needs Docker for exactly one thing.** `docker compose up db`
for Postgres; `uv sync` and `pnpm install` run natively; `wrangler dev` and Vite
run outside any container. Developing against a Neon branch instead was rejected:
it would put every developer's test writes on the binding CU-hour budget and make
offline work impossible.

## Considered options

**A Python read API (Vercel Hobby), to keep one language.** Rejected — the premise
is false. The client is TypeScript regardless, so the repo has both languages
whichever way the API goes; there is no one-language option to protect. What
remained were real costs: cold starts on a link a recruiter clicks, a fourth
vendor, and Hobby's non-commercial-use restriction. The shared-code argument is
weaker than it looks, because the API does no modelling — it reads rows the runner
already wrote. Cloudflare Workers have no cold start and host the static client on
the same deployment.

**Static site generation with the data baked in.** The most tempting rejected
option, and the one whose usual objections do not apply: v1's data never changes,
and even on the live branch a daily rebuild fits inside Cloudflare's free build
allowance. It was rejected for two other reasons. First, it is not a rendering
strategy sitting on top of the store decision — it is a *different answer to it*,
arriving one layer down, and it would leave the API with no callers and the
database as a build-time input. Second, it reimplements queries as a file tree:
every view anyone might want must be enumerable at build time, and any slice that
is not (an arbitrary date range, a filter combination) forces either a full-series
download into the browser or an API after all. Its one genuine advantage — first
paint — is recoverable inside the chosen shape by pre-rendering the landing view's
payload later, which issue #12 may ask for.

**A general-purpose resource API, or GraphQL.** Rejected. The consumer set is
closed: one client, in this repo, importing the API's types across the workspace.
Generality nobody consumes is paid for in over-fetching, round trips and
client-side joins — and a general API would push the accuracy join back into the
browser immediately after this ADR deliberately moved it into the replay. GraphQL
adds a runtime and a schema layer to a read-only site with three tables. The rule
instead: **an endpoint exists because a view needs it, and disappears when that
view does** — which makes issue #12 the thing that specifies the API, in the right
order.

**A formal monorepo (Turborepo / Nx), or a repo per unit.** Rejected in both
directions: task orchestration would be the most complex thing in a repo of four
barely-coupled units, and separate repos fragment a portfolio piece across
checkouts a reader has to reassemble.

**Migrations applied by the runner on startup.** The common shortcut, and wrong
here: the replay is a batch job that may be re-run over five years of forecasts,
and coupling schema evolution to it makes a migration failure and a replay failure
look identical.

**Everything in containers**, per the opening sketch. Rejected — it containerises
three things that are worse for it: the replay wants the host's CPU, and
`wrangler dev` and Vite are both degraded inside a container.

## Consequences

**Issue #12 now specifies the API.** Endpoints are screen-shaped, so the dashboard
prototype is the input to the API surface rather than a consumer of it. The
pre-rendered landing payload is also #12's call.

**Issue #11 inherits a narrower persistence question.** The store is Postgres on
Neon, migrations are plain SQL and are the cross-language contract, and there is a
third table to design — published metrics — that ADR-0002's two-table split did
not anticipate.

**The replay must recompute published metrics whenever it writes forecasts.**
Metrics are derived rows, so a partial re-run can leave them describing forecasts
that no longer exist. Recomputation belongs inside the replay, not beside it.

**Cloudflare's Static Assets support is load-bearing** for serving the client and
the API from one deployment. Worth re-verifying against current documentation
before the first deploy; the fallback is Pages plus a routed Worker, which costs
an origin configuration and nothing architectural.

**CI/CD shape is now specifiable** and was fog until this ADR: four units, three
vendors, migrations on merge to `main`, and a replay workflow that is also the
live daily job rehearsed against frozen data.
