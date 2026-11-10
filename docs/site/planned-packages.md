---
title: "Planned packages and contracts"
description: "Proposed modules are not described as current runtime exports"
sidebar_position: 4
---

# Planned packages and feature gates

The 22 implemented package guides cover directories present on the reviewed `main` commit (`10df2c23a861`). A documented contract or an open feature PR does **not** make a package available on `main`.

| Proposed package | Existing reference | What remains to prove |
| --- | --- | --- |
| [`@zaakiyjs/analytics`](./packages/analytics.md) | [P3 Analytics contract](../contracts/16-analytics.md) | Executable event/provider lifecycle, consent gate, measurement correctness, privacy and browser validation |
| [`@zaakiyjs/ai`](./packages/ai.md) | [AI architecture](../architecture/ai-boundary.md) | Node-only advisory, explicit consent, allowlisted IR proposals, reproducible offline builds and review |
| [`@zaakiyjs/devtools`](./packages/devtools.md) | [Architecture overview](../architecture/overview.md) | Stable trace/debug contracts without perturbing runtime scheduling or leaking secrets |
| [`@zaakiyjs/testing`](./packages/testing.md) | [Testing policy](../development/testing-and-quality.md) | Dedicated exported package/fixtures and verified published artifacts |

Additional modules, adapters and extensions may be proposed through ADRs. Do not publish docs with invented import statements, fake feature examples or unverified npm install instructions. When a new package actually reaches `main`, inspect its public exports and tests, create `docs/site/packages/<name>.md`, add it to the documentation index, and update this page.

SEO PR #51 was merged on `main` at `10df2c23a861`; consult its [implemented package guide](./packages/seo.md). Analytics remains pending an independently verified implementation merge. A source package is not a published npm release.
