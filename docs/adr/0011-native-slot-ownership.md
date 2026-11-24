# ADR 0011 — Owned native slot factory boundary

- **Status:** Proposed on PR #61, pending final-head CI.
- **Owners:** Core ownership and DOM native compiler runtime.
- **Compatibility:** Additive imperative API; TSX compiler IR v1 and existing `ComponentCall` remain frozen.

## Motivation

Component JSX children and named slots remain blocked by compiler diagnostics `ZC2102` and `ZC2108`. Blindly passing a DOM node as `children` or embedding nested JSX source in an expression string would violate type-safe ownership, single-initialization guarantees and versioned IR validation. Slot factories also need correct disposal if the visual destination is a portal outside the logical owner tree.

## Decision

Expose `createOwnedNativeSlot(owner, factory)` from `@zaakiyjs/dom/compiler`, returning a `mount(host, before?)` / `dispose()` handle. The factory runs **at most once**, synchronously, inside a child owner of the supplied logical owner. It must return one native Node or a DocumentFragment; comments anchor the exact inserted range so multiple roots can be disposed without disturbing siblings.

The slot may be mounted into a portaled host but the child retains its logical owner and inherited providers. Child mount callbacks execute after insertion, and parent disposal disposes descendants then deletes the owned range. Invalid mounts and factory exceptions roll back. External corruption of either anchor is reported and never triggers blind deletion of unrelated siblings.

This is an **imperative integration primitive**, not an automatic JSX children syntax transform or arbitrary source interpreter. It can be used by reviewed generated/native composition layers while the compiler/IR v2 slot proposal is developed. It neither compiles arbitrary JSX props nor changes any v1 runtime behavior.

## Remaining compiler contract

The follow-up versioned compiler extension must define `ComponentCall` slot fields, a source-span-preserving IR migration, named-slot syntax and JSX type mapping, factory invocation ownership, reserved-prop collisions, multiple roots, portal lifecycle, nested keyed template semantics, error and disposal behavior. Tests must prove compiler-generated `<Dialog><button>Open</button></Dialog>` across Chromium/Firefox/WebKit without a JSX runtime. Until then, `ZC2102`/`ZC2108` remain intentionally enforced.

**Issue #37 is still open.** Do not describe this primitive as completed component/slot compilation.
