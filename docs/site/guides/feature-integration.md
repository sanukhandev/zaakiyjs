---
title: "Feature integration patterns"
description: "Compose Signals, Core, Store, Async, HTTP, Router, Forms, UI, Consent and Ads"
sidebar_position: 2
---

# Feature integration patterns

ZaakiyJS features are deliberately separated into small packages. Keep a clear direction of dependencies, one source of reactivity, explicit ownership and server-only trust boundaries.

## A pragmatic MVVM feature

Organize an application feature with a Model/repository interface, a signal-driven ViewModel and a compiled TSX View:

```text
src/features/products/
  models/product.ts
  services/productRepository.ts
  viewmodels/createProductViewModel.ts
  views/ProductView.tsx
  adapters/createProductPage.ts
```

- **Model:** Data types, policies and repository interfaces. It must not reference DOM nodes.
- **ViewModel:** Signals, stores, resources, derived state and typed actions. Create inside a Core owner.
- **View:** Typed TSX; reads signals, binds DOM props and delegates events to actions.
- **Page adapter:** Coordinates route ownership, dependency injection, loader data and native view mounting.

Do not create ceremonial ViewModel classes for static UI. Use a plain component where no feature state exists.

## Scoped dependency injection

```ts
import { createOwner, createContext, provide, requireContext, runWithOwner, disposeOwner } from '@zaakiyjs/core';

interface ProductRepository { list(): Promise<readonly string[]> }
const Repository = createContext<ProductRepository>('ProductRepository');
const app = createOwner();
provide(app, Repository, { list: async () => ['Keyboard', 'Monitor'] });

const page = createOwner(app);
const vm = runWithOwner(page, () => {
  const repo = requireContext(page, Repository);
  return { load: () => repo.list() };
});
console.log(await vm.load());
disposeOwner(app);
```

Core's lexical owner is **synchronous**. Provide or register cleanup before crossing an `await`; pass native AbortSignals for long-running work.

## Shared state without process singletons

Create state under an app/request root, expose read-only signals through a typed store port, and mutate only through actions:

```ts
import { createStore } from '@zaakiyjs/store';
import { createOwner, runWithOwner, disposeOwner } from '@zaakiyjs/core';

const app = createOwner();
const cart = runWithOwner(app, () => createStore({
  state: { count: 0 },
  actions: ({ update }) => ({
    increment() { update('count', current => current + 1); }
  })
}));
const summary = cart.select(s => `Items: ${s.count.value}`);
cart.actions.increment();
console.log(summary.value);
disposeOwner(app);
```

Stores do not use a second scheduler, proxies or localStorage persistence.

## Repository, HTTP and read resources

Keep transport behind a repository boundary. Let Async own loading, cancellation, supersession and resource state:

```ts
import { createHttpClient } from '@zaakiyjs/http';
import { createResource } from '@zaakiyjs/async';
import { createOwner, runWithOwner, disposeOwner } from '@zaakiyjs/core';

const http = createHttpClient({ baseURL: '/api/', timeoutMs: 8_000 });
const owner = createOwner();
const products = runWithOwner(owner, () => createResource({
  load: async ({ signal }) => http.get('/products', { signal }),
  eager: true
}));
await products.refresh();
disposeOwner(owner);
http.dispose();
```

Use a runtime response validator for untrusted API data. Do not implement independent retries in both Async and HTTP without a single explicit retry budget. For mutations, server-side authorization and idempotency remain mandatory.

## Typed forms and controlled UI

`@zaakiyjs/forms` owns field state and validation; `@zaakiyjs/ui` owns visual controls and native interactions. `BoundTextField` accepts a structural string-valued field binding. Compose both inside an owner and keep labels and error announcements visible.

```tsx
import { createForm } from '@zaakiyjs/forms';
import { BoundTextField, Button } from '@zaakiyjs/ui';

export function ContactForm() {
  const form = createForm({
    initialValues: { name: '' },
    onSubmit: async (values) => { console.log(values.name); }
  });
  const name = form.field('name', { required: 'Enter your name' });
  return <main>
    <BoundTextField field={name} label="Name" />
    <Button type="button" label="Submit" onPress={() => { void form.submit(); }} />
  </main>;
}
```

The snippet demonstrates package composition; confirm the exact `BoundTextFieldProps` contract against current public types before copying into a release. In a live TSX app, setup and form cleanup belong to the component's Core owner. Import `@zaakiyjs/ui/styles.css` once in the entrypoint. Do not rely on this pattern for server validation or safe logging of submitted personal data.

## Routing and cancellation

Route definitions declare paths, optional guards and loaders. The Router allocates route owners and aborts superseded navigation. Page adapters receive loader data and return compiled **native DOM nodes**. A route guard protects navigation behavior, not backend resources; enforce authorization again on the server.

See [Router](../packages/router.md), [Async](../packages/async.md) and [HTTP](../packages/http.md).

## Consent and optional advertising

Create a Consent manager per application root, await storage restoration, and inject its frozen `zaakiy.consent/1` capability into Ads. Advertising must remain unauthorized until every required purpose is granted. Route teardown, consent revocation and application disposal stop owned optional work; provider-specific adapter code must handle cookies, SDK cleanup and external deletion requests.

See [Consent](../packages/consent.md) and [Ads](../packages/ads.md). **No ad network SDK or analytics collector is bundled or auto-loaded.**

## Progressive adoption

You do not need every package. Start with Signals + Core + DOM/Compiler + Styles/Vite; add Store, Forms, Router, UI, Motion, Async, HTTP, SSR foundation, Consent or Ads only when the application requires them. Never import build-time Compiler/Styles/CLI, Node Proxy or untrusted config into the browser.
