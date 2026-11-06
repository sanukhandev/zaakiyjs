# @zaakiyjs/consent changelog

## Unreleased

- Default-deny reactive purpose-specific consent state machine with explicit grant, deny, revoke, expiry and policy invalidation.
- Versioned safe storage, generic CMP mapping and origin/source guard, owner-scoped cleanup and revocable optional-resource activation.
- Provisional P3 contract alignment; package is unpublished and requires contract/CI integration review.

- Add the frozen `zaakiy.consent/1` transport-neutral capability, policy identity/region binding, monotonic revision notifications, and validated trusted SSR snapshot hydration.
- Prevent stale grants under reentrant consent changes, delayed CMP reads, and owner teardown; validate full CMP decisions atomically.

- Serialize vendor cleanup and withdrawal before reactivation; restrict audit metadata to validated reasons and ISO timestamps.

- Enforce the five canonical P3 protocol purposes both at compile time and runtime; reject unrecognized purpose aliases.
