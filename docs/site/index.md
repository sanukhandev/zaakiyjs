---
title: "ZaakiyJS Documentation"
description: "Package reference, recipes and architecture for the compiler-first ZaakiyJS framework"
sidebar_position: 1
---

# ZaakiyJS documentation

Build typed, fine-grained TypeScript/TSX applications with native DOM updates, deterministic CSS, scoped ownership and opt-in integrations.

These pages are **source documentation**, designed to be imported into a documentation website without depending on its theme, build system or runtime. They describe the 22 package directories present on the reviewed `main` revision `10df2c23a861`. Package manifests still use `0.0.0`; this documentation does **not** assert npm availability or production certification.

## Start learning

1. [Create your first app](./guides/getting-started.md) — workspace setup, supported TSX, Vite and the browser entrypoint.
2. [Build real features](./guides/feature-integration.md) — Models/ViewModels, stores, resources, typed forms, navigation, privacy.
3. [Architecture, runtime boundaries and known gaps](./guides/architecture-and-limitations.md) — what runs in Node, browser and server, and what is not ready.
4. [Planned packages](./planned-packages.md) — documented contracts without implemented package directories on the reviewed main commit.

## Package reference

### Compiler-first foundation

| Package | Primary feature |
| --- | --- |
| [Signals](./packages/signals.md) | Reactive signals, computed values, effects and scheduler |
| [Core](./packages/core.md) | Owner scopes, contexts, lifecycle and TSX contracts |
| [DOM](./packages/dom.md) | Native node bindings, mount/disposal, conditional/keyed regions |
| [Compiler](./packages/compiler.md) | TSX semantic analysis, IR v1 and DOM code generation |
| [Styles](./packages/styles.md) | Brand tokens, atomic utilities, responsive/dark CSS, recipes |
| [Image](./packages/image.md) | Local build-time responsive image encoding and native picture markup (draft PR #61) |
| [Vite Plugin](./packages/vite-plugin.md) | Compilation pipeline, asset output, diagnostics and HMR behavior |
| [CLI](./packages/cli.md) | Starter projects, generators and project diagnostics |

### State, navigation and networking

| Package | Primary feature |
| --- | --- |
| [Store](./packages/store.md) | Action-only owner-scoped shared state |
| [Router](./packages/router.md) | Typed routes, nested page owners, guards, loaders and cancellation |
| [Forms](./packages/forms.md) | Typed fields, nested arrays, validation and submission |
| [Async](./packages/async.md) | Read resources, mutation tasks, abort, caching and concurrency |
| [HTTP](./packages/http.md) | Fetch transport, interceptors, runtime validation, retries |
| [Proxy](./packages/proxy.md) | Server-only named upstreams, auth and SSRF controls |
| [Compat](./packages/compat.md) | Build-time compatibility analysis, target manifests and scoped helpers |

### Interface and experience

| Package | Primary feature |
| --- | --- |
| [UI Primitives](./packages/ui-primitives.md) | Headless keyboard, focus, dialogs, menu and overlay controllers |
| [UI](./packages/ui.md) | Styled native components and bundled deterministic CSS |
| [Motion](./packages/motion.md) | Native animation, presence and gesture controllers |
| [Templates](./packages/templates.md) | Checksummed editable dashboard, authentication, settings and CRUD source |

### Server rendering and privacy

| Package | Primary feature |
| --- | --- |
| [SSR](./packages/ssr.md) | Trusted server rendering infrastructure; reactive TSX hydration remains blocked |
| [SEO](./packages/seo.md) | Static/dynamic metadata, canonical/OG/JSON-LD, crawler controls and sitemap feeds |
| [Consent](./packages/consent.md) | Purpose decisions, revocation, CMP/storage adapters |
| [Ads](./packages/ads.md) | Consent-gated display placements and provider lifecycle |

## Proposed package guides (not runtime exports)

[Analytics](./packages/analytics.md) · [AI advisor](./packages/ai.md) · [Devtools](./packages/devtools.md) · [Testing helpers](./packages/testing.md). These pages document intended contracts and release gates only. See [status and roadmap](./planned-packages.md).

## Design rules

- **Compiler-first:** Author TSX; produce native DOM operations at build time. There is no mandatory JSX interpreter or virtual DOM.
- **One reactive foundation:** Signal reads drive only the bindings that depend on them.
- **Explicit ownership:** App, route and component resources have disposable owners; async work gets native AbortSignal cancellation.
- **Server boundaries:** Never import build tools, secret-bearing config or `@zaakiyjs/proxy` into browser applications.
- **Privacy by default:** Optional vendors must be denied until the consent capability authorizes their purpose.
- **No artificial publication claims:** Code in `main`, passing tests, a merged PR and a published package are different milestones.

## Contributing to documentation

See [documentation maintenance rules](./CONTRIBUTING.md). Source implementation remains the final authority: always check `packages/<name>/src/index.ts`, `package.json`, tests and the relevant ADR when adopting a feature.
