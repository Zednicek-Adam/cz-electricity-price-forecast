# Provisioning: the human-only gates

The runbook for [issue #38][i38]. ADR-0013 decides *what* has to be provisioned
and *when*; this file is the click path and the exact command for each row, so a
gate is opened once rather than re-derived every time one blocks a ticket.

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

Two conventions for the commands below. They assume `gh` is on your `PATH` — on
Windows it installs to `C:\Program Files\GitHub CLI`, which Git Bash does not
always pick up. And when you generate a role password, **use alphanumerics
only**: the password is spliced into a connection URL, and a `@`, `:`, `/`, `?`,
`#` or `%` in it has to be percent-encoded or the URL silently parses wrong.

## The three hazards, before you start

None of these announces itself when you get it wrong. All three are worth reading
before the first row rather than after the failing one.

**A Neon role created in the Console is not restricted.** Neon's documentation is
explicit: roles created through the Console, CLI or API are automatically granted
membership in `neon_superuser`, which carries `CREATEDB`, `CREATEROLE`,
`BYPASSRLS` and read/write on every table. A role created with `CREATE ROLE` in
SQL gets none of that and must be granted each privilege explicitly. So the
writer and the reader are created **in the SQL Editor**, not with **Add role** —
otherwise the reader row's "restricted to `SELECT`" is false the moment it is
ticked, and nothing downstream would ever catch it, because a superuser reader
passes every test a restricted one passes.

**The reader role is needed in phase 1, not phase 2.** ADR-0005 puts every
`GRANT` in a migration, which is why `migrate` connects as owner. But a migration
that grants to a role errors if the role does not exist, and #42 — "the reader
role's `SELECT` grant lives in a migration" — lands in **phase 1**, with the five
tables. So the reader must be created before #42's migration first runs on a
merge to `main`. This **narrows ADR-0013's provisioning table**, which files the
reader under phase 2: the *credential* is first consumed in phase 2 by the API,
but the *role* has to exist a phase earlier. Creating all three roles in one
sitting at phase 0 costs nothing and removes the hazard entirely.

**No ticket grants the writer.** #42 carries the reader's `SELECT` grant and
nothing else; no open issue mentions a `GRANT` at all. A role created with
`CREATE ROLE` holds only what `PUBLIC` holds, which is no access to any table —
so the writer row below can be ticked with a credential that cannot write, and
the failure surfaces in #47's replay rather than here. Whoever writes #42's
migration should carry the writer's `INSERT`/`UPDATE`/`DELETE`/`SELECT` and its
sequence usage alongside the reader's `SELECT`, or #38's writer row is ticked
against a role that does nothing. This is a gap in the tickets, not in ADR-0005.

## Names

Nothing in the ADRs fixed the secret names ahead of time. The three Neon names
below were settled when the roles were provisioned; the tickets that consume them
(#40, #47, #49, #53) must use exactly these. This file deliberately does not
invent them. Each name is fixed by whichever ticket first consumes the value —
**write the name back into this table when that ticket lands**, so the next
session reads it here instead of guessing.

| Value | Lives in | Name | Fixed by |
|---|---|---|---|
| Neon **owner** URL | `production` GitHub Environment | `NEON_OWNER` | provisioned 2026-09-07 |
| Neon **writer** URL | local `.env` and the same Environment | `NEON_WRITER` | provisioned 2026-09-07 |
| Neon **reader** URL | `api/.dev.vars`, then the Worker | `NEON_READER` | provisioned 2026-09-07 |
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

## Phase 0 — open the gate and stand up the store

### Flip the repository public

**Gates** unmetered Actions, the smoke replay, and preview URLs that point
somewhere a reader can open. It also gates the `production` Environment itself:
GitHub's own wording is that "users with GitHub Free plans can only configure
environments for public repositories", so on a Free plan the next two rows are
unreachable until this one is done. That makes the ordering load-bearing rather
than aesthetic.

First, confirm the history is clean. Both commands must print nothing:

```sh
git log --all --full-history --oneline -- '*.env'
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

**Verify:**

```sh
gh repo view Zednicek-Adam/cz-electricity-price-forecast --json visibility
```

prints `{"visibility":"PUBLIC"}`.

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

## Phase 1 — the credential the replay runs as

### Writer role → local `.env`, then the same Environment

**Gates** the loader and the replay. The first real replay is driven from your
machine as the writer (ADR-0013 narrows ADR-0010 on this point), which is why
this value is needed in two places.

Create the role **in the SQL Editor, connected as the owner** — not with **Add
role**, for the reason in the hazards section:

```sql
CREATE ROLE app_writer WITH LOGIN PASSWORD '<long-random-alphanumeric>';
```

That is the whole manual step. No `GRANT` by hand: the writer's privileges belong
in a migration, run by the owner — but read the third hazard first, because no
ticket currently carries that migration.

Neon will not show you a connection string for a role it did not create, so build
it from the owner's by swapping the role and password and leaving the host,
database and query string alone:

```
postgresql://app_writer:<password>@ep-<id>.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

Put it in local `.env` (already gitignored, and never committed on any branch):

```dotenv
<WRITER-SECRET-NAME>=postgresql://app_writer:...
```

and in the Environment:

```sh
gh secret set <WRITER-SECRET-NAME> --env production
```

**Verify** in two directions. That the role is not over-privileged:

```sql
select pg_has_role('app_writer', 'neon_superuser', 'member');
```

must return `false` — if it returns `true` the role was created in the Console,
so drop it and create it again in SQL. And that it is privileged enough: connect
with the writer URL once the grant migration has run, and insert and delete a row
in `observed_price`. A writer that cannot write passes every check above.

## Phase 2 — the credential the API reads as

### Reader role, restricted to `SELECT`

**Gates** the API. This is the row the Console silently breaks, so run the same
check as the writer's and mean it. Note the second hazard: the role itself is
wanted a phase earlier than this row sits.

```sql
CREATE ROLE app_reader WITH LOGIN PASSWORD '<long-random-alphanumeric>';
```

Again, no `GRANT` by hand. #42's migration grants `CONNECT`, `USAGE` on the
schema, and `SELECT` — no `INSERT`, `UPDATE` or `DELETE` anywhere, which is what
"restricted to `SELECT`" means here. Neon's own read-only-role shape, for that
migration's author:

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

"Restricted to `SELECT`" is a statement about tables, not about everything. A
freshly created role also inherits whatever `PUBLIC` holds — `CONNECT` and `TEMP`
on the database, `USAGE` on the `public` schema — which is why the first two
grants above are close to redundant. If you want the stricter reading, the
migration is also where a `REVOKE ... FROM PUBLIC` would go; v1 does not need it,
since `PUBLIC` reaches no table.

Build the reader's connection string the same way as the writer's — but for the
Worker, **leave connection pooling on** and use the `-pooler` host. Neon
recommends the pooled string for serverless workloads, which is exactly what a
Worker is.

The reader URL is needed locally in this phase, before it is ever deployed: #49
runs the Hono app under `wrangler dev` against Neon as the reader, and `wrangler`
reads local secrets from **`api/.dev.vars`**. Put it there, and make sure that
file is gitignored. Phase 3 puts the same value into the deployed Worker, by a
different route.

**Verify**, connected as `app_reader` once the grant migration has run: a
`select` on a table returns rows, and an `insert` into any table fails with a
permissions error. A reader that can insert is not a reader.

## Phase 3 — Cloudflare, and the one secret GitHub never sees

### Cloudflare account

**Gates** any deploy. Sign up at <https://dash.cloudflare.com/sign-up>. The free
tier is what ADR-0004 assumed across all three vendors; nothing here needs more.

### `CLOUDFLARE_API_TOKEN` and the account id → the same Environment

**Gates** the `deploy` and preview jobs.

Do this row **after** #52 has re-verified Static Assets against current
documentation. The account above can be created any time, but the token's
permissions follow the deployment shape: if #52's finding sends v1 to Pages plus
a routed Worker, the template below is the wrong one.

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

## Not in this checklist

ADR-0013's provisioning table has two more phase-3 rows that #38 does not carry:
the **root README** with issue #20's four obligations (#51, due before the first
pull request that touches `web/`) and the **persistent dashboard footer
attribution** (#53). Both come due at the first preview deploy, because a
Cloudflare preview URL is publicly reachable whatever the repository's
visibility.

ADR-0013 is inconsistent about them: it heads that table "every row is a step no
agent session can perform", then lists two rows that are ordinary build steps an
agent does perform. #38 resolves the inconsistency in favour of the heading, and
this file follows #38. Nothing is lost — both rows have their own tickets.

[i38]: https://github.com/Zednicek-Adam/cz-electricity-price-forecast/issues/38
