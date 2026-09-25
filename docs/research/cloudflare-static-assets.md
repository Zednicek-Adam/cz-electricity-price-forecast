# Cloudflare Static Assets, re-verified (issue #52)

Checked on **2026-09-25** against Cloudflare's current documentation, before
any of phase 3 is wired (ADR-0013). The question is whether v1's deployment
shape still holds: **one Worker serving both the built client and the API**
(ADR-0004, ADR-0010). The fallback, Cloudflare Pages plus a routed Worker,
would change the deploy job and the preview story, and is cheapest to discover
now.

## Finding

**The shape holds. One Worker with Static Assets serves the built client and
the `/api/*` routes, and no Pages fallback is needed.** Previews are version
URLs of that same Worker, so the preview story holds too.

## What the documentation says

**One Worker, both jobs.** Static Assets are configured on the Worker itself.
`assets.directory` points at the build output, and a Worker script alongside it
handles whatever does not match a file. "When you deploy your project,
Cloudflare deploys both your Worker code and your static assets in a single
operation."
([Static Assets](https://developers.cloudflare.com/workers/static-assets/))

**A single-page app with an API.** The documented configuration is exactly v1's
case ([SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)):

- `not_found_handling = "single-page-application"` serves `/index.html` with
  `200 OK` for any path that matches no asset, so client-side routing works;
- `run_worker_first = ["/api/*"]` sends matching requests to the Worker script
  before asset serving. A pattern beginning `!/` excludes a path again.

**Asset requests are free.** "Requests to static assets are free and unlimited.
Requests to the Worker script … are billed according to Workers pricing."
([Billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/))
There is one caveat for the free tier. Requests matching `run_worker_first`
always invoke the Worker, so past the free request limit they get
`429 Too Many Requests` rather than falling back to assets. For v1 that is
right: only `/api/*` matches, and every other path is served from assets
however busy the Worker is.

**Free-tier limits** ([Limits](https://developers.cloudflare.com/workers/platform/limits/)):
100,000 Worker requests a day, 10 ms CPU per request, 50 subrequests per
request, 20,000 asset files per version, 25 MiB per asset file, and 64 MiB for
the uncompressed Worker bundle. The docs now say there is no compressed-size
limit, only the uncompressed one. The API's CPU use per request is a few row
selections and, for the Over time view, one pass over at most 5,481 rows
(ADR-0015), well inside 10 ms.

## Preview deploys

ADR-0010's "a Cloudflare preview version per pull request" corresponds to
**version URLs** ([Previews](https://developers.cloudflare.com/workers/configuration/previews/)):

- `wrangler versions upload` uploads a new version, assets included, **without
  deploying it to production**
  ([commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/)).
  `wrangler deploy` on `main` stays the production path.
- Each version gets `<version-prefix>-<worker-name>.<subdomain>.workers.dev`.
  `--preview-alias pr-123` adds a stable
  `pr-123-<worker-name>.<subdomain>.workers.dev`, so a pull request keeps one
  URL across pushes. An alias uses lowercase letters, digits and dashes, starts
  with a letter, and must fit a 63-character DNS label together with the Worker
  name. Only the 1,000 most recent aliases are kept.
- Version URLs are **public**: "the URL is public and available after version
  creation". That is what ADR-0010 relies on, and it is why issue #20's
  obligations (#51) come due at the first preview deploy.
- They run only on `workers.dev`, follow the `workers_dev` setting by default,
  and can be set explicitly with `preview_urls = true`.
- They are not generated for Durable Objects, Containers or Workers for
  Platforms, and their logs are not in Workers Logs or `wrangler tail`. v1 uses
  none of those; the missing logs are a debugging inconvenience only.
- A version runs with "that Worker version's existing configuration and
  resources".

## What changed since ADR-0010, and what #53 must do about it

1. **Nothing forces the fallback.** No Pages project, no routed Worker, no
   origin configuration.
2. **The Worker must exist before the first preview.** A version is uploaded to
   an existing Worker, so the first `wrangler deploy` (on a merge to `main`)
   comes before previews work. The reader secret is set on the Worker with
   `wrangler secret put`, after that first deploy.
3. **Whether a new version inherits the Worker's secrets is not stated
   outright** in the pages above. `wrangler versions secret put` exists for
   setting one on a version. The expectation is that uploaded versions keep the
   Worker's existing secrets, but #53 should check it once: open the first
   preview URL and confirm `/api/accuracy` answers rather than failing to
   connect.
4. **Configuration #53 needs**, in `api/wrangler.jsonc`:
   `assets: { directory, binding, not_found_handling: "single-page-application",
   run_worker_first: ["/api/*"] }`, plus `workers_dev: true` and
   `preview_urls: true`.
5. **The deploy job's token** needs Workers Scripts:Edit, which is what
   #38's Cloudflare row already provisions. Version uploads use the same
   permission.
