# ZaakiyJS M0 shared contracts — revision 1

**Status:** Contract baseline for independent implementation, **NOT** working framework code. Every package currently exposes types and an explicit `foundationStatus.implemented === false`. Runtime functions, the TSX transform and CLI commands must not be assumed to exist.

Implementers must treat this directory and the public types in `packages/*/src` as an inter-package change boundary. Any incompatible change requires an ADR, coordinated type/behavior tests and affected package version intent.

## Symbol ownership

| Public surface (planned; unimplemented) | Owning package | Import boundary |
| --- | --- | --- |
| `signal`, `computed`, `effect`, `batch`, `untrack`, `flushSync` | `@zaakiyjs/signals` | `@zaakiyjs/signals` |
| `createOwner`, `runWithOwner`, `getOwner`, `onCleanup`, `disposeOwner` | `@zaakiyjs/core` | `@zaakiyjs/core` |
| `createContext`, `provide`, `useContext`, `Component`, TSX types | `@zaakiyjs/core` | `@zaakiyjs/core`, `@zaakiyjs/core/jsx-runtime` |
| `mount`, DOM binding and keyed-list runtime | `@zaakiyjs/dom` | `@zaakiyjs/dom`, compiler ABI `@zaakiyjs/dom/compiler` |
| `IR_SCHEMA_VERSION`, serialized IR, `compile`, diagnostics | `@zaakiyjs/compiler` | `@zaakiyjs/compiler` |
| Brand configuration, `extractStyles`, `compileStyles` | `@zaakiyjs/styles` | `@zaakiyjs/styles` |
| `zaakiyPlugin`, virtual CSS module, generated assets | `@zaakiyjs/vite-plugin` | `@zaakiyjs/vite-plugin` |
| `zaakiy` command and generators | `@zaakiyjs/cli` | CLI executable (not yet shipped) |

`@zaakiyjs/core` may provide owner-scoped wrappers/re-exports of signals APIs; `signals` must not import `core`. Value-level exports in this table are *reserved*, not exported by the M0 skeleton, except `IR_SCHEMA_VERSION`.

## Dependency graph

```mermaid
flowchart LR
  signals --> core --> dom
  signals --> dom
  compiler --> vitePlugin["vite-plugin"]
  styles --> vitePlugin
  vitePlugin --> cli
```

Arrows point from dependencies to consumers. `compiler` and `styles` are build-only; `vite-plugin` and `cli` never enter browser runtime dependency closures. `@zaakiyjs/dom/compiler` is a **runtime ABI subpath**, not an import of the compiler package. No dependency on TypeScript parser internals appears in public IR.

## Read in order

1. [Signals and scheduling](01-signals.md)
2. [Owners, providers, component initialization](02-ownership.md)
3. [Typed TSX source semantics](03-tsx.md)
4. [Compiler-to-DOM ABI](04-dom-abi.md)
5. [Versioned IR and compile result](05-compiler-ir.md)
6. [Style extraction and branding](06-styles.md)
7. [Vite integration and assets](07-vite-plugin.md)
8. [Unresolved decisions](08-open-decisions.md)

## M0 scope and verification

Root `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, and frozen install validate package metadata, type contracts, real ESM module outputs and exported status flags. The cross-package TSX example is **noEmit / typecheck-only** with `jsx: preserve`; it does **not** prove compiler-generated DOM or JSX runtime functionality. All seven packages start at `0.0.0` for the pre-implementation baseline, but are independently versioned (`fixed: []`, `linked: []`). Publishing remains blocked pending scope/license/API review.
