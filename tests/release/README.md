# ZaakiyJS release-hardening evidence

This directory implements **pre-publication validation**. Passing the automated checks does not authorize publication.

## Packed artifact consumer

`node scripts/release/verify-packages.mjs` discovers and packs every publishable workspace package (currently ten) with `pnpm pack`, checks each archive's public JS/types exports and CLI binaries, verifies that workspace-protocol dependencies are rewritten, and installs **actual tarballs outside the repository** using consumer-local file overrides. It imports all public ESM entrypoints, compiles a small TSX module and runs a strict TypeScript type check.

`node scripts/release/verify-packages.mjs --enforce-release` additionally rejects placeholder `0.0.0` versions, missing explicit package licenses and missing root LICENSE; the current repository is intentionally **not release-ready**. This mode is for an approved future release PR, not an attempted automatic publication. The npm scope ownership and trusted-publisher identity must be verified by the owner separately; a local pack test cannot verify them.

`scripts/release/hash-build.mjs` outputs canonical SHA-256 digests of each generated package file. The CI gate builds twice on the same pinned runner and compares all paths/hashes. It tests reproducibility under that runner and pinned inputs, not across operating systems or npm releases.

## CSP, accessibility and memory

The Release Hardening workflow builds an actual CLI-generated production Vite consumer from the existing M1 browser fixture. It adds an explicit `script-src 'self'` CSP without `unsafe-inline` or `unsafe-eval`; serves pinned axe-core 4.14.0 as a local **test-only** static asset; and uses pinned Playwright 1.64.1 with Chromium, Firefox and WebKit. The browser audit rejects untrusted HTML insertion, verifies that a real inline script is blocked, runs axe WCAG 2/2.1/2.2 A/AA checks, and checks keyboard interaction.

A Chromium CDP heap test runs 60 warm-up plus 600 measured compiler-generated mount/update/unmount cycles, forces browser garbage collection and checks a conservative 8MiB retained-heap growth ceiling. It reports raw start/mid/end measurements. This is a regression bound, **not** proof that no objects can ever leak. Firefox/WebKit do not expose equivalent standardized heap GC metrics; cross-engine lifecycle tests remain in the M1 suite.

## Explicitly incomplete gates

- **Human approval:** choose and apply a repository/package license; verify `@zaakiyjs/*` scope ownership; set approved independent package versions and npm trusted-publisher provenance.
- **Browser declarations:** define exact supported browser version ranges and compatibility transforms with `@zaakiyjs/compat`; the Playwright browser revision is not a product browser policy.
- **Accessibility:** axe automated rules do not replace manual screen-reader testing, WCAG expert review or target-device coverage.
- **Security:** test CSP and URL sinks broadly, review third-party advisories and handle all high severity production dependency findings; no claim of complete CSP/Trusted Types audit.
- **Performance:** expand GC runs across sizes, workloads, browsers and percentiles; publish reproducible resource and DOM-mutation benchmarks.
- **Release:** only after published registry test from a clean consumer, reproducible offline package checks, signed provenance and explicit human approval can issue #24 be closed as a release gate.

Do not bypass a failed automated gate or mark issue #24 complete merely because one browser suite passes.
