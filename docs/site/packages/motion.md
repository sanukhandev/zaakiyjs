---
title: "@zaakiyjs/motion"
description: "Optional WAAPI animations, spring motion, presence, layout and gesture controllers"
sidebar_position: 17
---

# @zaakiyjs/motion

Use Motion for owner-scoped browser animation; keep simple hover/focus transitions in generated CSS.

> **Availability:** Source implementation in ZaakiyJS, not a verified published npm release. The package's manifest at the referenced revision uses `0.0.0`; use workspace tooling until independent publishing is approved.

## At a glance

- **Use it when:** Animate existing native elements after DOM insertion, and cancel handles on owner disposal.
- **Reference revision:** [9f6c6603c98c](https://github.com/sanukhandev/zaakiyjs/commit/9f6c6603c98ca566c2fed6fed34cc770f6a72960).

## Try it in the monorepo

```sh
pnpm --filter @zaakiyjs/motion typecheck
pnpm --filter @zaakiyjs/motion test
pnpm --filter @zaakiyjs/motion build
```

## Feature usage: first working pattern

```ts
import { createOwner, disposeOwner } from '@zaakiyjs/core';
import { animateOwned } from '@zaakiyjs/motion';

const owner = createOwner();
const element = document.getElementById('panel')!;
const animation = animateOwned({
  owner, element,
  keyframes: [{ opacity: 0 }, { opacity: 1 }],
  timing: { duration: 180 }
});
const outcome = await animation.finished;
console.log(outcome.phase);
disposeOwner(owner);
```

## Usage and correctness guidelines

- The caller owns DOM removal; presence exit is not yet automatically integrated with compiler region teardown.
- Reduced-motion preferences must be respected; manual overrides should be an explicit app decision.
- Router transition helpers are not an installed routing hook, and browser support needs real target verification.

## Public API index

Exported symbols detected in the package root `src/index.ts`. Platform-specific subpaths and structural contracts are explained in the detailed guide and package manifest.

- `AnimationHandle`
- `AnimationReducedMotionPolicy`
- `ElementAnimationOptions`
- `GestureController`
- `GestureEvent`
- `GestureOptions`
- `LayoutOptions`
- `LayoutSnapshot`
- `MotionEndReason`
- `MotionHandle`
- `MotionOptions`
- `MotionOutcome`
- `MotionPhase`
- `MotionReason`
- `MotionResult`
- `MotionScopeOptions`
- `MotionStatus`
- `PresenceController`
- `PresenceOptions`
- `PresencePhase`
- `ReducedMotionPolicy`
- `ScrollHandle`
- `ScrollProgressOptions`
- `SpringOptions`
- `StandalonePresenceController`
- `StandalonePresenceOptions`
- `StandalonePresenceState`
- `ViewportOptions`
- `animateElement`
- `animateKeyedMoves`
- `animateLayout`
- `animateOwned`
- `captureLayout`
- `createGestures`
- `createPresence`
- `createSpring`
- `createStandalonePresence`
- `observeScrollProgress`
- `observeViewport`

## Detailed feature guide

### API

```ts
import { animateOwned, createPresence, animateElement, createSpring, captureLayout, animateKeyedMoves } from "@zaakiyjs/motion";
import { runRouteTransition } from "@zaakiyjs/motion/route";

const fade = animateOwned({
  owner, element,
  keyframes: [{ opacity: 0 }, { opacity: 1 }],
  timing: { duration: 200 }
});
const result = await fade.finished; // { phase: "finished", reason: "completed" } or cancellation
fade.cancel();

// Additional provisional lower-level controllers are independent of Contract 11.
const extra = animateElement(element, {
  keyframes: [{ opacity: 0, translate: "0 8px" }, { opacity: 1, translate: "0 0" }],
  duration: 200,
  owner
});
const extraResult = await extra.finished; // finished, skipped, cancelled or failed
extra.cancel();

const presence = createPresence({
  owner, element: dialogNode,
  enter: { keyframes: [{ opacity: 0 }, { opacity: 1 }], timing: { duration: 150 } },
  exit: { keyframes: [{ opacity: 1 }, { opacity: 0 }], timing: { duration: 150 } }
});
const exitResult = await presence.exit(); // caller must still own physical DOM removal

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

### Lifecycle

```text
idle -> running <-> paused -> finished
                  |        -> skipped (unsupported/reduced-motion)
                  +---------> cancelled (signal/owner/superseded/removal)
                  +---------> failed (browser API/update callback)
```

Every handle resolves `finished` **once** with a status object, including cancellation and errors. Consumers can explicitly cancel/dispose even without an owner. An explicit Core owner registers cleanup; owned resources stop on permanent disposal. KeepAlive and temporary route suspension do not imply permanent disposal. Physical element removal is always controlled by the owning DOM integration. WAAPI cancellation rejection is consumed.

Reduced-motion defaults to `respect`; `disable` skips and `force` overrides. The `reduce` policy requests a shortened duration instead of skipping for keyframe animations. Active keyframes complete on a preference change; no global patching is performed.

### Known integration gaps and release blockers

- Current `@zaakiyjs/dom/compiler` lacks public pre-removal defer/commit hooks. `createPresence` cannot delay compiler region teardown safely; the adapter must be specified and implemented separately without editing private region state.
- Router has no public DOM-commit transition interception contract. `@zaakiyjs/motion/route` is a transport-neutral helper, **not** an installed Router adapter. Never run before guards, loaders and authorization succeed.
- `animateKeyedMoves` requires the caller to capture element positions before the compiler's reorder and invoke it after. No private keyed ABI access or automatic hooks.
- Native WAAPI, View Transitions, CSS individual transforms, IntersectionObserver and Pointer Events need Chromium, Firefox and WebKit compatibility verification. Unsupported WAAPI skips, and View Transitions fall back to committing without animation.
- Package CI discovery, root lockfile importer and external packed-consumer audit are isolated in stacked PR #41, because this branch may not edit root scripts and lockfiles.
- Not certified: all 33 prescribed browser scenarios, heap/bundle/frame timing, production CSP/AXE, first-publication scope ownership and npm release.

The package is opt-in and browser-global-free at import; there are no runtime dependencies besides `@zaakiyjs/core`.

## Integrate with neighboring packages

- [@zaakiyjs/ui-primitives](./ui-primitives.md)
- [@zaakiyjs/styles](./styles.md)
- [@zaakiyjs/router](./router.md)
- [@zaakiyjs/dom](./dom.md)

## Source and maintenance

- [Package README](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/motion/README.md)
- [Public source exports](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/motion/src/index.ts)
- [Package test cases](https://github.com/sanukhandev/zaakiyjs/tree/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/motion/test)
- Update this page when public APIs, runtime semantics or platform guarantees change.
