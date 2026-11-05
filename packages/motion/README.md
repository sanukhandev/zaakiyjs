# @zaakiyjs/motion (draft P2 implementation)

Optional, browser-native animation controllers. Importing the package has no effect on applications that do not use it; it does not import a JSX renderer, scheduler, compiler, Styles compiler or Router.

> **Draft only.** P2 Motion public contract has not yet been approved in the main branch. The independent controllers here are provisional and must be reconciled with P2-00 before release.

## API

```ts
import { animateElement, createPresence, createSpring, captureLayout, animateKeyedMoves } from "@zaakiyjs/motion";
import { runRouteTransition } from "@zaakiyjs/motion/route";

const fade = animateElement(element, {
  keyframes: [{ opacity: 0, translate: "0 8px" }, { opacity: 1, translate: "0 0" }],
  duration: 200,
  owner
});
const result = await fade.finished; // finished, skipped, cancelled or failed
fade.cancel();

const presence = createPresence(dialogNode, {
  owner,
  enter: { keyframes: [{ opacity: 0 }, { opacity: 1 }] },
  exit: { keyframes: [{ opacity: 1 }, { opacity: 0 }] },
  onExited() { /* caller chooses when and how to remove the node */ }
});

const before = captureLayout(keyedElements);
// Reorder the *same* elements using the compiler/DOM owner.
const animations = animateKeyedMoves(before, { owner });

const spring = createSpring({ from: 0, to: 1, owner, onUpdate(value) {
  element.style.opacity = String(value);
} });

// After Router has completed guards and loaders, the integration adapter
// may invoke runRouteTransition at the documented DOM commit boundary.
```

Motion uses WAAPI for keyframes and native CSS individual `translate` in FLIP. Styles owns CSS keyframe/transition styles and emits brand motion tokens as CSS custom properties; the Motion package never imports Styles build tooling. Prefer CSS for simple hover/focus states.

## Lifecycle

```text
idle -> running <-> paused -> finished
                  |        -> skipped (unsupported/reduced-motion)
                  +---------> cancelled (signal/owner/superseded/removal)
                  +---------> failed (browser API/update callback)
```

Every handle resolves `finished` **once** with a status object, including cancellation and errors. Consumers can explicitly cancel/dispose even without an owner. An explicit Core owner registers cleanup; owned resources stop on permanent disposal. KeepAlive and temporary route suspension do not imply permanent disposal. Physical element removal is always controlled by the owning DOM integration. WAAPI cancellation rejection is consumed.

Reduced-motion defaults to `respect`; `disable` skips and `force` overrides. The `reduce` policy requests a shortened duration instead of skipping for keyframe animations. Active keyframes complete on a preference change; no global patching is performed.

## Known integration gaps and release blockers

- Current `@zaakiyjs/dom/compiler` lacks public pre-removal defer/commit hooks. `createPresence` cannot delay compiler region teardown safely; the adapter must be specified and implemented separately without editing private region state.
- Router has no public DOM-commit transition interception contract. `@zaakiyjs/motion/route` is a transport-neutral helper, **not** an installed Router adapter. Never run before guards, loaders and authorization succeed.
- `animateKeyedMoves` requires the caller to capture element positions before the compiler's reorder and invoke it after. No private keyed ABI access or automatic hooks.
- Native WAAPI, View Transitions, CSS individual transforms, IntersectionObserver and Pointer Events need Chromium, Firefox and WebKit compatibility verification. Unsupported WAAPI skips, and View Transitions fall back to committing without animation.
- Package CI discovery, root lockfile importer and external packed-consumer audit require a separately owned integration PR, because this branch may not edit root scripts and lockfiles.
- Not certified: all 33 prescribed browser scenarios, heap/bundle/frame timing, production CSP/AXE, first-publication scope ownership and npm release.

The package is opt-in and browser-global-free at import; there are no runtime dependencies besides `@zaakiyjs/core`.
