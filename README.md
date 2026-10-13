# Shopify Theme Delivery Blueprint

A dependency-free Node.js demonstration of a fail-closed staging release gate for theme artifacts. It binds synthetic check evidence to an exact SHA-256 manifest, applies through a revision compare-and-swap to one **unpublished** in-memory target, and verifies committed bytes by readback.

**Technical showcase · Original runnable demo · Anonymized · No publishing**

## Quick start

Requires Node.js 20 or newer. There is no package install step.

```sh
node --test
node demo/run.mjs
```

Representative output from the checked-in fixture:

```text
PREPARED  target=unpublished-demo-theme version=12 files=3 artifact=<12 hex>…
           evidence=format:pass, theme-check-synthetic:pass (fixture evidence, not Shopify Theme Check)
APPLIED   target=unpublished-demo-theme version=13 artifact=<same digest>…
VERIFIED  exact_manifest=true version=13 artifact=<same digest>…
NOT PUBLISHED: this demo has no live-target or network adapter.
```

The generated plan token is intentionally not printed.

## What the mechanism guarantees

- Candidate paths are relative, confined to known theme roots and extensions, and reject traversal, backslashes, absolute paths, any `.git` segment, ASCII controls, secret-like names, duplicates and sparse arrays.
- The canonical manifest sorts files by exact JavaScript string code-unit order (not locale collation), binds each path to its UTF-8 content hash, then hashes the complete ordered stream.
- Both required checks must pass and reference that artifact hash. `theme-check-synthetic` is fixture evidence—not a claim that Shopify Theme Check ran.
- A private registry, not mutable returned display data, is authoritative for prepared plans.
- Apply repeats target identity, unpublished role and exact revision checks. Revision detects change-away/change-back ABA even if bytes return to their prior value.
- The update is one in-memory compare-and-swap. Role, identity and revision preflight refusals retain the plan, but the token is consumed immediately before the write attempt. Once the adapter is invoked, any error requires readback/reconciliation and a fresh prepare; automatic replay is forbidden because the write may have committed before throwing.
- Readback verifies target identity, unpublished role, exact incremented revision and final manifest. A mismatch or unreadable/malformed readback is reported as a post-write verification failure, with no rollback claim. The gate does not claim it can distinguish a definite pre-commit failure from an ambiguous commit outcome.

## Policy limits

| Limit | Value |
|---|---:|
| Candidate files | 100 |
| Combined UTF-8 content | 1,000,000 bytes |
| Target adapters | one in-memory target per gate |
| Allowed roots | `assets`, `config`, `layout`, `locales`, `sections`, `snippets`, `templates` |
| Allowed extensions | `css`, `gif`, `json`, `js`, `jpg`, `jpeg`, `liquid`, `png`, `svg`, `webp` |

Because input is pure objects and there is no filesystem adapter, symlinks and filesystem traversal are outside the executable surface. Traversal syntax is still rejected before hashing.

## Code map

- [`src/release-gate.mjs`](src/release-gate.mjs) — validation, digest, private plans, CAS and readback verification.
- [`test/release-gate.test.mjs`](test/release-gate.test.mjs) — deterministic success and fail-closed tests.
- [`demo/run.mjs`](demo/run.mjs) — prepared → applied → verified lifecycle with fresh synthetic files.
- [`docs/engineering.md`](docs/engineering.md) — contracts, state flow, failure matrix, trust boundary and production responsibilities.
- [`docs/scope.md`](docs/scope.md) — evidence and publication boundaries.

## Deliberate exclusions

There is no Shopify API, Shopify CLI, Theme Check, GitHub Actions, credential handling, filesystem packaging, database, multi-process coordination, rollback, or publish-to-live operation. The token is a capability held by a trusted harness; it is not authentication.

This repository contains newly authored synthetic code and fixtures only. It does not redistribute an original theme, client assets, private implementation, identities, domains, logs or credentials.