# Scope and evidence boundaries

## Public executable scope

This original dependency-free demo validates and freezes a synthetic theme candidate, conditionally replaces one unpublished in-memory target, and verifies exact manifest identity after the write. All fixture paths and contents were freshly authored; none comes from an original theme or client implementation.

## Evidence basis

- **Retained private baseline evidence** informed the subject: theme structure, quality gates and deliberate staging delivery. It is not redistributed.
- **Fresh public demo evidence** comes only from executing this repository. It proves in-memory behavior, not Shopify connectivity, a live deployment or another system's historical production state.

`theme-check-synthetic` is labeled fixture evidence. It demonstrates artifact binding; Shopify Theme Check is not invoked.

## Not implemented or claimed

- No original source, assets, screenshots, datasets, names, domains, identifiers or credentials.
- No Shopify API/CLI adapter, Theme Check runner, GitHub Actions workflow or network operation.
- No filesystem adapter, symlink handling or package discovery. Pure object input removes those surfaces rather than solving them.
- No authentication, multi-user authorization, durable database, distributed transaction or multi-process guarantee.
- No automatic retry or rollback after a write attempt. Once the adapter is invoked, the plan is consumed whether the adapter throws before mutation, commits then throws, or readback fails identity/role/revision/content verification; reconcile and prepare again.
- No production publishing. Live and unknown roles are refused; publish-to-live does not exist.

## Review intent

The repository demonstrates validation, deterministic identity, evidence binding, private prepared-state authority, revision CAS, failure invariants and honest readback handling. Production integration remains outside scope.