# Provisioning: the human-only gates

The runbook for [issue #38](https://github.com/Zednicek-Adam/cz-electricity-price-forecast/issues/38).
ADR-0013 decides *what* has to be provisioned and *when*; this file is the click
path and the exact command for each row, so a gate is opened once rather than
re-derived every time one blocks a ticket.

Every row here is a step **no agent session can perform**, and every row gates
everything behind it. The checklist is standing: it spans phases 0 through 3 and
stays open until the last row is ticked. Downstream tickets name the row they
need — "the **reader role** row of #38" — rather than blocking on the whole
issue.

**The checkboxes on issue #38 are the record.** Tick a row there when you finish
it; this file is instructions, not state.

Three Neon roles, not two. **No ENTSO-E token and no Hugging Face token exists
anywhere in v1** — v1 reads the frozen dataset in `data/`, and `amazon/chronos-2`
is a public Apache-2.0 artifact. The ENTSO-E token stays in the gitignored `.env`
for the live branch, and nothing in v1 reads it.

## The two hazards, before you start

Two things below will not announce themselves when you get them wrong. Both are
worth reading before the first row rather than after the failing one.

**A Neon role created in the Console is not restricted.** Neon's documentation is
explicit: roles created through the Console, CLI or API are automatically granted
membership in `neon_superuser`, which carries `CREATEDB`, `CREATEROLE`,
`BYPASSRLS` and read/write on every table. A role created with `CREATE ROLE` in
SQL gets none of that and must be granted each privilege explicitly. So the
writer and the reader are created **in the SQL Editor**, not with **Add role** —
otherwise the reader row's "restricted to `SELECT`" is false the moment it is
ticked, and nothing downstream would ever catch it, because a superuser reader
passes every test a restricted one passes.

**The `GRANT` migration fails if the role does not exist.** ADR-0005 puts every
`GRANT` in a migration, which is why `migrate` connects as owner. But a migration
that grants to `app_reader` errors if `app_reader` has not been created yet — and
`migrate` runs on every merge to `main` from phase 0 onward. The phases below say
when each *credential* is first needed; the *role* must exist before the
migration that grants to it lands. If the grant migration for the reader lands in
phase 1 with the five tables (#42), create the reader role then, ahead of its
phase-2 row here. Creating all three roles in one sitting at phase 0 costs
nothing and removes the hazard.

## Names

Nothing in the ADRs fixes the secret names, and this file deliberately does not
invent them. Each name is fixed by whichever ticket first consumes the value —
**write the name back into this table when that ticket lands**, so the next
session reads it here instead of guessing.

| Value | Lives in | Name | Fixed by |
|---|---|---|---|
| Neon **owner** URL | `production` GitHub Environment | *(unset)* | #40, the `migrate` job |
| Neon **writer** URL | local `.env` and the same Environment | *(unset)* | #47, the replay workflow |
| Neon **reader** URL | the Worker, via `wrangler secret put` | *(unset)* | #53, the deploy |
| Cloudflare API token | the same Environment | `CLOUDFLARE_API_TOKEN` | Cloudflare's own docs |
| Cloudflare account id | the same Environment | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare's own docs |

The two Cloudflare names are not a free choice: `cloudflare/wrangler-action`
documents exactly those, so they are settled here.

Postgres role names are the same kind of open question. Neon's default owner is
`neondb_owner`; the SQL below uses **`app_writer`** and **`app_reader`** as
suggestions. Whichever value the `GRANT` migration uses is the real one — make
this file agree with it.

Placeholders in the commands below read `<OWNER-SECRET-NAME>`,
`<WRITER-SECRET-NAME>` and `<READER-SECRET-NAME>`. Substitute, don't paste.

---

## Phase 0

### Flip the repository public

**Gates** unmetered Actions, the smoke replay, and preview URLs that point
somewhere a reader can open. It also gates the `production` Environment itself:
GitHub's own wording is that "users with GitHub Free plans can only configure
environments for public repositories", so on a Free plan the next two rows are
unreachable until this one is done. That makes the ordering load-bearing rather
than aesthetic.

First, confirm the history is clean. Both commands must print nothing:

```sh
git log --all --full-history --oneline -- .env
git log --all --full-history --oneline -- analysis/raw
```

Then flip it:

```sh
gh repo edit Zednicek-Adam/cz-electricity-price-forecast \
  --visibility public --accept-visibility-change-consequences
```

`gh` requires that second flag because the change is not cosmetic: it detaches
public forks, can disable push rulesets, and opens Actions history and logs to
anyone. On this repository, at this point in the build, all three are fine — but
read them rather than skipping past them.

**Verify:** `gh repo view --json visibility` prints `PUBLIC`.

### Create the Neon project

**Gates** the entire store.

1. Open <https://console.neon.tech> and create a project.
2. Put it in an EU region — `aws-eu-central-1` (Frankfurt) is nearest to CZ. The
   Worker's latency to Postgres is not what makes this choice; keeping an
   EU-derived dataset in an EU region is.
3. Keep the default database name (`neondb`) unless you have a reason not to, and
   note it — every `GRANT` below names it.
4. Note the owner role Neon created for you. It is `neondb_owner` by default, and
   it is the role the next row is about.

**Verify:** the Console's **SQL Editor** runs `select version();`.

### Owner role → the `production` GitHub Environment

**Gates** `migrate`. Owner rather than writer, because `GRANT` requires ownership
and ADR-0005 puts every `GRANT` in a migration — so the `migrate` job cannot
connect as the writer.

Create the environment:

```sh
gh api -X PUT repos/Zednicek-Adam/cz-electricity-price-forecast/environments/production
```

(Or **Settings → Environments → New environment → `production` → Configure
environment**.)

Copy the owner connection string: **Project Dashboard → Connect**, then pick the
branch, database and the owner role. **Turn the connection pooling toggle off.**
Neon's guidance for schema migrations is the direct connection, because migration
tools lean on session-level features that transaction pooling does not support;
the pooled string is for the Worker, three rows below. The result looks like:

```
postgresql://neondb_owner:<password>@ep-<id>.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

Store it, pasting at the prompt so the URL never lands in shell history:

```sh
gh secret set <OWNER-SECRET-NAME> --env production
```

**Verify:** `gh secret list --env production` lists the name.

---

## Phase 1

### Writer role → local `.env`, then the same Environment

**Gates** the loader and the replay. The first real replay is driven from your
machine as the writer (ADR-0013 narrows ADR-0010 on this point), which is why
this value is needed in two places.

Create the role **in the SQL Editor, connected as the owner** — not with **Add
role**, for the reason in the hazards section:

```sql
CREATE ROLE app_writer WITH LOGIN PASSWORD '<generate-a-long-random-password>';
```

That is the whole manual step. No `GRANT` here: the writer's privileges arrive in
a migration, run by the owner.

Neon will not show you a connection string for a role it did not create, so build
it from the owner's by swapping the role and password and leaving the host,
database and query string alone:

```
postgresql://app_writer:<password>@ep-<id>.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

Put it in local `.env` (already gitignored, and never committed on any branch):

```sh
<WRITER-SECRET-NAME>=postgresql://app_writer:...
```

and in the Environment:

```sh
gh secret set <WRITER-SECRET-NAME> --env production
```

**Verify:** in the SQL Editor,

```sql
select rolname, rolsuper, rolcreaterole, rolcreatedb from pg_roles
where rolname = 'app_writer';
```

shows the role, and

```sql
select pg_has_role('app_writer', 'neon_superuser', 'member');
```

returns `false`. If it returns `true`, the role was created in the Console: drop
it and create it again in SQL.

---

## Phase 2

### Reader role, restricted to `SELECT`

**Gates** the API. This is the row the Console silently breaks, so run the same
check as above and mean it.

```sql
CREATE ROLE app_reader WITH LOGIN PASSWORD '<generate-a-long-random-password>';
```

Again, no `GRANT` by hand. The migration grants `CONNECT`, `USAGE` on the schema,
and `SELECT` — and nothing else, which is what "restricted to `SELECT`" means
here. Neon's own read-only-role shape, for the migration author's reference:

```sql
GRANT CONNECT ON DATABASE neondb TO app_reader;
GRANT USAGE ON SCHEMA public TO app_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_reader;
```

The `ALTER DEFAULT PRIVILEGES` line is the one that is easy to leave out and
expensive to miss: without it the reader can select from today's tables and not
from the ones a later migration adds, and the failure surfaces as an endpoint
that works locally and 500s in production.

Build the reader's connection string the same way as the writer's — but for the
Worker, **leave connection pooling on** and use the `-pooler` host. Neon
recommends the pooled string for serverless workloads, which is exactly what a
Worker is. It does not go anywhere yet; phase 3 puts it in the Worker.

**Verify**, connected as `app_reader` once the grant migration has run: a
`select` on a table returns rows, and an `insert` into any table fails with a
permissions error. A reader that can insert is not a reader.

---

## Phase 3

### Cloudflare account

**Gates** any deploy. Sign up at <https://dash.cloudflare.com/sign-up>. The Free
plan is what ADR-0004 costed; nothing here needs more.

Do this row **after** #52 has re-verified Static Assets against current
documentation. If that finding sends the deployment to Pages plus a routed
Worker, the token permissions in the next row change with it.

### `CLOUDFLARE_API_TOKEN` and the account id → the same Environment

**Gates** the `deploy` and preview jobs.

1. Open <https://dash.cloudflare.com/profile/api-tokens> and select **Create
   Token**.
2. Use the **Edit Cloudflare Workers** template — it carries Workers Scripts:Edit,
   which is the permission ADR-0013 names. Scope it to this account and no zones.
3. Copy the token. **It is shown once**; there is no way to read it back.

```sh
gh secret set CLOUDFLARE_API_TOKEN --env production
```

Then the account id — **Workers & Pages → Account Details → Account ID**, or
press `Ctrl/Cmd + K` in the dashboard and search `Copy account ID`:

```sh
gh secret set CLOUDFLARE_ACCOUNT_ID --env production
```

The account id is not secret, but it lives beside the token as a secret so that
both halves of one credential are configured in one place and rotate together.

**Verify:** `gh secret list --env production` lists four names.

### `wrangler secret put` the reader URL — it never enters GitHub

**Gates** the deployed Worker reaching Neon. This is the one credential that is
set by hand, outside GitHub, and ADR-0010 flags it as an accepted gap: nothing
re-provisions it for you, and nothing notices it is missing until a deploy
returns a database error.

Two ordering facts. `wrangler secret put` **creates a new version of the Worker
and deploys it immediately**, so the Worker must already exist — run this after
the first `wrangler deploy`, not before. And secrets are scoped to a Worker *and
environment*, so if #53's preview deploys use a Wrangler environment rather than
versions, the secret has to be set for that environment too. #53 settles which;
this file should say which once it has.

From `api/`, with the pooled reader URL on the clipboard:

```sh
npx wrangler secret put <READER-SECRET-NAME>
```

**Verify:** `npx wrangler secret list` shows the name, and the deployed endpoint
returns rows rather than a connection error.

---

## Not in this checklist

ADR-0013's provisioning table has two more phase-3 rows that #38 does not carry,
because they are build steps with their own tickets rather than human-only gates:
the **root README** with issue #20's four obligations (#51, due before the first
pull request that touches `web/`) and the **persistent dashboard footer
attribution** (#53). Both come due at the first preview deploy, because a
Cloudflare preview URL is publicly reachable whatever the repository's
visibility.
