# @zaakiyjs/ads changelog

## Unreleased

- Add provisional, consent-gated, owner-aware slot manager and typed provider contracts.
- Add opt-in lazy loading, refresh gating, route-bound teardown and SSR placeholders.
- Add approved-origin script helper and deterministic mock-provider tests.
- P3 shared contract freeze, real-browser verification and publishing approval remain pending.

- Align the public API with frozen `zaakiy.ads/1` and injected `zaakiy.consent/1` contracts.
- Add provider policy enforcement, per-slot abort/timeouts, failure backoff, SSR placeholders, route allowlists and app isolation.
- Add lease-owned HTTPS script loading that requires explicit advertising grant and fails closed after revocation.
- Verify real-browser consent/CLS/focus/iframe cleanup using Chromium, Firefox and WebKit at narrow/wide viewports.
