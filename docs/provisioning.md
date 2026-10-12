# Provisioning: the human-only gates

The click path and the exact command for everything this project needs from a
person rather than from code: the accounts, the credentials and the repository
settings. Every row gates something; each says what.

Two conventions for the commands below. They assume `gh` is on your `PATH` — on
Windows it installs to `C:\Program Files\GitHub CLI`, which Git Bash does not
always pick up. And every secret goes into the **`production` GitHub
Environment**, so only the jobs that declare `environment: production` can read
it.

## Names

| Value | Lives in | Name | Read by |
|---|---|---|---|
| Cloudflare API token | `production` Environment | `CLOUDFLARE_API_TOKEN` | `main.yml`, the gate's `preview` job |
| Cloudflare account id | `production` Environment | `CLOUDFLARE_ACCOUNT_ID` | the same |
| ENTSO-E security token | `production` Environment, and `.env` locally | `ENTSOE_API_TOKEN` | `daily.yml` |
| Deploy key, private half | `production` Environment | `DEPLOY_KEY` | `daily.yml`, `replay.yml` |
| Deploy key, public half | the repository's deploy keys, write access | `daily run (pushes data commits to main)` | GitHub |

The two Cloudflare names are not a free choice: Wrangler reads exactly those.

**Kept, and read by nothing.** `NEON_OWNER` and `NEON_WRITER` in the
`production` Environment, and `NEON_READER` on the Worker, belong to the design
before ADR-0016: a Neon database behind a read API. They stay, with the Neon
project, so that design can be restored from the `v1-neon` tag without
provisioning anything again (issue #86, section 6). Their runbook is this file
at that tag.

## Flip the repository public

**Gates** unmetered Actions minutes, the scheduled daily run (ADR-0012), and the
`production` Environment itself: on a GitHub Free plan, environments can only be
configured for public repositories.

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

**Verify:** `gh repo view --json visibility` prints `{"visibility":"PUBLIC"}`.

## Cloudflare

**Gates** every deploy and every preview.

Sign up at <https://dash.cloudflare.com/sign-up>; the free tier is enough. Then:

1. Open <https://dash.cloudflare.com/profile/api-tokens> and select **Create
   Token**.
2. Use the **Edit Cloudflare Workers** template, scoped to this account and no
   zones.
3. Copy the token. **It is shown once.**

```sh
gh secret set CLOUDFLARE_API_TOKEN --env production
```

Then the account id — **Workers & Pages → Account Details → Account ID**:

```sh
gh secret set CLOUDFLARE_ACCOUNT_ID --env production
```

The account id is not secret, but it lives beside the token so that both halves
of one credential are configured in one place.

**Verify:** the next push to `main` deploys, and the gate's `preview` job writes
a `pr-<number>` URL to its summary.

## The ENTSO-E security token

**Gates** the daily run's ingest.

Getting one is two steps (issue #7). Register at
<https://transparency.entsoe.eu/>, then email `transparency@entsoe.eu` with the
subject `Restful API access` and the account's email address in the body. Once
access is granted, **Account Settings** shows a generator for the Web API
security token. The token does not expire.

Keep it in the gitignored `.env` as `ENTSOE_API_TOKEN` for local runs, and put
it in the Environment:

```sh
gh secret set ENTSOE_API_TOKEN --env production
```

**Verify:** `gh workflow run daily.yml`, then the run's log shows
`ingest:` rather than `ENTSOE_API_TOKEN is not set` or an HTTP 401.

## The deploy key, and the ruleset that lets it past the gate

**Gates** the daily run's commit to `main`, and the replay's branch.

`main` requires the `all-green` check, which a data commit never has. A push
made with the workflow's own `GITHUB_TOKEN` can bypass nothing, and would not
start `main.yml` either. A deploy key does both: a ruleset can let it bypass the
required check, and its push starts the deploy. It does not expire, which is
what an unattended job needs (ADR-0012).

Generate a key pair outside the repository, register the public half with write
access, store the private half, and delete it locally:

```sh
ssh-keygen -t ed25519 -N "" -C "cz-epf daily run" -f daily
gh repo deploy-key add daily.pub --allow-write \
  --title "daily run (pushes data commits to main)"
gh secret set DEPLOY_KEY --env production < daily
rm daily daily.pub
```

Branch protection on `main` is a **ruleset** rather than a classic protection
rule, because only a ruleset can name a deploy key as a bypass actor. The
ruleset `main` blocks deletion and force-pushes and requires `all-green` from
GitHub Actions; deploy keys and repository admins may bypass it. Create it with
`gh api -X POST repos/{owner}/{repo}/rulesets --input ruleset.json`, where
`ruleset.json` is:

```json
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [
    { "actor_type": "DeployKey", "bypass_mode": "always" },
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [ { "context": "all-green", "integration_id": 15368 } ] } }
  ]
}
```

A classic protection rule on `main` would apply on top of the ruleset and
reject the deploy key, so there must not be one:
`gh api repos/{owner}/{repo}/branches/main/protection` answers 404.

**Verify:** `gh api repos/{owner}/{repo}/rules/branches/main -q '.[].type'`
lists `deletion`, `non_fast_forward` and `required_status_checks`, and the
first daily run that has something to commit pushes it to `main`.
