# Testing, Quality Gates and Engineering Evidence

## Test layers

1. **Unit** (Vitest): signals, batching, scheduler, ownership, form fields, cache, SSR safety, style tokens, AI proposal schema.
2. **Compiler golden and behavioral:** TSX -> IR/code snapshots **and** semantic execution, side effects, order, event and error behavior.
3. **DOM integration:** text/attribute/property updates, keyed DOM identity, input focus, cleanup, conditional removal and subscriptions.
4. **Real browsers:** Playwright in Chromium, Firefox and WebKit with explicit supported target versions and representative examples.
5. **Property-based:** randomized signal updates, dependency graph changes, keyed list permutations and concurrent cancellation.
6. **Security:** XSS, Trusted Types/CSP, unsafe URLs, SSRF, credentials/secret leakage, authorization, cross-tenant cache, AI prompt injection.
7. **Accessibility:** semantic HTML, keyboard/focus management, accessible error messages, reduced motion.
8. **SSR and SEO:** generated indexable HTML, metadata, 404/410/redirect statuses, hydration, private cache isolation and sitemaps.
9. **Performance:** equivalent production workloads against vanilla DOM, React, Angular, Vue, Solid and Svelte, with disclosed environment and p50/p95 timings.
10. **Published artifacts:** `npm pack --dry-run --json`, clean consumer install, exports/types/source-map verification, license and provenance.

## Proposed budgets (not measured)

| Quality measure | Target |
| --- | --- |
| Core reactive + DOM runtime | <= 12 KiB gzip (exclude app/optional modules) |
| Browser AI runtime | 0 bytes |
| Unrelated mutations for isolated signal update | 0 |
| Post-disposal retained owned listeners/effects | 0 |
| Build reproducibility | Identical hashes for pinned inputs |
| User-visible accessibility | WCAG 2.2 AA-oriented tested behavior |
| Supported browsers | Explicit Chromium, Firefox, WebKit matrix |

## Merge and release gates

PRs must report packages touched, API/IR implications, tests **actually run**, output and size changes, security and accessibility effects, benchmark evidence when relevant, and one changeset or no-release rationale per affected published module. Test failures cannot be waved away for performance wins.

Require typecheck, lint, applicable unit/golden/integration tests, critical security checks and architecture dependency enforcement. Run downstream consumer tests for changed foundational packages. Skip publication on missing required evidence.

## CI trust model

Untrusted PR code must not get npm publishing credentials. Require least-privilege CI permissions and review/pin third-party GitHub Actions. Use npm trusted publishing with properly configured package-specific OIDC when releases are implemented; scripts cannot assume privileges.

## Architecture and diagnostics

Planned `zaakiy lint --architecture solid-mvvm` validates layering, forbidden imports, circular dependencies, server-only code in browser, and obviously unowned resources. Static analysis cannot prove absence of all leaks; verify runtime ownership and disposal separately.
