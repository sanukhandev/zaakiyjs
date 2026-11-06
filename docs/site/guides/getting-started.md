---
title: "Getting started"
description: "Set up ZaakiyJS from source and compile a native reactive Counter"
sidebar_position: 1
---

# Getting started

ZaakiyJS is currently documented from its **repository source**, not from a verified public npm release. All package manifests on the reference revision use `0.0.0`. Do not assume an `npx @zaakiyjs/cli@latest` command succeeds until a published version exists.

## Requirements

- Node.js matching the repository toolchain and individual package engines.
- `pnpm 10.20.0` (pinned in the root `package.json`).
- A modern browser for the supported native DOM/TSX subset.

## Build the workspace

```sh
git clone https://github.com/sanukhandev/zaakiyjs.git
cd zaakiyjs
corepack enable
corepack prepare pnpm@10.20.0 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
```

These commands validate the current checkout. A successful source build does not certify published npm, all browsers or all proposed features.

## The application authoring model

The starter template in `packages/cli/templates/minimal/` uses this TSX component:

```tsx
// src/App.tsx
import { signal } from "@zaakiyjs/signals";

export function App() {
  const count = signal(0);

  return (
    <main class="mx-auto p-8">
      <h1>ZaakiyJS Counter</h1>
      <p>Compiler-first, fine-grained reactivity.</p>
      <button type="button" onClick={() => { count.value += 1; }}>
        Count: {count.value}
      </button>
    </main>
  );
}
```

A browser entrypoint mounts the already compiled TSX and imports the generated utility stylesheet:

```tsx
// src/main.tsx
import { mount } from "@zaakiyjs/dom";
import { App } from "./App";
import "virtual:zaakiy-styles.css";
import "./base.css";

const target = document.getElementById("app");
if (!target) throw new Error("Missing #app mount target");
mount(() => <App />, target);
```

This `<App />` expression is transformed by the compiler. It is **not** a runtime JSX object interpreted by React, Vue or a generic DOM renderer.

## Connect the Vite compiler

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { zaakiyPlugin } from "@zaakiyjs/vite-plugin";

export default defineConfig({ plugins: [zaakiyPlugin()] });
```

Your `tsconfig.json` must use strict TypeScript and preserve JSX for the Zaakiy compiler. The canonical template carries a working configuration; do not substitute React's JSX runtime.

## Framework scaffolding command

After publication the intended CLI interface is:

```sh
npx @zaakiyjs/cli@latest start --project my-app
```

The supported command verb is `start --project`, **not** `create`. Use `zaakiy start --project my-app --template minimal|standard|enterprise` in an installed CLI environment. Scaffolding does not automatically install dependencies; follow its generated README. See [CLI](../packages/cli.md).

## Why updates are precise

When `count.value` changes, the compiler-generated text binding sees that signal and updates the existing text node. The component setup function is not repeatedly invoked to render an entire tree. The button keeps its DOM identity and event listener until the enclosing owner is disposed.

See [Signals](../packages/signals.md), [Core](../packages/core.md), [Compiler](../packages/compiler.md), [DOM](../packages/dom.md) and [Styles](../packages/styles.md).

## Supported source is intentionally constrained

The compiler reports errors for unsupported patterns rather than silently changing JSX semantics. As of the documented source revision, JSX spreads, general component children, certain ref/slot patterns and dynamic class/style syntax are not a universal supported language. Use the typed, tested examples in each package guide.

## Next steps

Continue with [building real features](./feature-integration.md) or inspect the [runtime/platform boundaries](./architecture-and-limitations.md).
