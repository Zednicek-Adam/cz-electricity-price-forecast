---
status: accepted
---

# `dbmate` runs in a container, because pinning `pg_dump` is what keeps the schema file honest

`db/schema.sql` is committed and the pull request gate compares the regenerated
file against it **byte for byte** (ADR-0010). That check is only meaningful if
the thing doing the regenerating is fixed. It is not, by default: `dbmate` has no
schema dumper of its own — for Postgres it shells out to whatever `pg_dump` sits
on the caller's `PATH`, and `pg_dump` writes **both its own version and the
server's** into the header of the dump. So the gate, as specified, fails whenever
a developer's client happens to differ from CI's, for reasons that have nothing
to do with the migration under review.

**`dbmate` therefore runs as a one-shot container**,
`ghcr.io/amacneil/dbmate:2.35.1`, pinned to the patch beside `postgres:17.11`.
Both images are pinned for the same reason, and bumping either is a commit that
also regenerates the schema file. It is a `docker compose run --rm` under a
`tools` profile, not a service that stays up: `docker compose up -d db` does not
start it, it holds no memory or CPU between invocations, and it exists only for
the seconds a migration command takes.

This is the smallest change that makes the byte-for-byte gate mean what
ADR-0010 says it means. The alternative framing — that the gate is too strict
and should tolerate a version-skewed header — was rejected: the header is not
the only thing that moves between `pg_dump` majors, so a header-stripping
normaliser would buy a false sense of coverage over a diff that can still
change underneath it.

## Considered options

**`dbmate` as a native binary, using the developer's own `pg_dump`.** This is
what ADR-0005 assumed. Rejected on a specific failure mode: `dbmate`'s
documented behaviour when dump utilities are missing is to **silently skip the
schema dump** during `up`, `migrate` and `rollback` — no warning, no non-zero
exit. A developer with no Postgres client installed would see a green
`dbmate up`, commit an unregenerated `db/schema.sql`, and discover it as a red
gate somewhere that looks unrelated. The README's "no local Postgres client"
prerequisite makes that the *default* state of a fresh clone, not an edge case.

**A `pg_dump` shim on `PATH`, forwarding into the `db` container.** The
`postgres:17.11` image already carries a `pg_dump` matching its own server, so a
small script that execs `docker compose exec -T db pg_dump` would pin the client
with one image and leave `dbmate` native. Genuinely tempting, and rejected on
cost rather than principle: `dbmate` offers no way to configure the `pg_dump`
path, so the interposition has to happen on `PATH` — invisible indirection that
every contributor has to be told about, needing a second implementation for
Windows, and carrying the same silent-skip failure the option above does the
moment the shim is absent. Per-command latency is no better either, since it
still crosses into a container for every dump.

**`dbmate` run inside the `postgres:17.11` image.** Would pin `pg_dump` to
exactly the server version and add no second image. Rejected because getting the
binary in there means either a `Dockerfile` — trading a pulled image for a built
one, which is worse — or downloading it at run time, which un-pins the tool the
ADR exists to pin.

**Dropping the byte-for-byte comparison.** Rejected. It is the mechanism by which
a change to the cross-language contract shows up in the diff of the pull request
that makes it (ADR-0005). Loosening the check to keep a tooling rule intact is
the wrong thing to trade.

## What this amends in ADR-0004 and ADR-0005

**ADR-0004's "Docker for exactly one thing" becomes "Docker for exactly one
*service*."** The rule's substance — that nothing is *developed* inside a
container, that `uv`, `pnpm`, `wrangler dev` and Vite all run natively — is
untouched. Postgres remains the only thing `docker compose up` starts. What
moves is the letter of "one thing", to admit one-shot tool invocations that need
a pinned binary.

**ADR-0005's "a single static binary in CI" is narrowed to describe what
`dbmate` *is*, not how it is invoked.** `dbmate` remains the smallest real
migration tool, still no ORM and no DSL, and the `.sql` files are still the
artifact. It is delivered as a container image in both places, local and CI, so
that migrations and the schema dump have one code path rather than two — the
same reasoning ADR-0004 already applied to the Postgres image itself.

Neither amendment was available when those ADRs were written: both predate the
first migration, and the `pg_dump` header behaviour only surfaces once a schema
file is actually generated and compared.

## Consequences

**The CI gate must use this image too.** A gate that runs `dbmate` as a static
binary would lose the pinning precisely where the byte-for-byte comparison is
made, which would leave this ADR buying nothing. Issue #39 landed the compose
file; the workflow that consumes it does not exist yet, and this constraint is
the one thing it must honour.

**The dump is currently written by a newer client than the server.** The pinned
image carries `pg_dump` 18, and `db/schema.sql` records "Dumped from database
version 17.11 / Dumped by pg_dump version 18.6". That is supported and stable
while both tags are pinned, but the two versions are pinned *independently* — a
`dbmate` patch bump that ships a different client rewrites the schema file on its
own. That is a visible red gate rather than a silent corruption, which is the
right failure, but it means image bumps are schema commits.

**`db/schema.sql` is checked out LF on every platform** (`.gitattributes`), since
it is generated inside a container that writes LF and compared byte for byte
against that.
