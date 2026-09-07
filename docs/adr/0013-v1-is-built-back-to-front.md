---
status: accepted
---

# v1 is built back to front, and the first chart is the last thing to appear

Twelve ADRs settle what v1 is. None of them say what order it gets built in, or
which human-only steps gate each part. This is the second half of the map's
destination and the last decision on it.

The order is **unit-complete, back to front**: each of ADR-0004's four units is
finished before the next is started, store-ward first. The alternative — a walking
skeleton carrying the naïve model end to end through all four units in week one —
was considered at length and rejected below. The consequence is named up front
rather than buried: **the first end-to-end vertical slice, the earliest moment a
real forecast reaches a real chart, falls at the end of phase 3**, which is late.
That is the price of the order and it was paid knowingly.

## The phases

| Phase | What gets finished | First deployed? |
|---|---|---|
| **0** | The map lands on `main`; the repository goes public; the pull request gate and `migrate` stand up against a provisioned Neon | Nothing |
| **1** | `forecast/` and `db/` complete **except Chronos-2** — loader, runner, naïve, AR-168, metrics, Diebold–Mariano | Nothing |
| **2** | `api/` — Hono on a Worker, run locally with `wrangler dev` against Neon's reader role | Nothing |
| **3** | `web/`, the `deploy` job and previews, and the root README | **Everything, at once** |
| **4** | Chronos-2 joins the runner; the full replay is re-run; the README becomes the narrative one | — |

### Phase 0 — land the map, open the gate

The map's own output was the first blocker and did not look like one. Nine ADRs
sat on an unmerged linear branch stack and the frozen dataset on a tenth branch
beside it, so `main` held three ADRs and no data: an implementation session told to
"read `CONTEXT.md` and `docs/adr/`" would have found a quarter of the decisions and
none of the dataset. **Landing all of it on `main` through per-decision pull
requests, then deleting the ticket branches, is step one.** The `prototype/*`,
`research/*` and `analysis/*` branches stay — they never merge, they are cited from
ADR-0007 and from a dozen closed issues, and they are leaves rather than
work-in-progress.

Then the scaffold — `forecast/` under `uv`, the `api/` + `web/` pnpm workspace,
`db/`, `docker compose up db` — and ADR-0010's pull request gate: three parallel
jobs behind one required aggregator, plus `migrate` on merge to `main`. **No
`deploy` job and no previews yet**; see phase 3.

### Phase 1 — the store and the runner, minus the foundation model

The five tables of ADR-0005; the loader writing `observed_price` and
`repaired_observed_price` in one transaction; ADR-0002's pure-function seam and the
test that defends it; the naïve model and AR-168; published metrics and
`model_comparison` rebuilt whole per ADR-0010.

**Chronos-2 is deliberately not here.** It is the one part of `forecast/` with a
different failure mode — a pinned artifact, minutes of weight-downloading, banned
from the pull request gate by ADR-0010, and a full-period replay slow enough to
need a runner. Everything downstream of it is complete without it: the naïve model
is rMAE's denominator, AR-168 exercises the real `ar_lm_predict` port, and the
schema, the metric shapes, the API and the charts are all model-count-agnostic.
Deferring it adds a model to a finished unit rather than leaving the unit
unfinished, so it does not violate the order. It also honours the map's standing
constraint that model accuracy blocks nothing and tuning is the last phase.

**The first real replay runs locally**, connecting to Neon as the writer role.
ADR-0010 makes Actions the replay's home and that stands, but while the loader,
the grid repair and the metric rebuild are still wrong in the ways first drafts are
wrong, a `workflow_dispatch` round trip per attempt is a bad debug loop. The
workflow is written in this phase and proven on a short range; the 1,827-day run
that fills the database is driven from the author's machine.

### Phase 2 — the API, undeployed

ADR-0004 made issue #12 the thing that specifies the API, and ADR-0007 did: the
endpoints are the Day view, the Over time view, the ribbon, the accuracy table and
the Diebold–Mariano card, and nothing else — an endpoint exists because a view
needs it. Built against the reader role, run under `wrangler dev`, still not
deployed. There is no client to serve, and an empty deployment checks nothing.

### Phase 3 — the client, the deploy pipeline, and the README, together

visx primitives per ADR-0009 and the layout per ADR-0007; then the `deploy` job
and preview deploys; then, and only then, Cloudflare gets provisioned.

These three arrive together because ADR-0010 binds them together. **Every pull
request gets a preview URL that is publicly reachable regardless of repository
visibility**, which is what makes issue #20's obligations due at the first preview
deploy. So the root README — the attribution line, the no-endorsement disclaimer,
the maintainer contact `data/NOTICE` already points at, and the written take-down
commitment — **is a build step in this phase, due before the first pull request
that touches `web/`**, not a launch-day task. It is not a wayfinder ticket: its
content is already decided by issue #20, and the map ships no deliverables.

This is also the phase that meets every integration risk at once, which is the
order's weak point stated plainly: ADR-0010's own accepted gaps — Cloudflare Static
Assets unverified against current documentation, `migrate`-before-`deploy`, the
preview's read-only credential, the reader URL set by hand outside GitHub — all
fail here or nowhere. **Re-verify Static Assets before wiring anything**, because
the fallback (Pages plus a routed Worker) changes the deployment shape and is much
cheaper to discover before the client exists than after.

### Phase 4 — Chronos-2 and the narrative README

Chronos-2 joins the runner behind the same interface, the smoke replay proves it
end to end over ~5 days, and the full replay is re-run to add the third model —
with all `published_metric` and `model_comparison` rows rebuilt whole, so the
scoreboard cannot describe forecasts that no longer exist. The README grows from
its obligations into the narrative: that this is a backtest presented as one, that
the flagship is a productionised foundation model rather than one that was invented
here, that rMAE across this record is not comparable to figures from other test
windows, and that per-day rMAE ranges 0.07–3.73.

## Provisioning: the human-only gates

Every row is a step no agent session can perform, so every row blocks everything
behind it.

| Step | Gates | Due |
|---|---|---|
| Flip the repository **public** | unmetered Actions, the smoke replay, coherent preview URLs | Phase 0 |
| Create the **Neon project** | the entire store | Phase 0 |
| Neon **owner** role → `production` GitHub Environment | `migrate` — owner is needed because ADR-0005 puts every `GRANT` in a migration | Phase 0 |
| Neon **writer** role → local `.env`, then the same Environment | the loader and the replay | Phase 1 |
| Neon **reader** role | the API | Phase 2 |
| **Cloudflare account** | any deploy | Phase 3 |
| `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit) **and account id** → the same Environment | `deploy` and preview jobs | Phase 3 |
| `wrangler secret put` the **reader URL** — never enters GitHub | the deployed Worker reaching Neon | Phase 3 |
| Root **README** carrying issue #20's four obligations | the first preview deploy | Phase 3, before the first `web/` pull request |
| Persistent **dashboard footer** attribution | every view rendering the price series | Phase 3 |

Three Neon roles, not ADR-0004's two — ADR-0010 already corrected that, and this
table is where the correction becomes a checklist. No ENTSO-E token and no Hugging
Face token exist anywhere in v1.

## Considered options

**A walking skeleton first** — the naïve model, one delivery day, the full schema,
loader → replay → Neon → Worker → one chart, deployed in week one, then thickened.
The strongest rejected option, and the one this ADR is most likely to be wrong
about. Its case is exactly the weak point named in phase 3: three vendors is the
project's stated risk, every accepted gap in ADR-0010 is a wiring gap, wiring gaps
fail at integration rather than in unit tests, and on a ~1-month budget meeting all
of them in the final week is where a schedule dies. Rejected anyway, on the
judgement that finishing a unit at a time produces a coherent system and a legible
commit history for a piece whose entire claim is engineering, and that a skeleton's
scaffolding tends to survive into the finished thing. The risk it declines to buy
is real and is written down here so that, if phase 3 goes badly, the reason is on
the record rather than a surprise.

**Building `deploy` and previews at phase 0**, with the rest of the pipeline. This
would have bought back most of the walking skeleton's integration insurance for
almost nothing — a Worker serving an empty database proves the Cloudflare wiring
without proving anything else. Rejected because it drags the README forward with
it: previews are public, so the attribution obligations bind, and the README would
have to be written in week one and rewritten at launch. A stub README on a public
repository for the whole build is worse than a late one.

**Chronos-2 in phase 1, or the naïve model alone in phase 1.** Both rejected, in
opposite directions. Chronos-2 in phase 1 puts the slowest, most network-bound,
least gate-testable component on the critical path for no downstream benefit.
Naïve-only would leave the metric tables designed against a lookup table, with the
first real port arriving after the schema had hardened around it.

**Landing the branch stack as one squashed commit.** Rejected: the per-decision
commits are the map's audit trail, each already reviewed on its own issue, and
squashing nine settled decisions into one loses the link between an ADR and the
conversation that produced it.

## Consequences

**ADR-0010's visibility trigger is amended.** It flips the repository public "at
the point the replay has to run on GitHub Actions for real" — this brings it
forward to **phase 0**. The reason to wait has evaporated: ADR-0010 itself confirms
`.env` was never committed and `analysis/raw/` is untracked, issue #20 cleared both
the dashboard and the committed dataset, and staying private costs a minutes
ceiling, a constrained smoke replay and preview URLs pointing into a repository
nobody can open. The known cost of public — GitHub disabling scheduled workflows
after 60 days idle — still does not touch v1, which schedules nothing.

**ADR-0010's replay location is narrowed, not changed.** Actions remains the
replay's home; the *first* real replay is driven locally as the writer role.

**The README is a build step and not a wayfinder ticket**, carrying issue #20's
obligations in phase 3 and the narrative in phase 4.

**The map closes with this ADR.** Its destination — every architectural decision
locked, plus a build order — is met. Its four remaining fog patches are all gated
on the system existing: observability belongs to the live branch, the demo
narrative is now this ADR's phases 3 and 4, and front-end quality and what the live
branch displays both want a standing dashboard to react to. Those are a future
map's fog, not this one's.

**No `CONTEXT.md` change.** A build order is implementation, not domain language —
the same call ADR-0010 made about the pipeline.
