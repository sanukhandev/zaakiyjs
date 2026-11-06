# @zaakiyjs/analytics Changelog

## Unreleased — P3 implementation

- Implement frozen `zaakiy.analytics/1` event, pageview, conversion and Web Vital records, plus typed metadata allowlists.
- Accept injected `zaakiy.consent/1` capability without importing a competing consent runtime.
- Add versioned provider initialization, bounded queues and retries, timeout/cancellation, and late-provider cleanup after revocation.
- Add no-network memory and explicit HTTPS-origin-allowlisted fetch providers, conversion deduplication and privacy validation.
- Add committed-Router navigation and disposable Web Vitals collector adapters, type-contract and lifecycle tests.

No default Web Vitals collector, vendor integration or npm publication is claimed by this implementation.
