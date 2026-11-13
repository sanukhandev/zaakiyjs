---
title: "Planned packages and contracts"
description: "Proposed modules are not described as current runtime exports"
sidebar_position: 4
---

# Planned packages and feature gates

The 23 implemented source-package guides correspond to the package directories on the production-hardening baseline `f19b9f6a466de7f5b03dd085925c8d9092a87f85`. A documented contract or an open feature PR does **not** make a package available on `main`.

| Proposed package | Existing reference | What remains to prove |
| --- | --- | --- |
| [`@zaakiyjs/ai`](./packages/ai.md) | [AI architecture](../architecture/ai-boundary.md) | Node-only advisory, explicit consent, allowlisted IR proposals, reproducible offline builds and review |
| [`@zaakiyjs/devtools`](./packages/devtools.md) | [Architecture overview](../architecture/overview.md) | Stable trace/debug contracts without perturbing runtime scheduling or leaking secrets |
| [`@zaakiyjs/testing`](./packages/testing.md) | [Testing policy](../development/testing-and-quality.md) | Dedicated exported package/fixtures and verified published artifacts |

Additional modules, adapters and extensions may be proposed through ADRs. Do not publish docs with invented import statements, fake feature examples or unverified npm install instructions. When a new package actually reaches `main`, inspect its public exports and tests, create `docs/site/packages/<name>.md`, add it to the documentation index, and update this page.

SEO and Analytics are implemented source packages on the baseline main commit; consult their [SEO](./packages/seo.md) and [Analytics](./packages/analytics.md) guides. A source package is not a published npm release.
