# Framework Architecture and Boundaries

## Mission

Create an independent TypeScript/TSX compiler-first frontend framework with fine-grained signals, direct native DOM bindings, scoped ownership, SOLID/MVVM application design, brand-first CSS, and optional verified Gemini optimizations. Do not rely on React, Angular or Vue runtimes; learn from their mature semantics without cloning their APIs blindly.

## Execution model

```text
Developer TSX / types / zaakiy.config.ts
  -> TypeScript parser + semantic/type analysis
  -> versioned Zaakiy IR
       -> native DOM binding compiler
       -> utility / recipe CSS compiler
       -> browser target + compatibility pass
  -> deterministic JS/CSS/maps/manifests -> Vite
       (optional Gemini proposals -> local verification -> human review)
Browser: signals + owners + minimal DOM/update helpers
Server/edge (optional): SSR, route loaders, request-scoped providers, secure proxy
```

Compiler, AI, devtools/build tools and server-only proxy must not become mandatory browser runtime dependencies. Browser output must work with AI disabled and without networked build-time services.

## Package domains (26 planned publishable modules)

- Foundation: `core`, `signals`, `dom`, `compiler`, `styles`, `vite-plugin`, `cli`.
- App architecture: `store`, `forms`, `router`, `compat`, `async`.
- Networking: `http`, `proxy`.
- UI: `ui-primitives`, `ui`, `templates`, `motion`.
- Rendering/distribution: `ssr`, `seo`, `analytics`, `ads`, `consent`.
- Intelligence/quality: `ai`, `devtools`, `testing`.

All published names use the proposed `@zaakiyjs/` scope. `create-zaakiyjs` may become a separate npm initializer, but project generation uses the planned direct command `npx @zaakiyjs/cli@latest start --project my-app`. Do not create placeholder npm packages merely to satisfy the inventory.

## Core design guarantees

1. **Single reactive foundation:** signals manage value dependencies; no required global async patching.
2. **Component setup once per owner:** bindings update DOM nodes directly; no mandatory virtual DOM.
3. **Hierarchical ownership:** app -> route -> feature -> component; resources close with owning scope.
4. **Unidirectional local flow:** parents own writable state and pass data/actions downward; global stores expose explicit controlled mutation methods.
5. **Independent packaging:** each package has an explicit API surface, dependency graph, version and release lifecycle.
6. **Secure data flow:** server-only secrets; typed HTTP; bounded proxy endpoints; tenant/user-aware cache isolation.
7. **Accessible defaults:** focus, keyboard navigation, semantic HTML and reduced motion.
8. **Evidence-based performance:** benchmark against equivalent vanilla/React/Vue/Solid/Svelte workloads.

## Layered app pattern

- **Model:** domain data/types, invariants, repository interfaces, services.
- **ViewModel:** owner-scoped signals/computed state, actions, tasks/resources, error/loading state.
- **View:** typed TSX, DOM and presentation binding; no direct repository dependencies.
- **Page adapter:** route params, loader, provider composition, ViewModel construction, metadata and rendering policy.
- **Infrastructure:** HTTP adapters, storage, proxy and server services.

Do not force a separate ViewModel for a stateless presentational primitive.

## Explicitly deferred

Full SSR/hydration, router/devtools ecosystem, gesture/spring physics, large UI catalog, monetization, and Gemini-assisted generation occur after the deterministic compiler/signal/DOM foundation. Their contracts should be future-compatible, not prematurely implemented. See [implementation sequence](../development/implementation-plan.md).
