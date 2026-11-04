# Contract 04 — compiler-generated DOM runtime ABI v1

**Owner:** `@zaakiyjs/dom/compiler`, a dedicated public **browser runtime** subpath. It is distinct from Node `@zaakiyjs/compiler`; compiler output must only reference runtime package exports.

The M0 `CompilerDomAbiV1` *type* reserves the following operations; there are **no callable implementations**:

```ts
createElement(tag: string, namespace: "html"|"svg"|"mathml"): Element
createText(initial: string): Text
setText(target: Text, next: string): void
setProperty(target: Element, name: string, value: unknown): void
setAttribute(target: Element, name: string, value: string|null): void
bindText(owner: OwnerScope, node: Text, read: () => unknown): BindingHandle
bindProperty(owner: OwnerScope, node: Element, name: string, read: () => unknown): BindingHandle
listen(owner: OwnerScope, node: EventTarget, name: string, fn: EventListener, options?: AddEventListenerOptions): BindingHandle
```

**Semantics:** static elements/text created once; dynamic binding bodies track signal reads; a write only mutates the target on a changed value. Text must use `Text.data` instead of replacing the subtree. Properties, attributes, class/style and SVG require distinct safe write paths. Listener registration returns an owner-attached disposable; never duplicate on signal changes or replace controlled inputs. `mount(factory, container)` creates a root owner and returns a disposal handle; its executable signature remains reserved.

**Keyed lists:** key extraction must be deterministic and stable across moves; reuse existing nodes/owners for equal keys, move DOM ranges without reinitializing children, dispose removed keyed owners and preserve focused node identity. Duplicate keys must produce an actionable error or warning policy, not silent identity corruption. The keyed region ABI is now **frozen for v1**, with range markers, duplicate-key rules and owner-scoped updates defined in [ADR 0004](../adr/0004-dom-region-abi.md).

No compiler tool/AST/Vite import is allowed in browser runtime code. ABI evolution requires an explicit version change, generated-code compatibility test and migration note.

## ADR 0004 extension: conditional and keyed regions

The exported browser runtime subpath `@zaakiyjs/dom/compiler` now additionally defines `createRegion`, `bindConditionalRegion` (optional false branch) and `bindKeyedRegion`, together with `DomRegion` and `KeyedView`. See [ADR 0004](../adr/0004-dom-region-abi.md) for signatures, identity, duplicate-key, owner teardown, mount timing, and same-key updates. Exposing an ABI does not prove all TSX authoring forms are compiled; unsupported source must fail closed until verified.
