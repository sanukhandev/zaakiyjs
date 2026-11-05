# ADR 0007 — P2 UI primitives, UI, motion and templates boundaries

- **Status:** Accepted design contract **only** after P2-00 PR merge; implementation and runtime support remain separately gated.
- **Date:** 2026-11-05
- **Proposed owners:** \`@zaakiyjs/ui-primitives\`, \`@zaakiyjs/ui\`, \`@zaakiyjs/motion\`, \`@zaakiyjs/templates\`.
- **Supersedes:** none. Extends ADRs [0004](0004-dom-region-abi.md), [0005](0005-tsx-control-flow-intrinsics.md), [0006](0006-nested-keyed-fragment-templates.md). \`IR_SCHEMA_VERSION\` and DOM ABI v1 are unchanged.
- **Integration issue:** [#37](https://github.com/sanukhandev/zaakiyjs/issues/37).

## Decision

Freeze documentation/types **without exporting runtime stubs** or altering Core, Signals, DOM, Compiler or Styles. Four future packages have isolated owners, optional integration adapters and no required JSX interpreter/virtual DOM.

| Package | May depend on (public exports only) | Must not depend on |
| --- | --- | --- |
| \`ui-primitives\` | \`core\`, \`signals\`, browser \`dom\` if required | \`ui\`, \`motion\`, Router, Compiler, Node |
| \`motion\` | \`core\`, browser \`dom\` if required; CSS by convention | \`ui\`, Router, Compiler, Node |
| \`ui\` | \`ui-primitives\`, \`core\`, \`signals\`, browser \`dom\`, \`styles\` **conventions/prebuilt CSS**; optional \`motion\` peer | Node \`styles\` compiler, Compiler, Router required, JSX interpreter |
| \`templates\` | \`ui\` public source APIs + manifest/file-plan contracts; Node-only generator adapter at build time | mandatory browser template runtime, arbitrary executable template engine |

Arrows point toward dependencies. Neither a browser entrypoint nor its transitive imports can import Node/CI modules (\`fs\`, \`child_process\`, compiler, Vite, AI, proxy server), read browser globals at top-level, register document listeners at module import or inject runtime stylesheets. Packages may expose separate explicit \`/node\` export paths with conditional exports and independent tests. Motion must remain optional for UI and templates.

## Current compiler support matrix — authoritative for P2 code

| Source form | Actual implementation state at P2-00 | Constraint |
| --- | --- | --- |
| Native single-root TSX, text/property bindings, typed native events | Supported restricted subset | Compiler-lowered direct DOM; no renderer |
| Native nested elements, literal \`class\` | Supported restricted subset | Styles extracts literal utility tokens |
| Imported \`<Show>\`, \`<For>\`, nested keyed native fragments | Supported restricted subset under ADRs 0005–0006 | Fail-closed grammar, stable keyed owners; application root still native |
| \`<Button label="Save" onPress={fn} />\` | Component calls with explicit non-JSX props supported | Component setup once per owner; props must not be reactive snapshots |
| \`<Dialog>...</Dialog>\` | **Unsupported** (\`ZC2102\`) | No component-child/slot factory ABI |
| \`slot={<button />}\` in a component prop | **Unsupported** (\`ZC2108\`) | Nested JSX attribute expression |
| \`<button ref={setNode} />\` | **Unsupported** (\`ZC1003\`) | Typed \`ref\` exists; compiler rejects; DOM \`bindRef\` eagerly invokes callback |
| \`<Button {...props} />\` | **Unsupported** (\`ZC1002\`) | JSX spreads not lowered |
| \`class={computedClass}\`, dynamic \`style\` | **Unsupported** (\`ZC2203\`/\`ZC2204\`) | Bind helpers exist, compiler safety/extraction not frozen |
| Async \`<Presence>\` exit delay in regions | **Unsupported** | DOM v1 disposes removed owner immediately |

**Source typing is not executable support.** P2 package implementations must compile real TSX against the pinned \`P2_BASE_SHA\` and report unsupported syntax as a blocker rather than introduce a runtime JSX compatibility layer.

## Component composition and native node access decision

1. **Supported today:** caller composes flat components and nested native elements under a **native TSX parent**. Components accept typed, explicitly named non-JSX props and callbacks. The compiler initializes component functions once and the DOM runtime owns the resulting real native nodes. An owner-scoped signal or zero-argument live getter is passed instead of a stale snapshot where appropriate (see ADR 0006).
2. **Headless imperative attachment today:** controllers accept caller-provided \`HTMLElement\` and explicit live \`OwnerScope\`. Integration code can attach to a pre-existing element or, as a constrained bridge, query **within its own application container after mount** and attach to the mount owner. Do not global-query guessed IDs, steal DOM region nodes, transfer owner trees to portals or rely on \`ref\` compiler acceptance.
3. **Future declarative composition:** component children become a compiler-generated, owner-scoped **native-node factory**, never a runtime JSX \`Element\` tree. \`<Dialog><button>Open</button></Dialog>\` is the proposed syntax, but is not executable until Compiler/IR/Core and DOM integration tests pass; component children cannot be implemented as a generic JSX visitor in UI. Native \`ref={callback}\` will supply connected node lifecycle to controllers and be cleared once on disposal. See issue #37.
4. **Portals:** physical relocation does not change the owner graph. Dedicated portal nodes remain owned by the originating component even if hosted elsewhere, same document only; arbitrary compiler region extraction is forbidden. There is no implicit cross-app owner transfer.

Current \`@zaakiyjs/dom/compiler\` exposes \`bindRef\`, \`bindClass\`, \`bindStyle\`, \`bindAttribute\` but public runtime capability alone is **not** authorization for unsupported TSX lowering. DOM \`bindRef\` does not presently guarantee a connected element when called; integration issue #37 owns the timing/ABI decision.

## Shared public policy

- **State:** controlled values are readonly signals with required change callbacks, uncontrolled values use initial \`defaultValue\` and private signal state; do not switch modes silently. Changes carry typed interaction reason and original native event; controllers never write controlled signals.
- **Disposal:** all controller/portal/motion handles expose idempotent \`dispose()\`, attach to explicit owner, fail cleanly on invalid/disposed owners and leave no listeners, focus locks, observers, animations, or detached owned nodes.
- **Presence:** \`entering -> present -> exiting -> exited\` is a state policy, not a second ownership system. Normal cancellation resolves a result (no unhandled promise rejection); owner disposal wins immediately. Asynchronous exit **before** DOM removal needs an explicit new region protocol under issue #37.
- **Styles:** deterministic semantic brand tokens and recipes are owned by Styles; no runtime CSS generation. Dynamic classes must be statically enumerated and safely lowered in a separately reviewed compiler change, not used speculatively.
- **Templates:** editable strict TSX source and deterministic, checked manifest/file plan are the only portable representation. No default install/run, private source submission, SSR-visible side effects or browser template interpreter.

## Required integration gates

Before four implementation branches merge: strict TypeScript and compiler diagnostic/IR fixtures; real browser owner/portal/focus/keyboard accessibility and CSS extraction; interrupted/reduced-motion disposal; browser/Node package import smoke; deterministic offline generator plan/rollback and generated application build. Release/pack validation and any semantic changes to v1 generated code require a versioned follow-up ADR and migration.

**P2-00 itself:** docs-only diff, Markdown link/references validation, CI lint/typecheck/build/test, PR review and no changeset (no publishable package touched). After merging, record **actual main commit SHA** as \`P2_BASE_SHA\`; all four implementation branches start from exactly that SHA, not the earlier M1/P1 base or this pre-merge feature commit.
