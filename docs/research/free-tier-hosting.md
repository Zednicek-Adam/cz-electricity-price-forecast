# Free-tier hosting that can actually run this workload

Research note for [issue #3](https://github.com/Zednicek-Adam/cz-electricity-price-forecast/issues/3) (part of the map, [#1](https://github.com/Zednicek-Adam/cz-electricity-price-forecast/issues/1)).

**All facts below were verified against first-party docs/pricing pages on 2026-08-02.** Free tiers move fast — several of the numbers here changed within the last 18 months, and the ones flagged **[FLUX]** look likely to change again. Re-verify before committing.

## The workload, restated in platform terms

| Component | Shape | What it stresses |
|---|---|---|
| Ingest + forecast job | Python, scientific stack (numpy/scipy/statsmodels/scikit-learn), runs a handful of times a day, minutes not seconds | Scheduled execution, image size, CPU allowance, secrets |
| Read API | Small, read-only, must respond fast whenever a visitor lands | Cold start / scale-to-zero |
| Postgres | A few hundred thousand hourly rows | Storage cap, inactivity pausing/deletion, TimescaleDB |
| Static frontend | Built SPA | Bandwidth, build minutes |

**Sizing sanity check.** ENTSO-E hourly series 2018→now is ≈70,000 rows. Add 24 forecast rows/day per model variant plus accuracy scoring, and "a few hundred thousand rows" is right. At ~100 B/row plus indexes that is **roughly 50–80 MB** — comfortably inside every 0.5 GB free Postgres here, with years of headroom. **Storage is not the binding constraint. Scheduling, cold starts and inactivity policies are.**

---

## Verdict first

**Recommended: Neon (Postgres) + GitHub Actions (scheduled job) + Cloudflare Workers with Static Assets (read API + frontend).**

Every piece is a permanent free tier, none of them expires, none of them sleeps in a way the visitor can feel, and the scientific Python stack runs on a GitHub-hosted runner where nobody cares that it is 800 MB.

**Main trade-off: the daily trigger lives outside the application platform.** There is no single "deploy the app and it schedules itself" target on any free tier that can also run a heavy Python job. That costs you a third vendor, a split deployment story, and one real unattended-operation hazard: **GitHub disables scheduled workflows in public repos after 60 days with no repository activity** — which must be actively mitigated, because "stays up unattended for years" is a fixed constraint of this project.

Second trade-off: the read API in Workers is TypeScript, so the API and the model are in different languages. See [Alternatives](#alternatives-worth-taking-seriously) for the all-Python variant and its price.

---

## Summary table

| Platform | Free tier permanent? | Native cron on free? | Sleeps? | Free Postgres | Verdict for this workload |
|---|---|---|---|---|---|
| **Neon** | Yes | pg_cron exists but useless with scale-to-zero | Compute scales to zero after 5 min, wakes in "a few hundred milliseconds" | 0.5 GB, 100 CU-h/mo, **timescaledb supported** | **Use it — best free Postgres here** |
| **GitHub Actions** | Yes (free for public repos) | Yes, 5-min granularity | n/a | n/a | **Use it — the only free scheduler that can run a big Python image** |
| **Cloudflare Workers** | Yes | Yes (Cron Triggers, 5/account) | No cold start | No (D1 is not Postgres; Hyperdrive fronts Neon) | **Use for API + static.** 10 ms CPU/request is a hard ceiling; cannot run the model |
| **Vercel** | Yes (Hobby, non-commercial only) | Yes but **once per day, ±59 min** | Function cold starts | No first-party Postgres | Viable for API + static; **cron too weak** for "a few times a day" |
| **Supabase** | Yes | Yes (Supabase Cron / pg_cron, sub-minute) | **Project paused after 1 week of inactivity** | 0.5 GB, 2 active projects | Usable but **timescaledb is being removed**; pausing is a standing risk |
| **Render** | Free instances yes; **free Postgres no** | **No — cron jobs cost $1/mo minimum** | Free web service sleeps after 15 min, **~1 min to wake** | **Expires 30 days after creation** | **Disqualified as a whole stack** |
| **Railway** | Nominal $1/mo credit | Yes (5-min granularity) | No | Pay-as-you-go | $1/mo buys ~2 GB-hours — nowhere near an always-on service |
| **Fly.io** | **No free tier for new customers** | Machine schedules | Scale-to-zero available | Paid | **Disqualified** (though ~$2–5/mo is genuinely cheap) |
| **Netlify** | Yes ($0 forever, 300 credits/mo) | Scheduled Functions | Function cold starts | No | Fine for static only |
| **Koyeb** | **Closed to new signups** | — | — | — | **Disqualified** |
| **Hugging Face Spaces** | Static only; **Docker Spaces now need a paid plan** | No | Free hardware sleeps when unused | No | **Disqualified** |
| **Aiven** | Yes, "no time limit" | No | **Idle services are powered off** | 1 GB, 1 CPU, **TimescaleDB available** | Credible Neon backup, but the idle-shutdown wording is vague |
| **Oracle Cloud Always Free** | Yes | It's a VM — use system cron | No | Self-managed on the VM | Genuinely capable; wrong shape (you become the sysadmin) |

---

## Hard incompatibilities (the disqualifying findings)

These are the results that should change the plan, not just inform it.

### 1. Fly.io has no free tier at all any more

> "Fly.io no longer offers plans to new customers."
> — [fly.io/docs/about/pricing](https://fly.io/docs/about/pricing/)

Legacy allowances (3× `shared-cpu-1x` 256 MB VMs, 3 GB volume storage) survive only for accounts on Hobby/Launch/Scale plans **purchased before 2024-10-07**. New accounts are pure pay-as-you-go: `shared-cpu-1x` 256 MB is `$0.00000078/second` (**$2.02/month**), volumes $0.15/GB/mo, egress $0.02/GB in Europe. The only free-trial reference left in the billing docs is the legacy `$5` Hobby credit. **Fly is out on the "free" constraint, but note it is the cheapest credible paid answer at roughly $2–5/month.**

### 2. Render's free Postgres self-destructs after 30 days

> "**Free Render Postgres databases expire 30 days after creation.**"
> — [render.com/docs/free](https://render.com/docs/free)

There is a 14-day grace period to upgrade, then permanent deletion. Free Postgres is capped at 1 GB with no backups. **This alone disqualifies Render as a place to keep the data**, which is a shame, because Render *does* support `timescaledb` (PG13+, "Community features are not available", DB must post-date 2023-01-12) per [render.com/docs/postgresql-extensions](https://render.com/docs/postgresql-extensions).

Render's free web service also **spins down after 15 minutes without inbound traffic**, and resumption "takes approximately one minute" — precisely the 30-second-dashboard failure mode the issue calls out as a bad portfolio piece.

And **Render cron jobs are not free**: "There is a minimum monthly charge of $1 per cron job service" ([render.com/docs/cronjobs](https://render.com/docs/cronjobs); runs are killed at 12 hours). Free workspace allowances are thin too: Hobby workspace = **5 GB outbound bandwidth + 500 build pipeline minutes/month**, 750 free instance hours, up to 25 services ([render.com/docs/new-workspace-plans](https://render.com/docs/new-workspace-plans), [render.com/docs/free](https://render.com/docs/free)).

### 3. Vercel Hobby cron cannot run "a few times a day"

> "Hobby accounts are limited to cron jobs that run **once per day**. Cron expressions that would run more frequently will fail during deployment."
> — [vercel.com/docs/cron-jobs/usage-and-pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)

| | Cron jobs/project | Minimum interval | Scheduling precision |
|---|---|---|---|
| Hobby | 100 | **Once per day** | **Per-hour (±59 min)** |
| Pro | 100 | Once per minute | Per-minute |

A `0 1 * * *` job "will trigger anywhere between 1:00 am and 1:59 am". For a system whose whole premise is *producing D+1 forecasts before the day-ahead auction results publish*, a ±59-minute jitter plus a once-daily cap is a poor fit — and the workload explicitly wants ingest and forecast as separate runs a few times a day. **Hard "no" for the scheduler; Vercel remains fine for the API/frontend.**

### 4. Cloudflare Workers cannot run the model

Free plan: **100,000 requests/day**, **10 ms CPU time per invocation** (Cron Trigger invocations get the same 10 ms), 5 Cron Triggers per account, 3 MB gzipped script, 50 subrequests/request ([developers.cloudflare.com/workers/platform/limits](https://developers.cloudflare.com/workers/platform/limits/)). Paid raises CPU to 5 minutes for $5/mo.

Python Workers are **in beta**, require the `python_workers` compatibility flag, and support only pure-Python packages, Pyodide-bundled packages, and PyEmscripten wheels — which excludes native-extension packages. Only `aiohttp`/`httpx` are supported HTTP clients ([python docs](https://developers.cloudflare.com/workers/languages/python/), [packages](https://developers.cloudflare.com/workers/languages/python/packages/)). A LEAR recalibration is not happening in 10 ms of CPU inside Pyodide.

**Cloudflare Containers, the escape hatch, has no free tier**: the pricing table shows "N/A" for Free and requires Workers Paid at $5/mo ([containers/pricing](https://developers.cloudflare.com/containers/pricing/)).

### 5. Koyeb and Hugging Face Spaces are no longer options

- **Koyeb**: the pricing page today shows no free plan; cheapest is **Pro at $29/month**. Secondary reporting attributes the closure of the free Starter tier to new signups to Koyeb's **February 2026 acquisition by Mistral AI** — treat the *reason* as unverified, but the absence of a free plan on [koyeb.com/pricing](https://www.koyeb.com/pricing) is first-party. **[FLUX]**
- **Hugging Face Spaces**: > "Static Spaces are free for everyone. Gradio and Docker Spaces run on compute and **require a paid plan** to create: PRO for personal accounts" — [huggingface.co/docs/hub/spaces-overview](https://huggingface.co/docs/hub/spaces-overview). Free hardware also sleeps: "On free hardware, your Space will 'go to sleep' and stop executing after a period of time if unused." **[FLUX — this changed recently; Docker Spaces used to be free.]**

---

## The recommended pieces, in detail

### Neon — the Postgres

Free plan, per [neon.com/pricing](https://neon.com/pricing), [neon.com/docs/introduction/plans](https://neon.com/docs/introduction/plans), [neon.com/faqs/free-plan-limits-and-quotas](https://neon.com/faqs/free-plan-limits-and-quotas):

- **Permanent, not a trial**, no credit card required.
- **0.5 GB storage per project** (≈6–10× our projected need).
- **100 CU-hours per project per month** — "roughly 400 hours of runtime on a 0.25 CU instance".
- **5 GB/project/month** public network data transfer.
- 100 projects, 10 branches/project, autoscaling up to 2 CU (8 GB RAM).
- **Scale to zero after 5 minutes, not disableable on Free.** Wake: "it reactivates automatically within a few hundred milliseconds" ([scale-to-zero](https://neon.com/docs/introduction/scale-to-zero)).
- **Connections**: 0.25 CU gives `max_connections = 104` with 7 reserved for the superuser (97 usable); the PgBouncer pooler accepts "up to 10,000 concurrent connections" ([connection pooling](https://neon.com/docs/connect/connection-pooling)).
- **No inactivity deletion policy documented.** Exceeding a limit suspends, it does not delete: "None of these limits delete your data." Deleted projects are recoverable for 7 days.

**TimescaleDB: yes.** `timescaledb` is in Neon's supported extensions (2.10.1 on PG14–15 up to 2.24.0 on PG18), with the caveat: > "Only Apache-2 licensed features are supported. Compression is not supported." ([neon.com/docs/extensions/pg-extensions](https://neon.com/docs/extensions/pg-extensions)). Hypertables and continuous aggregates on the Apache-2 side are available; columnar compression is not.

**`pg_cron` is available (v1.6) but is a trap here**, and Neon says so plainly: > "`pg_cron` jobs will only run when your compute is active. We therefore recommend only using `pg_cron` on computes that run 24/7 or where you have disabled scale to zero." Free plan cannot disable scale-to-zero. **Do not schedule anything in the database.**

**The one real budget to watch: 100 CU-hours.** 400 hours at 0.25 CU against a 730-hour month means Neon free *cannot* be always-on. That is fine — scale-to-zero plus a few hundred milliseconds of wake is invisible — but it means **never add a naive "keepalive" ping loop**. A per-minute keepalive would burn the entire monthly compute allowance and suspend the project.

### GitHub Actions — the scheduler

Per [docs.github.com — billing for Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions) and [events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows):

- **"The use of standard GitHub-hosted runners is free: In public repositories."** Private repos on GitHub Free get **2,000 minutes/month** (a 5-minute job three times a day ≈ 450 min/month — comfortably inside it).
- **Minimum interval: 5 minutes.** Far better granularity than any free PaaS cron here.
- **No image size limit that matters** — the runner is a full VM; scipy, statsmodels and scikit-learn are a non-issue. This is the single biggest reason to put the job here.
- Secrets: repository/environment secrets are first-class and free; an ENTSO-E API token is `${{ secrets.ENTSOE_TOKEN }}`.
- Artifact storage 500 MB on Free; cache 10 GB per repo.

**Two caveats, both material:**

1. > "In a **public** repository, scheduled workflows are automatically disabled when **no repository activity has occurred in 60 days**."
   This is the biggest single threat to "stays up unattended for years". Note the asymmetry: **private repos are exempt** from auto-disabling but consume the 2,000-minute allowance. Mitigations, in rough order of robustness: keep the repo private (job comfortably fits 2,000 min/mo); or have the scheduled workflow itself create repository activity (e.g. commit a heartbeat/metadata file, or call the API to re-enable the workflow); or accept a monthly manual poke — which violates "unattended". **This needs an explicit decision, not a shrug.**
2. > "The `schedule` event can be delayed during periods of high loads... High load times include the start of every hour. If the load is sufficiently high enough, some queued jobs may be dropped."
   So: never schedule on the hour, and build the job to be idempotent and self-catching-up (on each run, ingest whatever is missing since the last successful run) rather than assuming exactly-once firing. That design also happens to give free backfill.

### Cloudflare Workers + Static Assets — API and frontend

Per [workers/platform/pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [limits](https://developers.cloudflare.com/workers/platform/limits/):

- Free: **100,000 requests/day**, 10 ms CPU per invocation, 5 Cron Triggers/account.
- **"Requests to static assets are free and unlimited."**
- No cold start in the meaningful sense — this is the strongest answer to the "dashboard must not take 30 seconds" requirement.
- **Hyperdrive is on the free plan**: > "Hyperdrive is included in both the Free and Paid Workers plans", free capped at **100,000 database queries/day** ([hyperdrive/platform/pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/)). It pools connections to Neon, which matters for a serverless API against a scale-to-zero Postgres.
- Cloudflare Pages (the older static product) free limits: **500 builds/month**, 1 concurrent build, 20-min build timeout, 20,000 files/site, 25 MiB max asset ([pages/platform/limits](https://developers.cloudflare.com/pages/platform/limits/)).

**The 10 ms CPU ceiling is the thing to design around.** It excludes I/O wait, so a query-and-serialize endpoint is normally fine — but a fat JSON payload of thousands of rows could brush it. There is a clean dodge that fits this app perfectly: since forecasts change only a few times a day, **have the scheduled job publish pre-rendered JSON snapshots as static assets** (free and unlimited, zero CPU), and keep the Worker only for the genuinely dynamic slices. Worth evaluating before writing a single API endpoint.

---

## Alternatives worth taking seriously

### Vercel Hobby + Neon — the all-Python variant

If keeping one language across API and model outweighs everything else, Vercel Hobby is a real option **for the API and frontend only**, with GitHub Actions still owning the schedule.

Per [vercel.com/docs/plans/hobby](https://vercel.com/docs/plans/hobby), [functions/limitations](https://vercel.com/docs/functions/limitations), [runtimes/python](https://vercel.com/docs/functions/runtimes/python):

- Free and permanent, no billing cycle. **But: "the Hobby plan restricts users to non-commercial, personal use only."** A portfolio piece qualifies; a portfolio piece that later becomes a paid product does not.
- Monthly included: **4 CPU-hours Active CPU**, 360 GB-hours provisioned memory, **1,000,000 function invocations**, up to 1,000,000 edge requests, 100 deployments/day, 200 projects.
- Functions: Hobby max **2 GB / 1 vCPU**, max duration **300 s** (default *and* maximum on Hobby), request/response body cap 4.5 MB.
- **Python bundle limit is 500 MB uncompressed** (vs 250 MB for Node), and "large functions" up to 5 GB exist on Fluid compute. A scientific Python API bundle is tight but feasible at 500 MB; use `excludeFiles` in `vercel.json`.
- FastAPI/ASGI is first-class (Python 3.12 default, 3.13/3.14 available; `requirements.txt` or `pyproject.toml`).
- No first-party Postgres — you attach Neon via the Vercel Marketplace or just a connection string.

Cost of this route: cold starts on a large Python bundle are seconds, not milliseconds, and 4 CPU-hours/month is a real budget once a Python function is doing anything but I/O.

### Supabase — good DX, two standing hazards

Per [supabase.com/pricing](https://supabase.com/pricing), [free-project-pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [compute-and-disk](https://supabase.com/docs/guides/platform/compute-and-disk):

- Free plan: **500 MB database** (Nano compute, shared CPU, up to 0.5 GB RAM), **5 GB egress + 5 GB cached egress**, 1 GB file storage, 500,000 Edge Function invocations, **limit of 2 active projects**. Connections: **60 direct, 200 pooler max clients**.
- **Supabase Cron is genuinely good**: `pg_cron` under the hood, schedulable from the dashboard, can run SQL, call a database function, make an HTTP request or invoke an Edge Function, and supports **sub-minute schedules** ("You can use [1-59] seconds... as the cron syntax", requires PG ≥ 15.1.1.61) ([guides/cron](https://supabase.com/docs/guides/cron), [quickstart](https://supabase.com/docs/guides/cron/quickstart)). It still cannot run the Python model — but it could trigger something that does.

**Hazard 1 — pausing.** > "Free plan projects that show low activity over a 7-day period" are paused; "A Free plan project is considered inactive if it does not receive sufficient user database activity over the past week", and helpfully: > "a few user requests to the database each day over the previous week is enough to keep the project from being paused." Our thrice-daily job clears that bar easily *while the job is running*. The risk is the failure mode: **if the ingest breaks and nobody notices, the database pauses a week later and the site goes down** — a compounding failure, and alerting is explicitly out of scope for this project. Restoration window: the docs page says restorable "up to 1 year after it was paused", but Supabase's own [changelog of 2024-06-24](https://supabase.com/changelog/27497-paused-free-plan-projects-are-restorable-for-90-days) says paused Free projects are restorable for **90 days**. **These two first-party sources disagree — assume 90 days.** **[FLUX]**

**Hazard 2 — TimescaleDB is being removed.** `timescaledb` is **deprecated on Postgres 17 and dropped from the PG17 bundle**; it survives only on PG15 projects until Supabase's PG15 end-of-life (~May 2026, i.e. already past). Supabase's stated migration path is `pg_partman` plus native Postgres partitioning ([Postgres 17 release notes discussion](https://github.com/orgs/supabase/discussions/35851)). **If the later schema decision wants TimescaleDB, Supabase is out and Neon is in.** **[FLUX]**

### Railway — the arithmetic does not work

[docs.railway.com/reference/pricing/plans](https://docs.railway.com/reference/pricing/plans) and [railway.com/pricing](https://railway.com/pricing):

- **Free plan**: $0/month with **$1 of monthly usage credits**; 1 replica, 0.5 GB RAM, 1 vCPU, 0.5 GB volume, **4 GB image size**.
- **Trial**: a separate, one-time **$5** grant (2 replicas, 1 GB RAM, 2 vCPU) — expiring, therefore disqualifying on its own.
- Rates: **$20/vCPU/month** ($0.000463/vCPU-min), **$10/GB RAM/month** ($0.000231/GB-min), **$0.05/GB egress**, $0.15/GB/mo volumes. No free egress allowance.
- Cron: real, 5-minute minimum granularity, UTC only, and the service **must exit** — "If a cron service doesn't exit, subsequent executions of the Cron will be skipped" ([reference/cron-jobs](https://docs.railway.com/reference/cron-jobs)).
- Credit exhaustion: > "your subscription will be cancelled. You will no longer be able to deploy to Railway and we will stop all of your workloads." Volume data retained "30 days after expiry".

Do the arithmetic: $1/month buys ~100 GB-minutes of RAM ≈ **1.7 GB-hours**, or about **3.3 hours/month** of a 0.5 GB service. An always-on API is impossible; even the cron job alone (3 runs/day × 5 min × 0.5 GB ≈ 3.75 GB-h/month ≈ $0.04, plus vCPU) fits only if it truly is that short. Railway's $5 Hobby plan is a fine *paid* answer; the free plan is not an answer. The **4 GB image cap** is also the tightest container-size limit found and would bite a fat scientific image. **[FLUX — Railway's free/trial structure has changed repeatedly.]**

### Aiven — the Neon backup plan

[aiven.io/free-postgresql-database](https://aiven.io/free-postgresql-database): free PostgreSQL, 1 GB storage / 1 GB RAM / 1 CPU, single node, automated backups, choice of region (an EU region matters for latency to a CZ audience), and **TimescaleDB listed among the available extensions**. > "There's no time limit when using Aiven for PostgreSQL free plan. However, in order to provide a good service to the community, unused instances will be stopped" — services are "automatically powered off after a period of inactivity", with advance email notice. Powered off, not deleted. The vagueness of "a period of inactivity" is why this is the backup rather than the pick.

### Netlify — static only

[netlify.com/pricing](https://www.netlify.com/pricing/): Free plan is "**$0 forever**" on a credit model — **300 credits/month**, reported as 100 GB bandwidth, 300 build minutes, 125,000 function invocations, 1M edge function invocations. Hard limits with no overage billing: exceed them and the site is suspended for the rest of the calendar month. Perfectly good static host; brings nothing Cloudflare doesn't. **[FLUX — the credit model is new and the April 2026 changelog already revised it.]**

### Oracle Cloud Always Free — capable, wrong shape

Always Free includes **4 Ampere A1 OCPUs + 24 GB RAM**, 200 GB block storage, and 2 Autonomous Databases, permanently. That is more compute than everything else on this page combined, and system `cron` on a VM has none of the granularity problems above. Two reasons it is not the pick: **"Idle Always Free compute instances may be reclaimed by Oracle"**, and an Autonomous Database "stopped and stays inactive for 90 days, cumulative, may be reclaimed and permanently deleted" ([Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Always Free Autonomous Database](https://docs.oracle.com/en/cloud/paas/autonomous-database/serverless/adbsb/autonomous-always-free.html)). More to the point: a hand-managed VM with self-installed Postgres, TLS, and OS patching is a *worse* portfolio artifact for a full-stack-engineering hero than a clean declarative deployment, and it is years of unattended patching debt.

---

## Cross-cutting notes

**Secrets for a scheduled job.** Non-issue everywhere. GitHub Actions repository/environment secrets; Vercel/Render/Railway/Cloudflare all expose encrypted env vars; HF Spaces distinguishes public "variables" from private "secrets". Nothing here constrains the choice.

**Deploying from GitHub Actions.** All candidates are Actions-friendly and free to deploy from: Cloudflare via `wrangler` (official action), Vercel via CLI or its native Git integration, Render via deploy hooks, Railway via CLI, Neon has first-party Actions for branch-per-PR. On public repos the runner minutes are free, so CI/CD costs nothing. **No platform here penalises Actions-based deployment.**

**Container image size.** Only relevant if the Python job runs on a PaaS. Railway caps images at **4 GB**; Cloudflare Workers at **3 MB gzipped / 64 MB uncompressed** (script, not container); Vercel Python functions at **500 MB uncompressed** (5 GB with large-functions beta). GitHub Actions has no comparable cap — another reason the job belongs there.

**Build minutes.** Render 500 pipeline min/month, Cloudflare Pages 500 builds/month, Netlify 300 build min/month, Vercel 100 deploys/day. For a project that deploys a few times a week, none of these bind.

**Egress.** Neon 5 GB/project/month, Supabase 5 GB + 5 GB cached, Render **5 GB** (the tightest), Netlify ~100 GB, Cloudflare static assets unlimited. A dashboard serving tens of KB per visit will not approach any of these. **Egress is not a real constraint for this workload.**

---

## What to re-verify before committing

1. **Neon's 0.5 GB storage metric** — confirm whether it counts data only or data plus history/WAL retention, since the latter changes the effective headroom. Not resolved from the pricing/FAQ pages.
2. **Supabase's paused-project restore window** — the docs say 1 year, the changelog says 90 days. Contradiction in first-party sources.
3. **Whether the project repo will be public or private** — this single choice determines whether the scheduled workflow is subject to 60-day auto-disabling (public) or to the 2,000-minute allowance (private). It is a hosting-architecture decision, not an admin detail.
4. **Koyeb's free-tier closure rationale** — the absence of a free plan is verified; the Mistral-acquisition explanation is not first-party.
5. **Cloudflare Workers 10 ms CPU against a real payload** — measure before designing the API around it, or sidestep it with pre-rendered static JSON.

## Sources

All accessed 2026-08-02.

- Fly.io: [pricing](https://fly.io/docs/about/pricing/), [billing](https://fly.io/docs/about/billing/)
- Render: [free tier](https://render.com/docs/free), [cron jobs](https://render.com/docs/cronjobs), [workspace plans](https://render.com/docs/new-workspace-plans), [Postgres extensions](https://render.com/docs/postgresql-extensions)
- Railway: [pricing](https://railway.com/pricing), [plans reference](https://docs.railway.com/reference/pricing/plans), [usage rates](https://docs.railway.com/reference/pricing), [cron jobs](https://docs.railway.com/reference/cron-jobs)
- Vercel: [Hobby plan](https://vercel.com/docs/plans/hobby), [function limits](https://vercel.com/docs/functions/limitations), [cron pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Python runtime](https://vercel.com/docs/functions/runtimes/python)
- Cloudflare: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [Containers pricing](https://developers.cloudflare.com/containers/pricing/), [Python Workers](https://developers.cloudflare.com/workers/languages/python/), [Python packages](https://developers.cloudflare.com/workers/languages/python/packages/), [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/)
- Neon: [pricing](https://neon.com/pricing), [plans](https://neon.com/docs/introduction/plans), [free plan FAQ](https://neon.com/faqs/free-plan-limits-and-quotas), [scale to zero](https://neon.com/docs/introduction/scale-to-zero), [connection pooling](https://neon.com/docs/connect/connection-pooling), [extensions](https://neon.com/docs/extensions/pg-extensions)
- Supabase: [pricing](https://supabase.com/pricing), [project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [90-day restore changelog](https://supabase.com/changelog/27497-paused-free-plan-projects-are-restorable-for-90-days), [compute and disk](https://supabase.com/docs/guides/platform/compute-and-disk), [Cron](https://supabase.com/docs/guides/cron), [Cron quickstart](https://supabase.com/docs/guides/cron/quickstart), [PG17 release notes discussion](https://github.com/orgs/supabase/discussions/35851)
- GitHub: [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- Others: [Koyeb pricing](https://www.koyeb.com/pricing), [HF Spaces overview](https://huggingface.co/docs/hub/spaces-overview), [Aiven free PostgreSQL](https://aiven.io/free-postgresql-database), [Netlify pricing](https://www.netlify.com/pricing/), [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Oracle Always Free Autonomous DB](https://docs.oracle.com/en/cloud/paas/autonomous-database/serverless/adbsb/autonomous-always-free.html)
