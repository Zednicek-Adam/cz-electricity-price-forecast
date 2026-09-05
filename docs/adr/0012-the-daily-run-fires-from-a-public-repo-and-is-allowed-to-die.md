---
status: accepted
---

# The daily run fires from a public repo, and is allowed to die

The **daily run** — ingest, score, forecast, in the order ADR-0011 fixed — is a
single GitHub Actions workflow on one `schedule` line:

```yaml
on:
  schedule:
    - cron: "35 13 * * *"   # 14:35 CET / 15:35 CEST, Europe/Prague
```

The repository is **public**. Scheduled workflows in public repositories are
automatically disabled after 60 days without repository activity, and **we do
not defend against that**. When the schedule dies, it dies; the dashboard says
so, and a human turns it back on.

## Why the trigger is GitHub Actions

Issue #3 closed the option space rather than opening it: no free tier both
schedules a job and runs a heavy scientific Python stack, so the trigger was
always going to live outside the app platform, and ADR-0004 already put the
replay workflow on Actions. Reconfirming it here costs nothing and changes
nothing — the scheduler is a third vendor, and this is where that is written
down.

The alternative worth naming is a **Cloudflare Worker Cron Trigger** firing
`workflow_dispatch` through the REST API. It is the better trigger on the
merits: `workflow_dispatch` is never auto-disabled, so it removes the problem
this ADR otherwise has to accept, and it adds no vendor because ADR-0004
already puts a Worker in the topology. It is rejected because of what it puts
*in* that Worker — a long-lived GitHub token with `actions:write`. ADR-0004's
position is that the request path cannot write, by construction and not by
policy; the read-only Neon role is the mechanism, and handing the same Worker a
credential that can start jobs in this repository undoes the thing that made the
posture worth having. It also trades one silent death for another, since a PAT
expires on a clock nobody is watching either.

## Why public, and why nothing keeps it alive

Public and private differ in exactly two ways that matter here. Public repos get
**unlimited** Actions minutes on standard runners; GitHub Free private repos get
2,000 a month, against the ~450 the daily run needs — affordable, but it is what
forced ADR-0010 to ration the smoke replay. And public repos are the only ones
the 60-day rule touches at all.

So private is the durable choice, and it is rejected: the code being readable
*is* the portfolio piece. A private repo would keep a public dashboard running
in front of a codebase nobody can open, which inverts what the project is for.

That leaves the 60-day rule to answer. The standard mitigation is a keepalive
commit — the workflow pushing a trivial timestamp file every few weeks, which is
inert for CI because events triggered by `GITHUB_TOKEN` do not create workflow
runs, so it would not trip ADR-0010's unfiltered deploy-on-merge. It works, it
is a dozen lines, and we are not doing it.

The reason is what the 60-day clock actually measures. It expires only after two
months in which nobody has pushed to this repository — which is to say, only
once the author has stopped attending to the project entirely. A keepalive would
keep the job running for a person who is no longer looking, at the cost of a
robot commit every month in a `git log` that is itself an exhibit. The honest
posture is the one this ADR takes: the system runs while it is tended, announces
plainly when it has stopped, and is one click from starting again
(`gh workflow enable`). **This amends the map's "stays up unattended for years"
constraint**, which is retired as stated: unattended for *months*, and loud
about the end.

## Where the schedule time is stated

Cron is UTC and the run window is `Europe/Prague`, so one fixed line drifts an
hour twice a year: `35 13 * * *` is 14:35 in winter and 15:35 in summer. There
is no guard step, no pair of DST-aware cron lines, and no timezone arithmetic
anywhere.

The drift is harmless because ADR-0011 removed the far deadline. The run must
start after the D+1 prices publish — 13:10 local, worst observed 14:25 across
the month issue #14 measured — and must finish before the D+2 prices publish at
13:10 the *next* day. That is roughly 22 hours of margin on a one-sided window,
and DST moves the run one hour **later** in summer, which is the safe direction.
The `:35` avoids the top of the hour, which GitHub names as its high-load window
for delayed `schedule` events.

## Delay, drops and failure

ADR-0011 already made this cheap: ingest reconciles, so a firing that arrives
late, or never, needs no catch-up logic. The next run finds the missing day and
fetches it. Nothing here assumes exactly-once delivery.

**Forecasts do not heal, and that is accepted.** A run that fails leaves no
trace in the store for ingest — the day is simply still missing — but the
forecast it did not write is a permanent hole in the live series, because the
next day's run targets D+3 and nothing backfills D+2 as `live`. There is **no
automatic retry**: no second firing, no `continue-on-error`, no requeue. The
recovery paths are the manual ones the system already has — ADR-0010's
`workflow_dispatch` replay, and ADR-0011's rule that a missing live day is
regenerated as a `backtest` row so the hole stays visible as a hole.

This is the same posture as every other corrective path in the system: **only
the happy path is automated.** Repair is human-invoked, the replay is
human-invoked, re-enabling the schedule is human-invoked. Recovery is where
judgement belongs, and none of it is on the daily critical path.

One consequence for ADR-0011's wording: a run scores the forecast the previous
**successful** run made, which after a failed day is the run from two days ago.
The invariant it stated survives — there is still exactly one pending forecast
at any moment — but "the run before it" is not always the same as "yesterday".

## How a run proves it ran

A README Actions badge does not answer this and is not used for it. A badge
reports the last run's conclusion; a workflow that has stopped firing has no
last run to be red, so the badge stays green over a dead schedule. ADR-0010's
"a badge and nothing else" was bought by v1 having no unattended job at all, and
does not carry over.

**The dashboard carries the answer: a simple staleness warning.** The pending
forecast is for a named delivery day, and when that day is no longer in the
future the standing claim has gone stale — which is exactly the observable
signature of a daily run that has stopped, whichever way it stopped. The warning
says so in the product, to everyone who looks, with no new machinery and no
fourth vendor. Its wording and placement belong to the live branch's display
decisions.

Below that, at no cost: GitHub emails the workflow author when a scheduled run
fails, and warns before disabling a schedule for inactivity. Both are default
behaviour rather than anything this ADR builds, and neither is relied on.

Rejected: a dead man's switch on a free cron monitor. It is the only mechanism
that would *actively* report a stopped schedule, and it is a monitor with its
own liveness problem, in a project whose map already rules alerting out of
scope.

## Consequences

- The repository goes public. ADR-0010's "public when the replay first needs
  Actions for real" still sets the timing; this fixes the destination.
- Actions minutes stop being a budget. ADR-0010's rationing of the smoke replay
  is lifted once the flip happens.
- The daily run can stop firing after 60 quiet days, and will not restart
  itself. Recovery is `gh workflow enable`.
- A failed run costs one delivery day of the live forecast series, permanently,
  unless a human regenerates it as a backtest row.
- The live dashboard owes a staleness warning before the live branch can ship.
